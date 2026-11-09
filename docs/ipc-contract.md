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
| QWebChannel `bridge.request` | Electron main ↔ 사이드카 IPC(stdio JSON 라인/로컬 소켓), main ↔ renderer는 `ipcRenderer`/`contextBridge` |
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
| `block_user` | `steam_id,blocked,account` | `{ok:true}` | `block_unavailable`·`invalid_steam_id` | 원본은 차단 목록 영속. **Cat-Talk은 미구현** — `not_wired` 응답(D-009) |
| `open_steam_profile` | `steam_id,context` | `{ok:true}` | `invalid_steam_id`·`steam_profile_unavailable`·`steam_profile_failed` | 네이티브 `QDesktopServices.openUrl` → Electron `shell.openExternal`. 사이드카는 검증 후 `{uri}`를 main에 주고, main이 열어 렌더러에는 `{ok:true}`만 돌려준다 |
| `open_steam_trade` | `steam_id,context` | `{ok:true}` | `invalid_steam_id`·`steam_profile_unavailable`·`steam_trade_failed` | Cat-Talk 추가(upstream 없음). 사이드카가 `open_steam_profile`과 같은 순서로 검증(형식·64비트·기준값 `76561197960265728` 미만 → `invalid_steam_id`, context 변경·현재 참여자 아님 → `steam_profile_unavailable`)한 뒤 `steam://openurl/https://steamcommunity.com/tradeoffer/new/?partner=<steamID64 − 기준값>`을 `{uri}`로 main에 준다(교환은 전용 딥링크가 없어 https 페이지를 `steam://openurl/`로 감싼다). main은 형식을 재확인해 `shell.openExternal`로 Steam 클라이언트에서 열고 렌더러에는 `{ok:true}`만 돌려준다 |
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
- `blocks_ready`, `blocked_users[{steam_id,name}]`

**설정·상태**
- `theme`,`collapsed`,`language`,`language_preference`,`notifications{notification_flash,notification_toast}`,`reactions_enabled`
- `storage_error`,`revision`(변경 감지용 단조 증가)
- `ui_settings{chat_opacity,presence_notices,clear_cats,auto_open_chest}` — Cat-Talk 추가. 읽기 실패 회차에는 키가 없다
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

원본은 단일 `history.sqlite3`에 7개 테이블 + `timeline` TEMP 뷰. Cat-Talk은 **채팅 휘발 / 설정만 영속**으로 분할하고, 차단은 무력화한다(decisions D-003·D-009).

| 테이블 | 내용 | Cat-Talk 처분 |
|---|---|---|
| `sessions` | 세션 경계 | **휘발** |
| `messages` | 채팅 | **휘발** |
| `receipts` | 자기-에코 중복제거(→messages CASCADE) | **휘발** |
| `drafts` | 로비별 초안 | **휘발**(종료 시 삭제 확정) |
| `presence_events` | 입·퇴장(→sessions CASCADE) | **휘발** |
| `settings` | theme/collapsed/language/reactions_enabled/알림 + Cat-Talk 드로어 설정(`chat_opacity`·`presence_notices`·`clear_cats`·`auto_open_chest`) | **영속(디스크, `settings.sqlite3`)** |
| `blocked_users` | 계정별 채팅 차단 목록 | **무력화·비영속** (`blocked_users()`→`{}`, `set_blocked()` 무동작) |

**설정 저장 역할 분리:** 앱 설정은 `settings.sqlite3`(사이드카), 창 배치(도크·높이·작업표시줄 숨김·모니터)는 `window-state.json`(Electron main)에 둔다. 창 배치는 창 생성 전에 필요해 사이드카를 기다릴 수 없고, 두 저장소가 같은 키를 갖지 않는다. 렌더러는 시작 시 첫 `view`로 앱 설정을 1회 받고, 이후 변경은 `setting`으로 저장만 한다.

**구현: `sidecar/volatile_store.py`의 `VolatileStore(Store)` 글루.** upstream `Store`를 상속해 부모 연결을 `:memory:`로 연다 — 7개 테이블과 `timeline` 뷰가 전부 메모리 DB에 생기고(빈 `blocked_users` 포함), FK(messages→sessions, receipts→messages, presence_events→sessions)도 그 안에서 성립한다. `setting()`만 별도 디스크 연결(`settings.sqlite3`)로 돌린다. `store.py`는 수정하지 않는다(D-009) — upstream 스키마·메서드가 바뀌면 이 글루를 함께 점검한다.

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
`invalid_query`, `invalid_setting`, `account_changed`, `invalid_merge_limit`, `request_too_large` → `request_failed`로 접힘(내부에선 발생하지만 렌더러로 나가지 않음).
그 외 전부 → `request_failed`. SQLite/OS → `storage_failed`. `update_permission` 실패 → `{error:update_permission_failed}`.
Cat-Talk 전송 계층 추가 코드: `not_wired`(사이드카 미배선 액션), `bridge_down`(main↔사이드카 전송 실패).
Cat-Talk main 추가 코드: `steam_trade_failed`(교환 요청 URI 형식 재확인 또는 `shell.openExternal` 실패. 사이드카 허용 목록과 무관하게 main이 만든다).

---

## 9. 상자 자동 오픈 IPC (Cat-Talk 추가, 사이드카 밖)

렌더러 ↔ Electron main. 패처 실행·게임 종료/재실행·백업/복원·플래그는 main이 맡는다(`electron/auto-chest.js`, 패처 `tools/auto_chest/`).

| 채널 | 방향 | 내용 |
|---|---|---|
| `chest:status(wanted)` | invoke | `{state, reason?}`. 판정만 한다(쓰기 없음). `wanted`는 설정 `auto_open_chest` 값 |
| `chest:enable()` | invoke | 설치돼 있으면 플래그만 생성. 아니면 사전 점검 → 카운트다운 → 설치. `{ok, reason?, rolledBack?}` |
| `chest:disable()` | invoke | 플래그 삭제 |
| `chest:reapply()` | invoke | 재적용 토스트의 [재시작]. 사전 점검을 통과하면 카운트다운 없이 바로 설치 흐름. 재적용이 필요한 상태가 아니면 아무것도 하지 않는다. 토스트 [X]는 `chest:disable` + 설정 끄기 |
| `chest:cancel` | send | 카운트다운 취소 |
| `chest:progress` | main → 렌더러 | `{phase, seconds?, reason?, rolledBack?}` |

- `state`: `not_installed`·`on`·`off`·`incompatible`·`needs_reapply`·`installing`·`no_game`·`error`·`patcher_mismatch`.
  - `patcher_mismatch`(D-029): 패처가 없거나(`reason: missing`) 앱이 기대하는 규약과 다름(`reason: mismatch`, `version` 명령 없음·값 다름·의존 DLL 누락 포함). 재적용으로는 못 고쳐 켜기·재적용을 막는다(끄기는 허용). prod는 앱 재설치, dev는 `tools/auto_chest/build.ps1`. 렌더러는 설정이 켜져 있으면 '앱 재설치가 필요합니다' 토스트를 띄운다([X] = 이번 실행 동안 숨김).
- `phase`: `checking`·`countdown`·`cancelled`·`stopping_worker`·`closing_game`·`patching`·`launching`·`verifying`·`done`·`failed`.
- 설치 순서: 구조 판정(패처 규약 포함) → 사전 점검(별도 파일에 패치·verify, 재적용이면 원본 백업 SHA도) → 카운트다운(켜기만) → 사이드카(worker) 종료 → 게임 종료 → Steam 해제 대기 → 백업(clean일 때만) → 패치·verify → 교체·재검증 → Steam 재실행 → 기동 확인 → 플래그 생성 → 사이드카 재시작. 사전 점검에 실패하면 worker·게임을 건드리지 않고 `failed`(`incompatible`·`preflight_failed`)로 끝난다. 교체 후 실패하면 백업으로 복원한다.
- 설정 저장은 기존 `setting` 액션(`auto_open_chest`)을 그대로 쓴다. 렌더러가 결과가 `ok`일 때만 저장한다.

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
