# 배포 운영

> 상태: 작성됨(현황). 공개 배포는 보류 중이며, 결정 시 이 문서를 갱신한다.

## 배포 대상·채널

<!-- sw:section id=dist-target source=- owner=user gate=no_placeholder -->
현재 Cat-Talk은 **공개 배포를 하지 않는다.** 1차 목표는 본인 기기에서의 개인 사용·테스트이며, 일반 배포 여부는 그 결과를 보고 판단한다. upstream bongo-cat-chat은 불특정 이용자 대상 무료 배포를 지향하지만, Cat-Talk은 그 방향을 그대로 승계하지 않고 보류 상태로 둔다.

공개를 결정할 경우 고려할 점: Cat-Talk은 아이템 자동 합성(인-프로세스 게임 자동화)을 포함하므로, 순수 메신저보다 배포 시 성격이 무겁다(게임 이용약관·안티치트 관계를 이용자가 직접 검토해야 함). 상자 자동 오픈도 별도 도구가 아니라 **앱에 포함된 선택 기능**으로 배포된다. 기본값은 꺼짐이며, 사용자가 켜면 게임 파일을 디스크에서 수정하므로 같은 검토 대상이다.

## 패키지

<!-- sw:section id=dist-package source=packaging owner=user gate=no_placeholder -->
Electron 셸은 **electron-builder NSIS 설치본**(Windows x64, 원클릭·사용자별 설치 `%LOCALAPPDATA%\Programs\cat-talk`, 시작 메뉴 바로가기만, 게시자 `postcat23`, 서명 없음)으로 묶는다(D-030). `npm run dist`가 `dist/Cat-Talk-Setup-<버전>.exe`와 업데이트 메타데이터(`latest.yml`)를 만든다. 실행·읽기 파일은 asar 밖 `resources/`에 둔다: 사이드카 번들 `sidecar-bin/`, 호환성 도구 `artifacts/compatibility`, 상자 자동 오픈 패처 `artifacts/auto_chest`, 설치 사전 점검이 읽는 `src/bongo_chat/feature-contract.json`, 라이선스·고지 파일. 설치본과 dev는 데이터 폴더(`%LOCALAPPDATA%\CatTalk`)와 사용자 폴더(`%APPDATA%\Cat Talk`, 단일 실행 잠금)를 공유한다(둘이 함께 켜져 사이드카가 둘 붙지 않게, D-030·D-041).

파이썬 사이드카는 **PyInstaller onedir 번들**(`resources/sidecar-bin/cattalk-sidecar.exe`, 창 없음)로 설치본에 들어가 **설치 PC에 Python이 없어도 된다**(D-036). `npm run dist`·`release`가 먼저 `scripts/build-sidecar.ps1`을 돌린다: 빌드 PC의 Python 3.11(py 런처)로 전용 venv(`artifacts/sidecar-build/venv`)를 만들어 PyInstaller 6.22.3으로 `artifacts/sidecar/`에 번들을 만든다(전제: `tools/prepare-compatibility.ps1`로 호환성 도구 빌드). FMOD는 런타임 훅으로 빼고(THIRD-PARTY-NOTICES 3절), Qt·PySide6는 들어가지 않는다. 번들 크기 41MB, 설치본은 127.6MB에서 143.0MB(+15.4MB)로 늘었다(2026-11-10). 자동 업데이트는 설치본을 통째로 바꾸므로 사이드카도 함께 갱신된다. 소스 실행(dev·빌드 후 `npm start`)은 계속 시스템 Python 3.11을 쓴다. 설치본은 게임 메모리 읽기에 필요한 `steam_api64.dll`·Mono 런타임 접근 경로와 권한을 보장해야 한다. 게임 DLL과 백업은 배포물에 포함하지 않는다.

## 공개 배포 체크리스트

<!-- sw:section id=dist-checklist source=- owner=user gate=min_items:1 -->
레포를 공개하고 배포를 시작할 때 확인한다. 레포가 비공개인 동안에는 GitHub Releases 채널이 동작하지 않아 시험할 수 없는 항목도 여기에 둔다.

- [x] 코드 서명 — 안 함으로 결정(토이·소규모, D-037). README '설치 안내'의 SmartScreen 안내로 대체한다. 업데이트는 서명 검증 없이 해시만 확인한다(`code-signing.md`, D-030).
- [x] 사이드카 PyInstaller 번들 — Python 3.11이 없는 PC에서도 실행되게 한다(위 '패키지', D-036). 2026-11-10 완료: 설치본 +15.4MB. 수락 시험은 PATH에서 Python·py 런처를 뺀 환경에서 설치본을 실행해, 연결·아바타·채팅·게임 패치 기능을 확인했다(Python 프로세스 없음). Python이 아예 설치되지 않은 다른 PC에서의 확인은 남아 있다.
- [x] 데이터 폴더 이름 정리 — 데이터 `%LOCALAPPDATA%\CatTalk-dev` → `%LOCALAPPDATA%\CatTalk`, 사용자 폴더(실행 잠금) `%APPDATA%\cat-talk` → `%APPDATA%\Cat Talk`(productName). dev와 설치본은 계속 함께 쓴다. 옛 폴더는 옮기지 않는다(D-041).
- [ ] '앱 재설치가 필요합니다' 토스트에 [재설치] 버튼 — 사이드카의 호환성 검사 파일 누락 안내와 묶을지도 정한다(D-029).
- [ ] 언패치/삭제 시 `CatTalkHidden.ids` 정리 — 차단 멤버 고양이 숨김 목록이 게임 폴더에 남는다(앱을 꺼도 유지, D-033 3단계). 패치를 되돌리거나 앱을 지울 때 함께 지운다. 패치를 되돌릴 때는 원본 복원(D-038)이 지운다. 앱을 지울 때 정리하는 부분은 남아 있다.
- [ ] 첫 릴리스 — `npm run release`(빌드 PC에 `GH_TOKEN`)로 올라간 초안 릴리스를 게시하고, 같은 버전이 설치된 앱의 드로어에 '최신'이 뜨는지 확인한다(`auto-update.md`).
- [ ] 실제 업데이트 루프 — 이전 버전 설치 → 새 버전 게시 → 백그라운드 내려받기 → '새 버전 v… 준비됨' 토스트·드로어 '업데이트 가능' → [업데이트](사이드카 정상 종료 → 조용히 설치 → 재실행) → 드로어 버전 확인. [업데이트]를 누르지 않고 앱을 정상 종료했을 때 설치되는 경로와, 설치하지 않은 채 다시 켰을 때(강제 종료 등) 토스트가 한 번 더 뜨는지도 확인한다(D-030·D-039).