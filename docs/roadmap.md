# 개발·검증 계획

> 상태: 작성됨. owner=user 섹션을 채웠다. docs-check로 충족 여부를 검증한다.

## 현재 상태

<!-- sw:section id=roadmap-current source=- owner=user gate=no_placeholder -->
Cat-Talk은 upstream [misosiruda/bongo-cat-chat](https://github.com/misosiruda/bongo-cat-chat)(Python/Qt, dev21 기준)을 **Electron + React + Python 사이드카** 구조로 재구성하는 포크다. 현재는 **기획·설계 단계이며 코드 포팅은 시작 전**이다. 스택 결정, IPC 계약서(dev21 `981dd43` 실측), 로컬 저장소의 휘발/영속 분할 설계까지 확정했다. 1차 목표는 공개 배포가 아니라 **본인 기기에서 동작하는 작동물**이며, 공개 여부는 개인 사용·테스트 이후 판단한다.

## 확인된 것과 남은 것

<!-- sw:section id=roadmap-status source=- owner=user gate=min_items:1 -->
**확인된 것**

- 스택: Electron(셸) + React(렌더러) + Python 사이드카(네이티브·서비스·저장 계층 유지). Windows 전용. Flutter는 모바일 부재·웹 UI 재사용 손실로 제외.
- IPC 계약: renderer↔controller(요청/응답, 600ms `view` 폴링)와 controller↔worker(큐) 2층 경계를 dev21 소스에서 실측해 문서화.
- 저장 모델: 채팅·초안·세션은 휘발(앱 종료 시 소멸, 디스크 미기록), 설정만 영속. 채팅 차단은 미구현(글루에서 무력화).
- 기능 범위: 아이템 자동 합성은 인-프로세스(디스크 무수정)라 Cat-Talk에 포함. 자동 상자깡은 디스크 패치라 별도 도구로 분리(B 방식: 실행·설정만 연동).

**남은 것**

- Electron 셸 + 파이썬 사이드카 스켈레톤(IPC 계약을 stdio로 구현).
- `ui/app.js` → React 포팅.
- 패키징(PyInstaller 사이드카 + electron-builder, DLL 로드 경로·권한).
- 다른 PC 인수, 코드 서명, 공개 배포 여부 결정(현재 보류).

## 다음 단계

<!-- sw:section id=roadmap-next source=- owner=user gate=min_items:1 -->
1. **셸 교체** — Electron 셸 + 파이썬 사이드카 기동. 사이드카가 IPC 계약의 `view`/명령을 stdio로 받아 응답하고, 기존 기능이 그대로 동작하는지 확인한다.
2. **UI 포팅** — `ui/app.js`를 React로 옮긴다. 600ms `view` 폴링 모델은 1차에서 그대로 유지(동작 보존).
3. **패키징** — PyInstaller로 사이드카를 묶고 electron-builder로 설치본을 만든다. 메모리 읽기에 필요한 `steam_api64.dll`·Mono 런타임 접근 경로와 권한을 보장한다.
4. **인수·배포** — 다른 PC에서의 동작 인수. 코드 서명·공개 배포는 개인 테스트 결과를 보고 결정(현재 보류).