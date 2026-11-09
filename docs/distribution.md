# 배포 운영

> 상태: 작성됨(현황). 공개 배포는 보류 중이며, 결정 시 이 문서를 갱신한다.

## 배포 대상·채널

<!-- sw:section id=dist-target source=- owner=user gate=no_placeholder -->
현재 Cat-Talk은 **공개 배포를 하지 않는다.** 1차 목표는 본인 기기에서의 개인 사용·테스트이며, 일반 배포 여부는 그 결과를 보고 판단한다. upstream bongo-cat-chat은 불특정 이용자 대상 무료 배포를 지향하지만, Cat-Talk은 그 방향을 그대로 승계하지 않고 보류 상태로 둔다.

공개를 결정할 경우 고려할 점: Cat-Talk은 아이템 자동 합성(인-프로세스 게임 자동화)을 포함하므로, 순수 메신저보다 배포 시 성격이 무겁다(게임 이용약관·안티치트 관계를 이용자가 직접 검토해야 함). 상자 자동 오픈도 별도 도구가 아니라 **앱에 포함된 선택 기능**으로 배포된다. 기본값은 꺼짐이며, 사용자가 켜면 게임 파일을 디스크에서 수정하므로 같은 검토 대상이다.

## 패키지

<!-- sw:section id=dist-package source=packaging owner=user gate=no_placeholder -->
Electron 셸은 **electron-builder NSIS 설치본**(Windows x64, 원클릭·사용자별 설치 `%LOCALAPPDATA%\Programs\cat-talk`, 시작 메뉴 바로가기만, 게시자 `postcat23`, 서명 없음)으로 묶는다(D-030). `npm run dist`가 `dist/Cat-Talk-Setup-<버전>.exe`와 업데이트 메타데이터(`latest.yml`)를 만든다. 실행·읽기 파일(사이드카 `sidecar/`, upstream 소스 `src/`, 호환성 도구 `artifacts/compatibility`, 상자 자동 오픈 패처 `artifacts/auto_chest`)은 asar 밖 `resources/`에 레포와 같은 상대 위치로 넣어, 사이드카 코드는 경로를 바꾸지 않는다. 설치본과 dev는 데이터 폴더(`%LOCALAPPDATA%\CatTalk-dev`)와 단일 실행 잠금을 공유한다(둘이 함께 켜져 사이드카가 둘 붙지 않게).

파이썬 사이드카는 아직 번들하지 않아 **설치 PC에 Python 3.11(py 런처)과 `sidecar/requirements.txt` 패키지가 필요**하다. Python 없는 PC를 위한 **PyInstaller** 번들은 공개 배포 단계에서 한다. 설치본은 게임 메모리 읽기에 필요한 `steam_api64.dll`·Mono 런타임 접근 경로와 권한을 보장해야 한다. 게임 DLL과 백업은 배포물에 포함하지 않는다.