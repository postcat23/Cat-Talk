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
| QWebChannel `bridge.request` | Electron main ↔ 사이드카 IPC(stdio JSON 라인/로컬 소켓), main ↔ renderer는 `ipcRenderer`/`contextBridge`. 요청 응답이 아닌 사이드카 → main 알림 줄은 하나뿐이다(`hidden_ids`, §9 — main 전용, 렌더러로 가지 않는다) |
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
| `send` | `context,text` | `{id}` | `connection_changed`·`development_limit_50`·`control_character`·`storage_failed_before_send` | 워커 commands 큐로 전달 |
| `draft` | `account,lobby,text` | `{ok:true}` | `account_changed` | 세션 한정(아래 §5) |
| `setting` | `key,value` | `{ok:true}` | `invalid_setting` | key: `theme`/`collapsed`/`language`/`reactions_enabled`/`notification_flash`/`notification_toast`. Cat-Talk 추가: `chat_opacity`(정수 20~100)/`presence_notices`/`clear_cats`/`auto_open_chest`(bool) |
| `delete` | `account,lobby?` | `{ok:true}` | `account_changed` | 현재 계정 기록 삭제 |
| `refresh` | — | `{ok:true}` | — | 언어 재로드 + 저장소 복구 + 워커 refresh |
| `block_user` | `steam_id,blocked,account` | `{ok:true}` | `block_unavailable`·`invalid_steam_id` | 앱 차단(D-033, D-009의 미구현을 대체). 원본 Controller와 같은 배선 — 업스트림 `service.set_blocked`가 계정 일치·`blocked` bool·자기 자신 제외를 검사하고(아니면 `block_unavailable`), 차단한 사람의 채팅·입퇴장·반응·지난 기록을 거른다. 목록은 `VolatileStore`가 `settings`의 `blocked:<account>` 키(`{steam_id: name}` JSON)에 영속한다(계정별, 재실행·로비 이동 유지). 앱 종료 중이면 `block_unavailable` |
| `open_steam_profile` | `steam_id,context` | `{ok:true}` | `invalid_steam_id`·`steam_profile_unavailable`·`steam_profile_failed` | 네이티브 `QDesktopServices.openUrl` → Electron `shell.openExternal`. 사이드카는 검증 후 `{uri}`를 main에 주고, main이 열어 렌더러에는 `{ok:true}`만 돌려준다 |
| `open_steam_trade` | `steam_id,context` | `{ok:true}` | `invalid_steam_id`·`steam_profile_unavailable`·`steam_trade_failed` | Cat-Talk 추가(upstream 없음). 사이드카가 `open_steam_profile`과 같은 순서로 검증(형식·64비트·기준값 `76561197960265728` 미만 → `invalid_steam_id`, context 변경·현재 참여자 아님 → `steam_profile_unavailable`)한 뒤 `steam://openurl/https://steamcommunity.com/tradeoffer/new/?partner=<steamID64 − 기준값>`을 `{uri}`로 main에 준다(교환은 전용 딥링크가 없어 https 페이지를 `steam://openurl/`로 감싼다). main은 형식을 재확인해 `shell.openExternal`로 Steam 클라이언트에서 열고 렌더러에는 `{ok:true}`만 돌려준다 |
| `set_nickname` | `account,steam_id,name` | `{ok:true}` | `account_changed`·`invalid_steam_id`·`invalid_nickname` | Cat-Talk 추가(upstream 없음, D-032). 참여자 표시 이름 덮어쓰기를 업스트림 범용 KV `settings`의 `nicknames:<account>` 키에 `{steam_id: name}` JSON으로 영속한다(계정별, 재실행·로비 이동 유지). `account`가 현재 계정이 아니면 `account_changed`, `steam_id`는 `open_steam_profile`과 같은 정규 uint64 검증, `name`은 문자열이고 앞뒤 공백 제거 후 15자(코드 포인트) 이하가 아니면 `invalid_nickname`. 빈 값이면 그 항목을 지워 기본 Steam 닉네임으로 돌아간다 |
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
- `ui_settings{chat_opacity,presence_notices,clear_cats,auto_open_chest}` — Cat-Talk 추가. 읽기 실패 회차에는 키가 없다
- `nicknames{steam_id: name}` — Cat-Talk 추가(D-032). 현재 계정의 표시 이름 덮어쓰기(`set_nickname`). 항상 있다 — 계정이 없거나 비었으면 `{}`, 읽기 실패 회차는 `{}` + `storage_error`. 렌더러는 참여자 목록·채팅 작성자·입퇴장 문구·반응 카드의 이름을 이 값으로 바꾸고, 없으면 Steam 이름을 쓴다
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

**설정 저장 역할 분리:** 앱 설정은 `settings.sqlite3`(사이드카), 창 배치(도크·높이·작업표시줄 숨김·모니터)는 `window-state.json`(Electron main)에 둔다. 창 배치는 창 생성 전에 필요해 사이드카를 기다릴 수 없고, 두 저장소가 같은 키를 갖지 않는다. 렌더러는 시작 시 첫 `view`로 앱 설정을 1회 받고, 이후 변경은 `setting`으로 저장만 한다.

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

**commands(controller→worker)**: `{type:'send',id,text,context}`, `{type:'refresh'}`.
**큐 사양**: commands `maxsize=64`, events `maxsize=2048`, `stop`은 Event. spawn 컨텍스트.

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
`invalid_query`, `invalid_setting`, `account_changed`, `invalid_merge_limit`, `request_too_large`, `invalid_nickname`(Cat-Talk) → `request_failed`로 접힘(내부에선 발생하지만 렌더러로 나가지 않음).
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
| `chest:cancel` | send | 카운트다운 취소(설치·복원 공통) |
| `chest:progress` | main → 렌더러 | `{phase, seconds?, reason?, rolledBack?, restored?, action?}`. `action`이 `'restore'`면 원본 복원 진행 |
| `chest:changed` | main → 렌더러 | 숨김 목록이 바뀌었음(원본 복원 제안 판정이 바뀔 수 있음). 렌더러는 `chest:status`를 다시 부른다 |

- `state`: `not_installed`·`on`·`off`·`incompatible`·`needs_reapply`·`installing`·`restoring`·`no_game`·`error`·`patcher_mismatch`.
  - 원본 복원 제안(D-038): `restorable` = 패치본(이전 세트·경로가 바뀐 것 포함) + 설정 OFF + 기능 플래그 없음 + 게임 고양이 숨김 목록(사이드카 알림)이 빔. 목록에 Steam 차단 전체가 들어가므로 '빔' = 앱 차단도 Steam 차단도 하나도 없음이다(D-040. 전체 목록 열거에 실패한 실행에서는 이번 실행에서 만난 Steam 차단만 반영된다). 목록을 이번 실행에서 아직 모르면 `false`. 복원 때 백업이 지금 DLL의 원본이 아니면(게임 업데이트 등) 덮어쓰지 않고 `failed`(`version_mismatch`) — 렌더러가 Steam 무결성 확인을 안내한다. 성공하면 기능 플래그와 `CatTalkHidden.ids`를 지운다.
  - `patcher_mismatch`(D-029): 패처가 없거나(`reason: missing`) 앱이 기대하는 규약과 다름(`reason: mismatch`, `version` 명령 없음·값 다름·의존 DLL 누락 포함). 재적용으로는 못 고쳐 켜기·재적용을 막는다(끄기는 허용). prod는 앱 재설치, dev는 `tools/auto_chest/build.ps1`. 렌더러는 설정이 켜져 있으면 '앱 재설치가 필요합니다' 토스트를 띄운다([X] = 이번 실행 동안 숨김).
- `phase`: `checking`·`countdown`·`cancelled`·`stopping_worker`·`closing_game`·`patching`·`restoring`·`launching`·`verifying`·`done`·`failed`.
- 설치 순서: 구조 판정(패처 규약 포함) → 사전 점검(별도 파일에 패치·verify, 재적용이면 원본 백업 SHA도, Cat Talk 연결 호환성 지문이 원본과 같은지) → 카운트다운(켜기만) → 사이드카(worker) 종료 → 게임 종료 → Steam 해제 대기 → 백업(clean일 때만) → 패치·verify → 교체·재검증 → Steam 재실행 → 기동 확인 → 플래그 생성 → 사이드카 재시작. 사전 점검에 실패하면 worker·게임을 건드리지 않고 `failed`(`incompatible`·`preflight_failed`)로 끝난다. 교체 후 실패하면 백업으로 복원한다.
- 설정 저장은 기존 `setting` 액션(`auto_open_chest`)을 그대로 쓴다. 렌더러가 결과가 `ok`일 때만 저장한다.
- 패치 세트 버전(패처 `inspect`의 `patchVersion`, 앱 기대값 `PATCH_VERSION`): 1 = 상자 자동 오픈, 2 = + 투명화(D-028), 3 = + 차단 멤버 고양이 숨김(D-033 3단계). 세트는 누적이고, 앱 기대값보다 낮은 설치본은 `needs_reapply`(`reason: outdated`)다 — 재적용 한 번(게임 재시작)으로 올라간다. 인자 규약(`cli`)은 2 그대로다.

### 차단 멤버 고양이 숨김 목록 (D-033 3단계·D-040)

- **파일**: 게임 폴더(플래그 옆) `CatTalkHidden.ids`. 한 줄에 SteamID64 하나(십진, 줄마다 LF), 정렬·중복 없음. 없거나 비면 아무도 숨기지 않는다. 앱을 꺼도 남는다(결정 B).
- **게임(패치 세트 3)**: 게임 숨김(`LobbyMemberInstance.IsHidden`: 고양이 오브젝트를 끄고 자리를 비운다)을 쓴다. 숨김 setter·getter·`PlayerDataCache`·`LobbyMemberVisibility.SetVisibility`와 그 호출 대상은 Cat Talk 연결 호환성 지문(업스트림 `feature-contract.json`의 `privacy`) 범위라 고치지 않고, 그 밖의 세 곳에만 훅을 건다.
  - 입장·재입장(`LobbyMemberInstance.Start`의 숨김 호출 직전): 목록에 있으면 처음부터 숨김.
  - 자동 숨김 토글·참여자 목록 행 생성(`HandleAutoHideUpdated`의 `SetVisibility` 호출 직전): 목록에 있으면 '숨김'으로(게임 버튼 상태도 맞음).
  - `CatSpawnManager.Update`가 0.5초마다 파일을 읽어(`File.Exists`·`ReadAllText`) 전 멤버에 적용: 목록에 있는데 보이는 멤버는 숨기고, 목록에서 빠진 멤버는 게임 '자동 숨김' 설정값으로 되돌린다(결정 A. 차단 전 수동 숨김은 기억하지 않는다). 그 밖의 멤버는 건드리지 않는다. 게임 참여자 목록의 '보이기'를 직접 누르면(지문 범위라 훅 불가) 최대 0.5초 보였다가 다시 숨는다.
  - 투명화(알파 0)와 독립이다.
- **연결 호환성 지문 보증**: 패치 결과의 업스트림 `FeatureProbe` 지문이 원본과 같아야 한다 — 설치 사전 점검이 원본·패치 결과를 비교해 다르면 게임을 건드리기 전에 `failed`(`incompatible`)로, 지문을 내지 못하면 `preflight_failed`로 끝낸다. 패처 사본 검증(`test-copy.ps1`)도 같은 비교를 한다. (2026-11-10: 숨김 setter 입구 훅 시험본이 `privacy` 지문을 바꿔 Cat Talk가 '지원하지 않는 게임 빌드'로 연결을 멈췄다 — 패처는 그 모양을 `hidden_setter_hook`으로 거부한다.)
- **사이드카 → main 알림 줄**: `{"event":"hidden_ids","ids":["<SteamID64>", …]}`(요청 응답이 아니라 `id`가 없다). main만 받고 렌더러로 보내지 않는다(Steam 차단 여부를 렌더러에 보내지 않는 2단계 원칙 유지). 목록 = 현재 계정의 앱 차단(`service.blocked`) ∪ Steam 차단. Steam 차단 = worker가 열거한 '모든 대화 차단' 전체(`steam_ignored`, D-040) ∪ 지금 로비 멤버의 멤버별 판정(`steam_hidden` ∩ 멤버) — 아직 만나지 않은 차단자도 입장 전부터 목록에 있다. 나간 멤버의 지난 판정은 쓰지 않는다(계속 차단이면 전체 목록에 있고, 방 밖에서 풀었으면 빠져야 한다). 전체 목록 열거에 실패하면(`ids: null`) 종전대로 이번 실행의 멤버별 판정 전체(`steam_hidden`, 나간 멤버 유지). 계정이 있고, 그 계정의 앱 차단 목록을 읽었고, 그 계정의 전체 목록 응답(성공·실패)이 왔고, 지금 로비 멤버(나 제외) 모두의 `steam_blocked` 판정이 도착했을 때만 낸다 — 그 전에 내면 이미 숨긴 차단자가 목록에서 잠깐 빠져 다시 보이기 때문이다. 이번 실행에서 판정이 끝난 첫 목록 1회(앱 실행 때) + 그 뒤 바뀔 때마다 낸다. 계정이 없으면(게임 꺼짐·연결 대기) 내지 않아 파일은 그대로다.
- **main 쓰기**(`electron/auto-chest.js` `setHidden`): 알림을 받을 때마다, 그리고 설치·재적용이 끝날 때 마지막 목록을, 설치 판정 후 **세트 3 설치 상태에서만** 통째로 쓴다(임시 파일 `CatTalkHidden.ids.cattalk-new`에 쓰고 교체). 미설치·이전 세트(`needs_reapply`)·호환 안 됨·패처 불일치·설치 중·게임 없음이면 쓰지 않는다. 교체가 실패하면(게임이 마침 읽는 중 등) 같은 목록으로 `POLL_MS`(0.5초) 뒤 다시 쓴다. 형식이 틀린 항목(SteamID64 숫자 모양 아님)은 사이드카와 main 양쪽에서 뺀다.
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
