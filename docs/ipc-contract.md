# Cat-Talk IPC 계약서

마이그레이션 기준 문서. upstream `misosiruda/bongo-cat-chat` **dev21 / `981dd43`** (2026-11-02) 소스 실측 기반. Qt WebEngine + QWebChannel 구조를 **Electron(main) + React(renderer) + Python 사이드카**로 옮길 때의 경계·메시지·데이터 계약을 정의한다.

> 이 문서는 upstream 코드에서 **실제로 오가는 것**을 기록한다. upstream이 갱신되면 해당 변경분을 이 문서에 반영한 뒤 포팅한다.

---

## 1. 아키텍처 — IPC는 2개 층이다

원본은 단일 프로세스가 아니라 **두 개의 IPC 경계**를 가진다. 포팅은 이 둘을 분리해 매핑해야 한다.

```
[A] renderer ↔ controller           [B] controller ↔ worker(별도 프로세스)
 QWebChannel bridge.request()         multiprocessing Queue (spawn)
 요청/응답(JSON), 렌더러가 600ms 폴링    commands(maxsize 64) / events(maxsize 2048) / stop(Event)
```

- **[A] renderer↔controller**: 렌더러가 `bridge.request(JSON)` 호출 → `Controller.dispatch` 처리 → JSON 반환. 렌더러는 상태를 **push로 받지 않고 `view`를 600ms 간격으로 폴링**해 최신 상태를 통째로 가져온다(`setInterval(()=>refresh(),600)`).
- **[B] controller↔worker**: 네이티브(Steam FFI·Mono 메모리 읽기)는 `run_worker`가 도는 **spawn 자식 프로세스**에 격리. 큐로만 통신하며 이벤트는 `state`/`message`/`reaction`/`result`.

### Electron 매핑

| 원본 | Electron 전환 |
|---|---|
| Controller + worker + service + store + merger (Qt 제외 Python 전부) | **Python 사이드카** 프로세스 |
| QWebChannel `bridge.request` | Electron main ↔ 사이드카 IPC(stdio JSON 라인/로컬 소켓), main ↔ renderer는 `ipcRenderer`/`contextBridge`. 요청 응답이 아닌 사이드카 → main 알림 줄은 둘이다(`hidden_ids` §9, `compat_status` 1.0.8 ② — 둘 다 main 전용, 렌더러로 가지 않는다) |
| 렌더러 600ms `view` 폴링 | 그대로 폴링 유지 가능. (선택) 사이드카 push로 바꿀 수 있으나 **계약 보존 원칙상 1차는 폴링 유지 권장** |
| worker spawn + Queue | 사이드카 내부에 그대로 유지(파이썬 multiprocessing). Electron은 사이드카 1개만 관리 |

**핵심 불변식:** 렌더러는 `view` 응답 하나로 전체 UI 상태를 재구성한다. 그래서 `view`가 계약의 중심이고, 나머지 액션은 명령형(상태를 바꾸고 다음 `view`에서 반영됨)이다.

---

## 2. 요청 액션 계약 (renderer → controller)

호출 형식: `bridge.request(JSON.stringify({action, ...args}))` → `{...}` 또는 `{error:"<code>"}`.
문자열 SteamID는 **항상 string**(JS number 정밀도 금지). 원본 `rpc()` 래퍼는 `{error}`를 reject로 변환한다.

| action | 인자 | 반환(성공) | 주요 에러 | 비고 |
|---|---|---|---|---|
| `view` | `lobby?,account?,query?,before?,start?,seen?,limit?=100,reactions?,language?` | 아래 §3 전체 상태 객체 | `invalid_query` | 600ms 폴링. 검색·페이징·읽음 집계 |
| `avatars` | `ids[]`(최대 64) | `{images:{id:dataUri}}` | — | Cat-Talk 추가. `view`의 `avatar_id`로 PNG data URI를 받는다. 모르는 id는 응답에서 빠진다 |
| `send` | `context,text` | `{id}` | `connection_changed`·`development_limit_50`·`control_character`·`storage_failed_before_send` | 워커 commands 큐로 전달. 워커(업스트림)는 직전 전송 시도 후 1.0초 안의 전송과 큐에서 2.0초 넘게 기다린 전송을 Steam에 보내지 않고 `failed`로 돌린다. Cat-Talk 렌더러는 전송·재전송을 낸 순간부터 쿨다운 동안 다음 전송을 막는다(D-049) |
| `resend` | `context,id` | `{id}`(새 메시지 id) | `connection_changed`·`storage_failed_before_send` | Cat-Talk 추가(upstream 없음, D-049). `id`가 현재 계정·로비의 내 메시지이고 status `failed`인 저장된 행이어야 한다(`unknown`은 실제로 나갔을 수 있어 제외). 아니면 `resend_unavailable`(→ `request_failed`). 저장된 원문으로 `send`와 같은 `prepare`·큐 경로를 타 새 uuid의 `pending` 행이 맨 아래에 생기고, `prepare`가 통과하면 옛 실패 행을 지운다(`VolatileStore.delete_failed_own`) — 결과가 다시 `failed`면 맨 아래에 남는다 |
| `draft` | `account,lobby,text` | `{ok:true}` | `account_changed` | 세션 한정(아래 §5) |
| `setting` | `key,value` | `{ok:true}` | `invalid_setting` | key: `theme`/`collapsed`/`language`/`reactions_enabled`/`notification_flash`/`notification_toast`. Cat-Talk 추가: `chat_opacity`(정수 20~100)/`presence_notices`/`clear_cats`/`auto_open_chest`/`play_warn`(bool) |
| `delete` | `account,lobby?` | `{ok:true}` | `account_changed` | 현재 계정 기록 삭제 |
| `refresh` | — | `{ok:true}` | — | 언어 재로드 + 저장소 복구 + 워커 refresh |
| `block_user` | `steam_id,blocked,account` | `{ok:true}` | `block_unavailable`·`invalid_steam_id` | 앱 차단(D-033, D-009의 미구현을 대체). 원본 Controller와 같은 배선 — 업스트림 `service.set_blocked`가 계정 일치·`blocked` bool·자기 자신 제외를 검사하고(아니면 `block_unavailable`), 차단한 사람의 채팅·입퇴장·반응·지난 기록을 거른다. 목록은 `VolatileStore`가 `settings`의 `blocked:<account>` 키(`{steam_id: name}` JSON)에 영속한다(계정별, 재실행·로비 이동 유지). 앱 종료 중이면 `block_unavailable` |
| `open_steam_profile` | `steam_id,context` | `{ok:true}` | `invalid_steam_id`·`steam_profile_unavailable`·`steam_profile_failed` | 네이티브 `QDesktopServices.openUrl` → Electron `shell.openExternal`. 사이드카는 검증 후 `{uri}`를 main에 주고, main이 열어 렌더러에는 `{ok:true}`만 돌려준다 |
| `open_steam_trade` | `steam_id,context` | `{ok:true}` | `invalid_steam_id`·`steam_profile_unavailable`·`steam_trade_failed` | Cat-Talk 추가(upstream 없음). 사이드카가 `open_steam_profile`과 같은 순서로 검증(형식·64비트·기준값 `76561197960265728` 미만 → `invalid_steam_id`, context 변경·현재 참여자 아님 → `steam_profile_unavailable`)한 뒤 `steam://openurl/https://steamcommunity.com/tradeoffer/new/?partner=<steamID64 − 기준값>`을 `{uri}`로 main에 준다(교환은 전용 딥링크가 없어 https 페이지를 `steam://openurl/`로 감싼다). main은 형식을 재확인해 `shell.openExternal`로 Steam 클라이언트에서 열고 렌더러에는 `{ok:true}`만 돌려준다 |
| `set_nickname` | `account,steam_id,name` | `{ok:true}` | `account_changed`·`invalid_steam_id`·`invalid_nickname` | Cat-Talk 추가(upstream 없음, D-032). 참여자 표시 이름 덮어쓰기를 업스트림 범용 KV `settings`의 `nicknames:<account>` 키에 `{steam_id: name}` JSON으로 영속한다(계정별, 재실행·로비 이동 유지). `account`가 현재 계정이 아니면 `account_changed`, `steam_id`는 `open_steam_profile`과 같은 정규 uint64 검증, `name`은 문자열이고 앞뒤 공백 제거 후 15자(코드 포인트) 이하가 아니면 `invalid_nickname`. 빈 값이면 그 항목을 지워 기본 Steam 닉네임으로 돌아간다 |
| `warn` | `context,target` | `{ok:true}` | `warn_unavailable` | Cat-Talk 추가(D-052 경고·공개수배). 내 로비 멤버 데이터 `cattalk.warns`의 대상 +1 쓰기를 worker로 보낸다(채팅이 아니다 — 1초 제한·echo 없음). `context`가 현재 연결과 다르거나, 로비 확인 전이거나, `target`이 지금 로비 멤버가 아니면(자기 자신은 허용) `warn_unavailable`. 결과는 비동기: 쓰기가 실패하면 다음 view의 `warn_failed`로 알린다. `send`에 `@이름 경고!` 모양이 오면 채팅으로 보내지 않고 `warn_command`로 거절한다(렌더러가 먼저 `warn`으로 가로챈다). 드로어 '플레이 > 경고'(`play_warn`)가 꺼져 있으면 렌더러가 보내지 않는다 |
| `playlist_add`·`playlist_remove` | `context,id` | `{ok:true}` | `playlist_unavailable`·`playlist_remove_unavailable`·`playlist_exists`·`playlist_full` | Cat-Talk 추가(D-053 플리 공유, `/플리`). 내 로비 멤버 데이터 `cattalk.pl`에 유튜브 영상 ID(11자) 하나를 더하거나 빼는 쓰기를 worker로 보낸다(채팅이 아니다). `context`가 현재 연결과 다르거나, 로비 확인 전이거나, `id`가 영상 ID 모양이 아니면 각각 `playlist_unavailable`(추가)·`playlist_remove_unavailable`(삭제). 추가는 보이는 로비 목록(앱·Steam 차단한 사람 제외)에 이미 있으면 `playlist_exists`, 내 곡이 10개면 `playlist_full`. 결과는 비동기: worker가 거절하면 다음 view의 `playlist_failed`로 같은 코드를 알린다. `send`에 `/플리`로 시작하는 글이 오면 채팅으로 보내지 않고 `playlist_command`로 거절한다(렌더러가 먼저 가로챈다) |
| `wanted_display` | `result` | `{ok:true}` | `invalid_query`(→ `request_failed`) | Cat-Talk 추가(진단 전용). 렌더러가 공개수배 전단을 어떻게 처리했는지 사이드카 진단 로그에 남긴다 — `shown`(끝까지 재생) → `wanted_shown`, `coalesce`(같은 대상 전단이 재생·대기 중이거나 끝난 지 10초 안이라 생략)·`off`(플레이 > 경고 꺼짐)·`expired`(화면이 가려진 채 1분 지남)·`absent`(대상이 목록에 없음) → `wanted_suppressed{reason}`. 대상·로비는 보내지 않는다 |
| `check_updates` | — | `{ok:true}` | — | |
| `restart_update` | — | `{ok:true}` / `{ok:false,reason}` | — | reason: `auto_merge`·`unavailable`·`storage`·`sending` |
| `update_permission` | `allowed` | `{ok:true}` / `{error:update_permission_failed}` | — | |
| `legal` | `document` | `{ok:true}` | `invalid_document`·`legal_unavailable` | document: `privacy`/`licenses`/`chromium`/`sources`. 네이티브 `QDialog` → Electron 재설계 |
| `merge_connect` | — | `{ok:bool}` | — | 합성 연결(게임 프로세스 모듈 로드). §4 |
| `merge_start` | `limit` | `{ok,auto_merge}` | `invalid_merge_limit` | 사용자 명시 시작. limit 1..2^53-1 |
| `merge_stop` | — | `{ok,auto_merge}` | — | |
| `merge_acknowledge` | — | `{ok,auto_merge}` | — | `unknown` 상태 사용자 확인 |
| `merge_maximum` | — | `{ok,limit,auto_merge}` | — | 가능 최대치 조회. 입력 안 보냄 |
| `merge_group` | `group` | `{ok,auto_merge}` | — | group: `cosmetics`/`emotes` |

**전역 에러 처리(`Controller.request`):** 위 화이트리스트 외 `ValueError/TypeError/KeyError/queue.Full` → `request_failed`. SQLite/OS 오류 → `storage_failed`. 요청 원문 32KB 초과 → `request_too_large`. 네이티브 예외 메시지·경로는 렌더러로 넘기지 않는다.

---

## 3. `view` 응답 객체

`service.view()` 반환 + `Controller.dispatch('view')` 추가분. 렌더러 UI 전체가 이것으로 재구성된다.

**연결·컨텍스트**
- `context` `{account,lobby,generation}`, `state`(checking/…/ready), `notice`, `game_build`
- `connected`, `lobby_verified`, `can_send`
- Cat-Talk 1.0.8(우아한 저하): `degraded[]` = 멈춘 게이트(`chat_send` — T1 채팅 프로토콜 지문을 모름, 받기는 계속 / `avatars` — T2 프로필 지문을 모름, 이름+기본 고양이). 렌더러는 소프트 배너로 알리고 연결은 유지한다. `can_command` = 로비 확인됨 — Cat Talk 명령(경고·플리, T0)은 `can_send`가 false여도 된다(입력창은 이것으로 연다). 로비는 Steam에서 찾는다(worker 상태 `lobby_source`: presence/registry/callback/friends — 진단 로그에만). worker는 더 이상 `unsupported_game_build`로 연결을 멈추지 않는다(지문은 기능별 판정, `sidecar/compat/contract.json` schema 2). 연결을 멈추는 경우는 게임의 `steam_api64.dll`에 필요한 함수가 없을 때(`steam_api_unsupported`)뿐이다
- Cat-Talk 1.0.8(② 원격 호환성 데이터, [compat-manifest.md](compat-manifest.md)): worker 상태의 `unknown[]`(계약에 없는 기능)을 사이드카가 main에 `{"event":"compat_status","build":"<빌드>","unknown":[…],"degraded":[…]}`로 알린다(판정이 끝난 ready·no_lobby 상태만, 바뀔 때만 — 계정·로비 없음). main은 `unknown`이 있으면 서명된 원격 매니페스트를 즉시·백오프로 받고, 유효 계약이 바뀌면 사이드카에 `{action:"reload_compat"}` → `{ok:true}`를 보내 worker만 교체한다(재설치·앱 재시작 없음, 대화 기록 유지). T1·T2 소프트 배너는 '곧 자동으로 복구됩니다', T3 배너만 Cat Talk 업데이트를 안내한다

**메시지·방**
- `messages[]`: `{seq,id,session,account,lobby,sender,name,body,received,own,status,echo,kind?,unsaved?}` — `kind`는 `chat`/`member_joined`/`member_left`(프레즌스), `unsaved:true`는 아직 미저장(휘발 버퍼)
- `has_more,has_newer,latest_seq,unseen,unseen_seq`, `lobby`
- `rooms[]`: `{lobby,started,name,segments}` — 사이드바 로비 목록(§5에서 세션 한정으로 축소)
- `draft`, `volatile_peer_ids[]`

**프로필·참여자·차단**
- `profiles{uid:{name,avatar_id,…}}`(허용된 발신자+본인), `participants{uid:{…,blocked}}` — Cat-Talk은 data URI 대신 `avatar_id`를 싣는다(폴링 크기). 아바타가 없으면 키가 없다
- `avatar_stage`(`disabled`/`loading`/`ready`/`unavailable`), `avatar_error` — Cat-Talk 추가
- `default_avatar_id` — Cat-Talk 추가. 게임 기본 고양이(장착 해제 스킨 `Cat`, 모자 없음)를 worker가 1회 렌더한 이미지의 id. `avatars`로 받는다. 렌더러는 아바타 미해결·스킨 변경 중 플레이스홀더로 쓴다. 렌더 전·실패 시 키가 없다
- `profile_targets[]`(Steam 프로필 열기 허용 대상)
- `blocks_ready`, `blocked_users[{steam_id,name}]` — Cat-Talk은 앱 차단 목록(D-033). 렌더러는 `participants`의 `blocked` 멤버를 목록·참여자 수에서 숨기고, 드로어 '차단 목록'에 `blocked_users`(이름은 닉네임 반영)를 보여 준다. `blocks_ready`가 false면(목록 읽기 실패) 업스트림이 상대 대화를 보류한다
- Cat-Talk Steam 차단(D-033 2단계): worker 글루(`sidecar/steam_relationship.py`)가 멤버 프로필 행에 `steam_blocked`(ISteamFriends `GetFriendRelationship` == 5 `Ignored` — 비친구를 '모든 대화 차단'한 경우, 실측. 1 `Blocked`(deprecated, 친구 요청 무시 직후의 일시 값일 수 있음)와 6 `IgnoredFriend`(친구 차단 — 친구는 앱 차단으로 처리)는 제외)를 붙이고, 사이드카가 그 멤버를 view 전체에서 뺀다 — 지난 대화·입퇴장은 `VolatileStore.message_page`가 앱 차단과 같은 조회 단계에서(`latest_seq`·`has_more`·`has_newer`·`unseen`도 맞음), 나머지는 view 후처리에서 `participants`·`profiles`·`reactions`·`profile_targets`·`volatile_peer_ids`, 그리고 `blocked_users`(= 앱 차단 − 스팀 차단). `service.blocked`(앱 차단)에는 넣지 않으므로 앱에서 풀 수 없고, Steam에서 풀면 다음 프로필 갱신(약 1초)에 돌아온다. 나간 멤버는 마지막 판정을 유지(이번 실행), 계정이 바뀌면 초기화. `incoming_count`에서도 뺀다. `steam_blocked`는 렌더러로 보내지 않는다. 글루는 '모든 대화 차단' 전체 목록도 열거해(`GetFriendCount(k_EFriendFlagIgnored)`·`GetFriendByIndex`, 위와 같게 관계값 5만, 연결돼 있는 동안 1초마다) worker 이벤트 `steam_ignored`로 보낸다 — 게임 고양이 숨김 목록(§9)에만 쓰고, 앱 화면 숨김은 위 멤버별 판정 그대로다(D-040)

**설정·상태**
- `theme`,`collapsed`,`language`,`language_preference`,`notifications{notification_flash,notification_toast}`,`reactions_enabled`
- `storage_error`,`revision`(변경 감지용 단조 증가)
- `ui_settings{chat_opacity,presence_notices,clear_cats,auto_open_chest,play_warn}` — Cat-Talk 추가. 읽기 실패 회차에는 키가 없다. `play_warn`(기본 true)은 렌더러만 쓴다 — 꺼지면 내 화면의 옐로카드·공개수배 전단과 내 경고 입력만 멈추고 사이드카 집계·발동·처형 정리는 그대로다
- `nicknames{steam_id: name}` — Cat-Talk 추가(D-032). 현재 계정의 표시 이름 덮어쓰기(`set_nickname`). 항상 있다 — 계정이 없거나 비었으면 `{}`, 읽기 실패 회차는 `{}` + `storage_error`. 렌더러는 참여자 목록·채팅 작성자·입퇴장 문구·반응 카드의 이름을 이 값으로 바꾸고, 없으면 Steam 이름을 쓴다
- `warns{steam_id: n}`, `wanted[{id,target}]`, `warn_failed` — Cat-Talk 추가(D-052). `warns` = 대상별 경고 총횟수(로비 전원의 `cattalk.warns` 중 처형 시각 이후 항목의 합, 보이는 멤버만, 0 제외). `wanted` = 총횟수가 3에 닿아 새로 생긴 공개수배(`id` = `로비:대상:처형 시각`, 같은 처형은 한 번, 받아 가면 비운다, 검색 응답에는 없다). `warn_failed` = 지난 view 뒤 실패한 `warn` 쓰기 수(받아 가면 0). 멤버 프로필의 `cattalk_warns`·`cattalk_wanted` 원문은 렌더러로 보내지 않는다
- `playlist[{id,by,t}]`, `playlist_mine[id]`, `playlist_added[{id,video,by}]`, `playlist_failed[code]` — Cat-Talk 추가(D-053). `playlist` = 보이는 멤버(지금 로비 멤버 − 앱 차단 − Steam 차단, 앱 차단 목록을 못 읽었으면 나만)의 `cattalk.pl` 합집합(같은 영상은 가장 먼저 넣은 하나, 추가 시각순 = 등록순). `playlist_mine` = 내 곡(내가 넣은 순). `playlist_added` = 이미 본 멤버의 목록에 새로 생긴 곡(`id` = `로비:멤버:영상:시각`, 켤 때·로비를 옮길 때·멤버를 처음 볼 때 이미 있던 곡은 기준으로만 삼아 알리지 않는다, 받아 가는 순간 그 사람 목록에 남은 곡만, 받아 가면 비운다, 검색 응답에는 없다). `playlist_failed` = 지난 view 뒤 worker가 거절한 플리 쓰기의 오류 코드(받아 가면 비운다). 멤버 프로필의 `cattalk_pl` 원문은 렌더러로 보내지 않는다
- `translations`(요청 `language`가 현재와 다를 때만, `en`이면 사전)

**추가분(dispatch)**
- `reactions[]`(요청에 `reactions`가 있을 때): `{id,sender,kind,avatar,text,image,expires_in_ms}` — TTL 기반 1회성, 가져가면 비워짐
- `update{…,can_restart,merge_deferred}` — 업데이트 스냅샷
- `auto_merge{…§4 스냅샷…, connection?{state,error,can_connect}}`
- `notification_status{…}`

---

## 4. 자동 합성(auto_merge) 계약

게임 프로세스에 모듈을 로드해 **게임의 원본 중복선택·Merge 함수를 호출**한다(디스크 파일 무수정). 선택 알고리즘·교환 호출은 어댑터가 담당하고, `AutoMerge`는 세션 한정 상태 머신이다.

**스냅샷 필드(`auto_merge`)**
`state,reason,active,can_change_group,available_exchanges,exchange_group,can_start,can_stop,unresolved,completed,limit,pending,category,favorites_allowed,events_excluded,revision`

**상태(state)**: 활성 `arming→preparing→selecting→merging→waiting→stopping` / 종결 `completed·stopped·failed·unknown` / 그 외 `idle·blocked`.
**연결 스냅샷(`auto_merge.connection`)**: `{state,error,can_connect}`.

**중요 불변식**
- `blocks_restart = active || unresolved` → 합성 진행·미해결 중엔 앱 업데이트 재시작을 막는다(`restart_update`가 `reason:'auto_merge'` 반환).
- `limit`은 정수 그대로 전송(2^53-1 상한, QWebChannel/JS 정확 정수).
- `unknown`(결과 미확인)은 자동 재시도하지 않는다. 사용자가 `merge_acknowledge`로만 종결.
- 읽기 전용/오프라인이면 `UnavailableGameUI`로 대체되어 입력을 거부한다.

> **상자 자동 오픈(인앱, A) 경계**: 자동 합성은 위처럼 **사이드카 내부**(인-프로세스)다. 상자 자동 오픈은 게임 디스크를 패치하므로 이 사이드카 계약에 들어오지 않고, **Electron main**이 앱 내 기능으로 맡는다. 패처(`tools/auto_chest/`) 실행·게임 종료/재실행·백업/복원·플래그 파일을 main이 처리하고, 렌더러와는 `chest:*` IPC로 통신한다(§9). 사이드카와 공유하는 것은 설정 `auto_open_chest`뿐이다. Cat-Talk의 연결 판정은 패치된 게임도 허용한다(실측: 패치 상태에서 정상 연결).

---

## 5. store — 휘발/영속 분할 (Cat-Talk 확정 모델)

원본은 단일 `history.sqlite3`에 7개 테이블 + `timeline` TEMP 뷰. Cat-Talk은 **채팅 휘발 / 설정만 영속**으로 분할하고(decisions D-003), 차단 목록은 settings 안에 계정별 키로 영속한다(D-033 — D-009의 무력화를 대체).

| 테이블 | 내용 | Cat-Talk 처분 |
|---|---|---|
| `sessions` | 세션 경계 | **휘발** |
| `messages` | 채팅 | **휘발** |
| `receipts` | 자기-에코 중복제거(→messages CASCADE) | **휘발** |
| `drafts` | 로비별 초안 | **휘발**(종료 시 삭제 확정) |
| `presence_events` | 입·퇴장(→sessions CASCADE) | **휘발** |
| `settings` | theme/collapsed/language/reactions_enabled/알림 + Cat-Talk 드로어 설정(`chat_opacity`·`presence_notices`·`clear_cats`·`auto_open_chest`) | **영속(디스크, `settings.sqlite3`)** |
| `blocked_users` | 계정별 채팅 차단 목록 | **테이블은 안 씀** — `blocked_users()`·`set_blocked()`를 `settings`의 `blocked:<account>` 키(`{steam_id: name}`)로 돌려 **영속**(D-033). 같은 settings에 닉네임 `nicknames:<account>`(D-032)도 있다 |

**설정 저장 역할 분리:** 앱 설정은 `settings.sqlite3`(사이드카), 창 배치(도크·높이·작업표시줄 숨김·모니터 번호)는 `window-state.json`(Electron main)에 둔다. 모니터 번호는 `screen.getAllDisplays()`를 `bounds.x`(같으면 `bounds.y`) 오름차순으로 센 순번(1부터, `electron/displays.js`)이고 드로어 '디스플레이 선택' 버튼·[식별] 오버레이 번호와 같다. 저장하는 번호는 사용자가 고른 모니터뿐이다 — 드로어 버튼, 창을 직접 옮긴 경우(Win+Shift+방향키 등), 옛 파일 이어받기. 창 위치로 다시 판정하는 재도크(디스플레이 추가/제거/배치 변경, 채팅 위치·높이 변경, 창이 있던 모니터 제거 뒤 주 모니터 이동)는 저장값을 바꾸지 않는다. 다음 실행 때 그 번호 모니터가 없으면 주 모니터로 폴백하되 저장값은 그대로 두고, 번호가 없는 옛 파일(≤1.0.5의 `display{id,bounds}`)은 첫 실행 1회만 그 값으로 찾는다. 창 배치는 창 생성 전에 필요해 사이드카를 기다릴 수 없고, 두 저장소가 같은 키를 갖지 않는다. **폴더(D-041):** 둘 다 데이터 폴더 `%LOCALAPPDATA%\CatTalk`에 있다(패처 백업 `auto_chest\`·토스트 아이콘도 같은 곳). main이 폴더를 정해 사이드카 실행 환경 `CATTALK_DATA`로 넘기고, 사이드카는 그 값이 없을 때(단독 실행)만 같은 기본값을 쓴다. Electron 사용자 폴더는 `%APPDATA%\Cat Talk`(productName)로 고정해 dev와 설치본이 단일 실행 잠금을 공유한다. 옛 폴더(`CatTalk-dev`·`cat-talk`)는 옮기지 않는다. 렌더러는 시작 시 첫 `view`로 앱 설정을 1회 받고, 이후 변경은 `setting`으로 저장만 한다.

**구현: `sidecar/volatile_store.py`의 `VolatileStore(Store)` 글루.** upstream `Store`를 상속해 부모 연결을 `:memory:`로 연다 — 7개 테이블과 `timeline` 뷰가 전부 메모리 DB에 생기고(빈 `blocked_users` 포함), FK(messages→sessions, receipts→messages, presence_events→sessions)도 그 안에서 성립한다. `setting()`만 별도 디스크 연결(`settings.sqlite3`)로 돌리고, 차단 목록 두 메서드도 그 settings를 쓴다(D-033). `message_page()`는 사이드카가 채우는 `hidden_senders`(Steam 차단, D-033 2단계)를 앱 차단(`blocked`)에 합쳐 조회한다(`blocked`가 None이면 그대로). `store.py`는 수정하지 않는다(D-009) — upstream 스키마·메서드가 바뀌면 이 글루를 함께 점검한다.

**무의미해지는 것(코드는 upstream 그대로 둠)**
- `RETENTION_SECONDS`·`prune()`·60초 주기 프루닝: 매 실행 빈 메모리 DB라 지울 것이 사실상 없다.
- 시작 시 `pending→unknown`, 열린 세션 `app_interrupted` 복구: 재시작 간 이어붙일 기록이 없다.
- `view`의 검색·`rooms`(사이드바 로비 목록)은 **이번 실행 세션 한정**으로 축소(의도된 동작).

**프라이버시:** 채팅·초안이 디스크에 안 닿는다. 렌더러는 원본처럼 **off-the-record**(localStorage/캐시 비영속)를 Electron에서도 유지 — `webPreferences`에서 채팅 영속 경로를 만들지 않는다.

---

## 6. 워커 이벤트 (controller ↔ worker, 내부 사이드카)

렌더러는 이걸 직접 받지 않는다. 워커가 큐로 올리면 controller가 service에 반영하고, 렌더러는 다음 `view`에서 본다.

| event.type | 처리 | 페이로드(관찰된 키) |
|---|---|---|
| `state` | `service.update` | `account,lobby,generation,connected,lobby_verified,send_enabled,members[],profiles{},name,notice,game_build,build_fingerprint` |
| `message` | `service.receive` → 알림 | `id,context{account,lobby,generation},sender,text,received` |
| `reaction` | `service.receive_reaction` | `id,sender,kind('meow'/'emote'),avatar,text,image,observed,context` |
| `result` | `service.result` | `id,status('accepted'/'failed'/'unknown')` |
| `default_avatar` | 사이드카 보관(LRU 밖) → `view.default_avatar_id` | `avatar`(PNG data URI) — Cat-Talk 글루(`sidecar/default_avatar.py`)가 보낸다 |
| `steam_ignored` | 사이드카 보관 → 게임 고양이 숨김 목록(§9, D-040) | `account`, `ids`(Steam '모든 대화 차단' 전체 SteamID64 정렬, 열거 실패면 `null`) — Cat-Talk 글루(`sidecar/steam_relationship.py`)가 Steam 세션의 첫 열거와 목록이 바뀔 때 보낸다 |
| `steam_released` | 사이드카가 그 worker를 끝내고 새 worker를 띄운다(아래) | 없음 — Cat-Talk 글루(`sidecar/steam_release.py`)가 Steam을 잡았던 `Steam.close()`(SteamAPI_Shutdown) 직후 보낸다 |

**commands(controller→worker)**: `{type:'send',id,text,context}`, `{type:'refresh'}`.
Cat-Talk 경고(D-052): `{type:'send', id:'cattalk-…', cattalk:{op:'warn',target} | {op:'consume',target,when}, context, queued}` — worker 글루(`sidecar/steam_warns.py`)가 `LiveConnection.send`를 감싸 `cattalk` 필드가 있는 명령만 가로채 내 멤버 데이터를 쓴다(쓰기 직전 Steam에서 내 현재 값을 다시 읽어 고친다, 연결 대상이 명령과 다르거나 대상이 멤버가 아니면 `failed`). 결과는 같은 `result` 이벤트로 오고 사이드카가 id 접두로 채팅 결과와 가른다. 같은 글루가 멤버 프로필에 `cattalk_warns`·`cattalk_wanted` 원문(`GetLobbyMemberData`)을 싣는다. Cat-Talk 플리(D-053)도 같은 길이다: `cattalk:{op:'pl_add'|'pl_remove', id}` — 내 `cattalk.pl`을 다시 읽어 고친다(로비 전체 중복은 차단을 아는 사이드카가 미리 보고, 글루는 내 목록의 10개 상한·중복만 본다). 결과 상태는 `accepted`·`failed`·`pl_full`·`pl_exists`이고, 프로필에 `cattalk_pl` 원문을 싣는다. **재입장 복원**: 사이드카가 `계정:로비 ID`별로 내 곡을 앱 실행 중 메모리에만 기억하고(디스크에 쓰지 않음, 지운 곡은 기억에서도 빠짐), 같은 로비에 다시 들어왔는데 Steam이 내 `cattalk.pl`을 빈 값으로 주면 `cattalk:{op:'pl_restore', entries:[[영상, 원래 시각], …]}`을 보낸다. 글루는 지금 내 값이 비었을 때만 그대로 쓴다(아니면 `accepted`로 건너뜀). 다른 로비 ID에서는 복원하지 않고, 복원이 늦거나 실패해도 기억은 다음 재입장까지 남는다(입장마다 최대 3번 시도). 추가 알림은 멤버가 로비에 (다시) 보인 뒤 10초 안에 생긴 곡이면 띄우지 않는다(복원으로 다시 올라온 곡 — 내 화면·남의 화면 모두). **플리 멤버 데이터**: `cattalk.pl` = `[["<영상 ID 11자>", 추가한 Steam 서버 시각(초)], …]`(최대 10개, URL·제목 없음 — 남이 쓴 값은 영상 ID 모양만 받고 여는 URL은 main이 ID로 다시 만든다). 제목은 main이 oEmbed → 영상 페이지 `og:title`로 조회해 이번 실행 동안 메모리에만 두고(`playlist:title`), 재생은 main이 외부 브라우저로 연다(`playlist:open` — 1개 = `watch?v=ID`, 여러 개 = `watch_videos` 임시 재생목록 — YouTube가 50개까지만 받아 50곡 이하면 전체 등록순, 넘으면 누를 때마다 랜덤 50곡을 무작위 순서로, 임시 재생목록으로 넘기지 않으면 첫 곡 단일). 링크는 영상 ID가 있으면(`v=`·youtu.be 경로·`/shorts/`) `list=` 등 부가 파라미터를 무시하고 받고, 순수 재생목록·앨범(`v=` 없는 `list=`, `/playlist`, `/browse/…`)만 거절한다.

**경고 멤버 데이터(D-052)**: `cattalk.warns` = `{"<대상 SteamID64>": [내 경고 수, 마지막 경고의 Steam 서버 시각(초, ISteamUtils::GetServerRealTime)]}`, `cattalk.wanted` = `{"<대상>": 처형 시각}`(최근 64개). 각자 자기 데이터만 쓴다(SetLobbyMemberData). 처형 시각 = 로비 전원 `wanted[대상]`의 최댓값, 그보다 오래된 경고는 모두가 셈에서 뺀다. 총횟수가 3에 닿으면 처형 시각 T = 유효 경고의 최신 시각(데이터만으로 정해져 클라이언트마다 같다) — 기여자는 자기 항목을 지우고 `wanted[대상]=T`를 남긴다. 그때 Cat Talk을 꺼 둔 기여자의 항목은 T 이전이라 무시되고, 그 사람이 다시 켜면 자기 옛 항목을 정리한다. 바닐라 게임은 이 키를 읽지 않는다(멤버 데이터가 바뀌면 그 멤버 고양이 외형만 다시 적용 — `CatCosmeticsMultiplayer.OnLobbyDataUpdate`).
**큐 사양**: commands `maxsize=64`, events `maxsize=2048`, `stop`은 Event(worker마다 새로). spawn 컨텍스트.

**worker 교체·재시작(Cat-Talk)**: Steam은 앱(3419430)을 프로세스 단위로 추적해, worker가 SteamAPI_Shutdown을 불러도 그 프로세스가 살아 있는 한 Bongo Cat을 '실행 중'(`HKCU\Software\Valve\Steam\Apps\3419430\Running=1`)으로 유지한다 — 게임을 꺼도 Steam에서 다시 실행하면 '이미 실행 중'으로 막혔다(D-019 실측). 그래서 사이드카는 `steam_released`를 받으면 그 worker의 `stop`을 걸어 끝내고(5초 안에 안 끝나면 terminate + 큐 교체) 새 worker를 띄운다. 새 worker는 게임을 찾기 전에는 Steam을 초기화하지 않아, 게임이 꺼져 있는 동안 Steam 등록이 없다. 사이드카·store는 그대로라 대화 기록이 남는다. 업스트림은 연결 끊김 `state`를 먼저 보내고(보내던 메시지는 거기서 `unknown`으로 정리) 그 뒤 Steam을 놓는다. 교체가 아닌 worker 종료(크래시·강제 종료)는 지금처럼 `worker_stopped`를 알리고 3초 뒤 새 worker를 띄운다(업스트림은 앱 재시작이 필요했다).

---

## 7. Electron 전환 시 재설계 지점 (네이티브 의존)

원본이 Qt/Win 네이티브에 직접 붙은 부분. 포팅에서 각각 대체 필요.

| 원본 | 대체 |
|---|---|
| `QDesktopServices.openUrl`(Steam 프로필) | `shell.openExternal(steamUri)` |
| `QDialog`+`QTextBrowser`(legal 문서) | 렌더러 모달 또는 별도 BrowserWindow |
| `QLockFile`(단일 인스턴스) | `app.requestSingleInstanceLock()` |
| OTR `QWebEngineProfile`(채팅 비영속) | `webPreferences`로 채팅 영속 금지 + 파일 접근 화이트리스트 |
| `WindowsToast`(WinRT, 고정 AUMID) | Electron `Notification` + AUMID(`CatTalk.Desktop`, 표시 이름·아이콘은 시작 시 `HKCU\Software\Classes\AppUserModelId`에 등록). 렌더러가 `view.incoming_count`(Cat-Talk 추가 필드) 증가로 안 읽은 수를 세어 `alert:unread`로 main에 넘기고, 다시 보면 0을 보낸다. 작업표시줄은 `setOverlayIcon` 숫자 배지, 아이콘 숨김이면 트레이 빨간 점 |
| `QWebEngineUrlRequestInterceptor`(file/qrc 화이트리스트) | Electron `webRequest`/CSP로 로컬 자원만 허용 |
| `QTimer`(100ms poll, 600ms view) | main 루프/렌더러 `setInterval` |

---

## 8. 에러 코드 목록

렌더러로 통과되는 코드: `connection_changed`, `development_limit_50`, `control_character`, `storage_failed_before_send`, `legal_unavailable`, `invalid_steam_id`, `steam_profile_unavailable`, `steam_profile_failed`, `block_unavailable`.
`invalid_query`, `invalid_setting`, `account_changed`, `invalid_merge_limit`, `request_too_large`, `invalid_nickname`(Cat-Talk), `resend_unavailable`(Cat-Talk) → `request_failed`로 접힘(내부에선 발생하지만 렌더러로 나가지 않음).
그 외 전부 → `request_failed`. SQLite/OS → `storage_failed`. `update_permission` 실패 → `{error:update_permission_failed}`.
Cat-Talk 전송 계층 추가 코드: `not_wired`(사이드카 미배선 액션), `bridge_down`(main↔사이드카 전송 실패).
Cat-Talk main 추가 코드: `steam_trade_failed`(교환 요청 URI 형식 재확인 또는 `shell.openExternal` 실패. 사이드카 허용 목록과 무관하게 main이 만든다).

---

## 9. 상자 자동 오픈 IPC (Cat-Talk 추가, 사이드카 밖)

렌더러 ↔ Electron main. 패처 실행·게임 종료/재실행·백업/복원·플래그는 main이 맡는다(`electron/auto-chest.js`, 패처 `tools/auto_chest/`).

| 채널 | 방향 | 내용 |
|---|---|---|
| `chest:status(wanted)` | invoke | `{state, reason?, transparent?, restorable?}`. 판정만 한다(쓰기 없음). `wanted`는 설정이 켜진 기능이 있는지. `restorable`은 원본 복원 제안 대상(D-038) |
| `chest:enable()` | invoke | 설치돼 있으면 플래그만 생성. 아니면 사전 점검 → 카운트다운 → 설치. `{ok, reason?, rolledBack?}` |
| `chest:disable()` | invoke | 플래그 삭제 |
| `chest:reapply()` | invoke | 재적용 토스트의 [재시작]. 사전 점검을 통과하면 카운트다운 없이 바로 설치 흐름. 재적용이 필요한 상태가 아니면 아무것도 하지 않는다. 토스트 [X]는 `chest:disable` + 설정 끄기 |
| `chest:restore()` | invoke | 원본 복원 토스트의 [원본 복원](D-038). 패치본이고 패치를 쓰는 기능이 없을 때만. 버전 확인(백업 SHA + verify) → 게임이 켜져 있으면 카운트다운 → 종료 → 복원 → 재실행, 꺼져 있으면 복원만. `{ok, reason?, restored?}` |
| `chest:cancel` | send | 카운트다운 취소(설치·복원·게임 재시작 공통) |
| `chest:progress` | main → 렌더러 | `{phase, seconds?, reason?, rolledBack?, restored?, action?}`. `action`이 `'restore'`면 원본 복원, `'restart'`·`'launch'`면 게임 재시작·실행 진행 |
| `chest:changed` | main → 렌더러 | 숨김 목록이 바뀌었음(원본 복원 제안 판정이 바뀔 수 있음). 렌더러는 `chest:status`를 다시 부른다 |
| `game:status()` | invoke | `{found, running}` — 드로어 게임 버튼 문구('게임 재시작'·'게임 실행'). 드로어가 열려 있는 동안 3초마다 묻는다 |
| `game:restart()` | invoke | 누른 순간 게임이 켜져 있으면 재시작: 카운트다운(취소 가능) → 일반 종료 → Steam 해제 대기 → `steam://rungameid` → 기동 확인. 꺼져 있으면 실행: Steam 해제 대기 → 실행 → 기동 확인. 사이드카(worker)는 건드리지 않는다(위 §6 worker 교체가 Steam을 푼다). 설치·복원과 겹치면 `busy`. `{ok, reason?}` |

- `state`: `not_installed`·`on`·`off`·`incompatible`·`needs_reapply`·`installing`·`restoring`·`no_game`·`error`·`patcher_mismatch`.
  - 원본 복원 제안(D-038): `restorable` = 패치본(이전 세트·경로가 바뀐 것 포함) + 설정 OFF + 기능 플래그 없음 + 게임 고양이 숨김 목록(사이드카 알림)이 빔. 목록에 Steam 차단 전체가 들어가므로 '빔' = 앱 차단도 Steam 차단도 하나도 없음이다(D-040. 전체 목록 열거에 실패한 실행에서는 이번 실행에서 만난 Steam 차단만 반영된다). 목록을 이번 실행에서 아직 모르면 `false`. 복원 때 백업이 지금 DLL의 원본이 아니면(게임 업데이트 등) 덮어쓰지 않고 `failed`(`version_mismatch`) — 렌더러가 Steam 무결성 확인을 안내한다. 성공하면 기능 플래그와 `CatTalkHidden.ids`를 지운다.
  - `patcher_mismatch`(D-029): 패처가 없거나(`reason: missing`) 앱이 기대하는 규약과 다름(`reason: mismatch`, `version` 명령 없음·값 다름·의존 DLL 누락 포함). 재적용으로는 못 고쳐 켜기·재적용을 막는다(끄기는 허용). prod는 앱 재설치, dev는 `tools/auto_chest/build.ps1`. 렌더러는 설정이 켜져 있으면 '앱 재설치가 필요합니다' 토스트를 띄운다([X] = 이번 실행 동안 숨김).
- `phase`: `checking`·`countdown`·`cancelled`·`stopping_worker`·`closing_game`·`waiting_steam`(게임 재시작·실행만)·`patching`·`restoring`·`launching`·`verifying`·`done`·`failed`.
- 게임 재시작·실행 실패 `reason`: `game_close_failed`(게임이 안 꺼짐 — 게임은 그대로), `steam_still_running`(15초 안에 Steam이 안 풀림 — 재시작이면 켜져 있던 게임을 한 번 다시 실행해 본다, 실행이면 실행하지 않는다), `game_start_failed`(60초 안에 게임 프로세스가 안 뜸).
- 설치 순서: 구조 판정(패처 규약 포함) → 사전 점검(별도 파일에 패치·verify, 재적용이면 원본 백업 SHA도, Cat Talk 연결 호환성 지문이 원본과 같은지) → 카운트다운(켜기만) → 사이드카(worker) 종료 → 게임 종료 → Steam 해제 대기 → 백업(clean일 때만) → 패치·verify → 교체·재검증 → Steam 재실행 → 기동 확인 → 플래그 생성 → 사이드카 재시작. 사전 점검에 실패하면 worker·게임을 건드리지 않고 `failed`(`incompatible`·`preflight_failed`)로 끝난다. 교체 후 실패하면 백업으로 복원한다.
- 설정 저장은 기존 `setting` 액션(`auto_open_chest`)을 그대로 쓴다. 렌더러가 결과가 `ok`일 때만 저장한다.
- 패치 세트 버전(패처 `inspect`의 `patchVersion`, 앱 기대값 `PATCH_VERSION`): 1 = 상자 자동 오픈, 2 = + 투명화(D-028), 3 = + 차단 멤버 고양이 숨김(D-033 3단계), 4 = + 투명화 중 내 고양이 획득 팝업 숨김(D-046), 5 = + 투명화 루트 후크(D-047). 세트는 누적이고, 앱 기대값보다 낮은 설치본은 `needs_reapply`(`reason: outdated`)다 — 재적용 한 번(게임 재시작)으로 올라간다. 인자 규약(`cli`)은 2 그대로다.

### 투명화 중 획득 팝업 숨김 (D-046, 패치 세트 4)

- **배경**: 투명화는 고양이마다 하나인 `TranslucentOnHover`의 CanvasGroup 알파를 0으로 만든다. 내 고양이의 획득 팝업(`MainCat/NewItemPopup`)은 그 CanvasGroup(`MainCat/DraggableFrame`) 밖의 형제라 투명화 중에도 보였다(씬 실측). 다른 참여자 고양이의 팝업(`Cat_Multiplayer/NewItemPopup`)은 그 고양이 CanvasGroup 아래라 이미 함께 숨는다(정적 분석 — 실게임 확인 전).
- **게임 훅**: `NewItemPopup.ShowPopup`에서 멀티플레이 전송(`SteamMultiplayer.SendReceivedItem`, 로비 채널 5) 다음, 표시(큐에 넣기·켜기) 앞에 `if (CatTalkTransparent) return;`(2명령, 투명화 세트의 켜짐 상태 필드를 읽는다). 전송 분기도 게이트를 지난다.
- **동작**: 투명화 플래그(`CatTalkTransparent.on`)를 그대로 쓴다 — 별도 파일·설정 없음. 내 고양이의 획득 팝업 전부(상자·교환·프로모·PawPass 등)가 숨고, 다른 참여자 화면의 내 획득 팝업은 그대로다(전송은 게이트 앞). 투명화 중 받은 아이템은 큐에 넣지 않아 끈 뒤 몰아 뜨지 않는다. 켜는 순간 이미 떠 있던 팝업은 끝까지(약 3초) 보인다.
- **연결 호환성 지문**: `ShowPopup`·`SendReceivedItem`은 지문 범위 밖이다(업스트림 `FeatureProbe` 대상 메서드 실측). 전송·수신 경로(`SteamMultiplayer.SendMessageToLobby`, 로비 메시지 버스)는 chat·reactions 지문 범위라 건드리지 않는다.

### 투명화 루트 후크 (D-047, 패치 세트 5)

- **배경**: 내 고양이 투명화 알파는 게임 호버 반투명의 그룹(`MainCat/DraggableFrame`)에만 걸려, 그 형제(잠수 Zzz·하트·선물 이모트 파티클, 오류 창, 키 후킹 경고, `CatPopUps`, 튜토리얼, 이미 뜬 말풍선, 열린 게임 메뉴)가 보였다(씬 전수 실측). 로비 고양이는 그룹이 루트(`Cat_Multiplayer`)라 전부 숨는다.
- **게임 훅**:
  - `TranslucentOnHover.Start`(투명화 블록 앞): `_alpha`가 자기 오브젝트가 아니면(= 내 고양이) 루트(`MainCat`)에 CanvasGroup을 하나 붙인다(`CatTalkRoot`, 직렬화하지 않는 private 필드).
  - `SetTranslucentSmooth`(투명화 블록 다음): 루트 알파 = 목표 알파가 0이면 0, 아니면 1. 게임 목표는 상수(0.1·1)라 0은 투명화 블록만 만든다 — 게임 호버 반투명은 루트에 영향이 없다. 0이면 `EmoteDonut.CatTalkCloseMenu()`로 열린 게임 메뉴(`MenuNew`)를 게임 닫기 버튼과 같은 `ToggleGameObject.SetActive(false)` 경로로 닫는다(메뉴는 클릭 예외라 루트 알파만 내리면 안 보이는데 클릭되는 영역이 된다).
- **그대로 두는 것**: 도넛·말풍선 게이트와 호버 두 곳(커서 거리·Enter 입력으로 보이지 않는 UI가 열리는 것을 막는다), 획득 팝업 게이트(투명화 중 받은 아이템의 큐 적체 방지). 클릭 통과는 종전 레이어 경로다(런타임에 `CanvasGroup.blocksRaycasts`·`interactable` setter가 스트리핑돼 없다).
- **범위 밖**: `MainCat` 밖의 창(이벤트 달력 등 메뉴에서 직접 여는 창).
- **연결 호환성 지문**: `TranslucentOnHover`·`EmoteDonut`·`ToggleGameObject`는 지문 범위 밖이다(업스트림 `FeatureProbe` 대상 메서드 실측). 더하는 것은 `TranslucentOnHover` 인스턴스 필드 하나, `EmoteDonut` 정적 메서드 하나다.

### 차단 멤버 고양이 숨김 목록 (D-033 3단계·D-040)

- **파일**: 게임 폴더(플래그 옆) `CatTalkHidden.ids`. 한 줄에 SteamID64 하나(십진, 줄마다 LF), 정렬·중복 없음. 없거나 비면 아무도 숨기지 않는다. 앱을 꺼도 남는다(결정 B).
- **게임(패치 세트 3 이상)**: 게임 숨김(`LobbyMemberInstance.IsHidden`: 고양이 오브젝트를 끄고 자리를 비운다. 게임 빌드 26754239부터는 setter가 `AnimatedSetActive`로 축소 애니메이션 뒤에 끈다 — 패처는 두 모양을 모두 받고 삽입 내용은 같다)을 쓴다. 숨김 setter·getter·`PlayerDataCache`·`LobbyMemberVisibility.SetVisibility`와 그 호출 대상은 Cat Talk 연결 호환성 지문(업스트림 `feature-contract.json`의 `privacy`) 범위라 고치지 않고, 그 밖의 세 곳에만 훅을 건다.
  - 입장·재입장(`LobbyMemberInstance.Start`의 숨김 호출 직전): 목록에 있으면 처음부터 숨김.
  - 자동 숨김 토글·참여자 목록 행 생성(`HandleAutoHideUpdated`의 `SetVisibility` 호출 직전): 목록에 있으면 '숨김'으로(게임 버튼 상태도 맞음).
  - `CatSpawnManager.Update`가 0.5초마다 파일을 읽어(`File.Exists`·`ReadAllText`) 전 멤버에 적용: 목록에 있는데 보이는 멤버는 숨기고, 목록에서 빠진 멤버는 게임 '자동 숨김' 설정값으로 되돌린다(결정 A. 차단 전 수동 숨김은 기억하지 않는다). 그 밖의 멤버는 건드리지 않는다. 게임 참여자 목록의 '보이기'를 직접 누르면(지문 범위라 훅 불가) 최대 0.5초 보였다가 다시 숨는다.
  - 투명화(알파 0)와 독립이다.
- **연결 호환성 지문 보증**: 패치 결과의 업스트림 `FeatureProbe` 지문이 원본과 같아야 한다 — 설치 사전 점검이 원본·패치 결과를 비교해 다르면 게임을 건드리기 전에 `failed`(`incompatible`)로, 지문을 내지 못하면 `preflight_failed`로 끝낸다. 패처 사본 검증(`test-copy.ps1`)도 같은 비교를 한다. (2026-11-10: 숨김 setter 입구 훅 시험본이 `privacy` 지문을 바꿔 Cat Talk가 '지원하지 않는 게임 빌드'로 연결을 멈췄다 — 패처는 그 모양을 `hidden_setter_hook`으로 거부한다.) 1.0.8: 계약은 번들 `sidecar/compat/contract.json`(schema 2)에 서명된 원격 매니페스트(②)를 합친 유효 계약(`%LOCALAPPDATA%\CatTalk\compat\contract.json`, main이 사이드카와 같은 파일을 `CATTALK_CONTRACT`로 넘긴다)이고, FeatureProbe가 기능별로 격리해 계산하지 못한 기능만 `unavailable`로 낸다 — 사전 점검은 기능마다 패치 전후가 같으면 통과다. **T3 제한 방향**: 계약 `patch.deny_sha256`에 든 순정 DLL(패치본은 원본 백업의 기록 해시)이면 새 설치·재적용을 `incompatible`(`denied`)로 막는다(이미 설치된 패치는 그대로). 원격 데이터(1.0.8 ②)는 이 목록을 늘려 막을 수만 있고 패처 규칙을 넓힐 수 없다. 패치 기능을 켜 둔 상태에서 `incompatible`이면 렌더러가 소프트 배너로 앱 업데이트를 안내한다.
- **사이드카 → main 알림 줄**: `{"event":"hidden_ids","ids":["<SteamID64>", …]}`(요청 응답이 아니라 `id`가 없다). main만 받고 렌더러로 보내지 않는다(Steam 차단 여부를 렌더러에 보내지 않는 2단계 원칙 유지). 목록 = 현재 계정의 앱 차단(`service.blocked`) ∪ Steam 차단. Steam 차단 = worker가 열거한 '모든 대화 차단' 전체(`steam_ignored`, D-040) ∪ 지금 로비 멤버의 멤버별 판정(`steam_hidden` ∩ 멤버) — 아직 만나지 않은 차단자도 입장 전부터 목록에 있다. 나간 멤버의 지난 판정은 쓰지 않는다(계속 차단이면 전체 목록에 있고, 방 밖에서 풀었으면 빠져야 한다). 전체 목록 열거에 실패하면(`ids: null`) 종전대로 이번 실행의 멤버별 판정 전체(`steam_hidden`, 나간 멤버 유지). 계정이 있고, 그 계정의 앱 차단 목록을 읽었고, 그 계정의 전체 목록 응답(성공·실패)이 왔고, 지금 로비 멤버(나 제외) 모두의 `steam_blocked` 판정이 도착했을 때만 낸다 — 그 전에 내면 이미 숨긴 차단자가 목록에서 잠깐 빠져 다시 보이기 때문이다. 이번 실행에서 판정이 끝난 첫 목록 1회(앱 실행 때) + 그 뒤 바뀔 때마다 낸다. 계정이 없으면(게임 꺼짐·연결 대기) 내지 않아 파일은 그대로다.
- **main 쓰기**(`electron/auto-chest.js` `setHidden`): 알림을 받을 때마다, 그리고 설치·재적용이 끝날 때 마지막 목록을, 설치 판정 후 **현재 세트(`PATCH_VERSION`) 설치 상태에서만** 통째로 쓴다(임시 파일 `CatTalkHidden.ids.cattalk-new`에 쓰고 교체). 미설치·이전 세트(`needs_reapply`)·호환 안 됨·패처 불일치·설치 중·게임 없음이면 쓰지 않는다. 교체가 실패하면(게임이 마침 읽는 중 등) 같은 목록으로 `POLL_MS`(0.5초) 뒤 다시 쓴다. 형식이 틀린 항목(SteamID64 숫자 모양 아님)은 사이드카와 main 양쪽에서 뺀다.
- **알려진 한계**: 이미 Steam에서 차단해 둔 사람은 입장 전부터 목록에 있어 처음부터 숨는다(D-040 — 종전엔 이번 실행에서 처음 만난 Steam 차단 멤버가 판정·쓰기·게임 확인까지 잠깐 보였다). 남는 경우는 Steam에서 막 차단한 사람이 다음 열거(1초) 전에 들어오거나 방 안에서 차단했을 때다 — 판정(약 1초)·쓰기·게임 확인(0.5초)까지 고양이가 잠깐 보일 수 있다. 전체 목록 열거에 실패한 실행은 종전 한계로 돌아간다. 앱 차단은 설정에 영속돼 목록에서 빠지지 않는다. 미패치 기기는 1·2단계(앱 화면 숨김)까지만 된다.

---

## 부록 — 소스 매핑

| 영역 | 파일 |
|---|---|
| IPC 접점(dispatch)·이벤트 poll | `desktop.py` |
| 메시지 상태·프라이버시·view 조립 | `service.py` |
| SQLite 스키마·페이징·검색 | `store.py` |
| 합성 상태 머신 | `auto_merge.py` |
| 합성 연결 어댑터 | `merge_connection.py` · `merge_bridge.py` · `merge_bootstrap.py` · `merge_install.py` |
| 프레즌스/리액션/현지화 | `presence.py` · `reactions.py` · `localization.py` |
| 렌더러(호출부) | `ui/app.js` (rpc 래퍼 + 600ms refresh) |
