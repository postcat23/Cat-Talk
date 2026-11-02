# Cat-Talk

Bongo Cat 게임의 로비 채팅을 데스크톱 메신저처럼 읽고 쓰는 **Windows용 서드파티 앱**. [misosiruda/bongo-cat-chat](https://github.com/misosiruda/bongo-cat-chat)(Python/Qt)를 **Electron + React + Python 사이드카** 구조로 재구성하는 포크입니다.

> **상태: 초기 기획 단계.** 이 저장소는 아직 비어 있으며 본 README가 첫 문서입니다. 아래 아키텍처는 확정된 방향이되 코드 포팅은 시작 전입니다.

- 현재 Steam 계정이 참여한 Bongo Cat 로비의 채팅을 하나의 메신저 UI에서 읽고 보냅니다. 상대방은 이 앱을 설치할 필요가 없습니다.
- 실행 중 수신한 대화를 로컬(SQLite)에 저장하고 스크롤·검색으로 다시 봅니다.
- 게임 파일을 수정하거나 게임 내부에 모듈을 주입하지 않습니다. 읽기와 송신만 합니다.

## 원본과의 관계 · 라이선스

- 원본: [misosiruda/bongo-cat-chat](https://github.com/misosiruda/bongo-cat-chat) — MIT License, © 2026 Bongo Cat Chat contributors.
- 본 저장소는 **원저자의 허가를 받아 포크**했으며 MIT 라이선스를 유지합니다.
- 원본과 마찬가지로 **게임 개발사의 공식 제품이 아니며 승인된 연동도 아닙니다.** 게임 이름·이미지·외부 의존성의 권리는 각 권리자에게 있습니다.

## 기술 선택 근거

이 앱의 진짜 자산은 UI가 아니라 **검증된 네이티브 연동 계층**입니다.

- Steamworks(Heathen) FFI + 게임 프로세스 메모리 읽기(Mono 런타임 워킹) + 프로토콜 처리로 구성됩니다. 특정 게임 빌드의 내부 타입(`Assembly-CSharp`, `Heathen.Steamworks`)과 `steam_api64.dll`·Mono 런타임에 바인딩되어 **윈도우 + 해당 빌드에 종속**됩니다.
- 이 계층은 Dart/JS 생태계에 선례가 거의 없어 재작성·재검증이 사실상 불가능에 가깝습니다. → **파이썬 워커를 사이드카로 그대로 유지합니다.**
- 원본 UI는 이미 웹입니다(Qt WebEngine + QWebChannel + `ui/app.js`). → 셸만 Electron으로 바꾸고 `app.js`를 React로 포팅하면 UI 자산을 재사용합니다.
- 앱이 로컬 게임·윈도우·메모리 읽기에 묶여 모바일이 원천적으로 불가능합니다. → Flutter의 "단일 코드베이스" 강점이 적용되지 않습니다. 그래서 Flutter 대신 Electron + React를 택했습니다.

## 계획 아키텍처

```
  React 렌더러            Electron main ──── IPC ──── Python 사이드카
 (ui/app.js 포팅)  ◀────▶  (창·수명주기·                (worker / service / store)
                           사이드카 관리)                      │
                                                   Steam FFI · Mono 메모리 읽기 · SQLite
```

| 레이어 | 처리 |
|---|---|
| Electron main | 창·수명주기·단일 인스턴스(`requestSingleInstanceLock`)·사이드카 프로세스 관리 |
| React 렌더러 | 메신저 화면 (원본 `ui/app.js` 포팅) |
| IPC | main ↔ 파이썬 사이드카 (stdio JSON 라인 또는 로컬 소켓). 원본 QWebChannel 메서드를 IPC 계약으로 번역 |
| Python 사이드카 | 원본 네이티브·서비스·저장 계층 유지: `steam.py`·`memory.py`·`worker.py`·`service.py`·`protocol.py`·`store.py` 등 |
| 저장 | 초기엔 SQLite를 파이썬 사이드카가 그대로 소유(스키마·울음 필터 재검증 회피) |
| 알림 | WinRT 토스트 → Electron Notification 이전 검토 (AUMID 재배선) |

## 기능 범위

원본 `feature-contract.json` 기준. 포팅 단계에서는 **동작 보존**을 원칙으로 전부 유지하고, 취사선택은 안정화 이후 별도 결정합니다.

- **채팅 송수신** (`channel 3`, `SendSpeech` / `OnLobbyChatMsg`) — 코어
- **로비 검증** (`LobbyData.Current`) — 송신 대상 정확성에 묶여 사실상 코어
- **숨김 동기화** (`PlayerDataCache.IsHidden`) — 제품 스펙상 필수. 가장 취약(게임 업데이트 시 재검증)
- **프로필·외형** (`Nickname` / `Hat` / `Skin`) — 코스메틱. 프루닝 시 1순위 드롭 후보

## 비목표

- 게임 내 캐릭터 위 말풍선 표시 ✕
- 게임 파일 수정·모듈 주입 ✕
- 앱 미실행 중의 과거 대화를 서버에서 복원 ✕ (첫 범위는 실제 수신해 로컬 저장한 기록)

## 요구 환경 · 한계

- Windows x64, Steam 실행, Bongo Cat 설치. `steam_api64.dll`·Mono 런타임에 접근합니다.
- 게임 프로세스 메모리를 읽으므로 게임 업데이트 시 주소·타입 구조 재검증이 필요합니다. 게임의 이용약관·안티치트 정책과의 관계는 사용자가 직접 검토해야 합니다.
- "다른 PC에서의 동작"과 패키징(파이썬 런타임 동봉)은 미검증 과제입니다.

## 로드맵 (초안)

1. **셸 교체** — Electron 셸 + 파이썬 사이드카 기동, 기존 기능 그대로 동작 확인
2. **UI 포팅** — `ui/app.js` → React
3. **패키징** — PyInstaller(사이드카) + electron-builder, DLL 로드 경로·권한
4. **인수·배포** — 다른 PC 인수, 코드 서명, 배포 검토

## 라이선스

MIT. 원본 저작권 표기를 유지합니다. 의존성 고지는 포팅 진행에 따라 추가합니다.

## 🔗 참조

- 노션 문서 hub: https://app.notion.com/p/40c27a4323c98138acd1f98d60c8982c

## 📜 변경 이력

| 작성일 | 버전 | 내용 | 관련 링크 |
| --- | --- | --- | --- |
| 261102 | 1.0.0 | 최초 작성 — 프로젝트 개요·기술 선택 근거·계획 아키텍처·로드맵 |  |
