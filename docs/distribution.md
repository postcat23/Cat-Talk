# 배포 운영

> 상태: 작성됨(현황). 공개 배포는 보류 중이며, 결정 시 이 문서를 갱신한다.

## 배포 대상·채널

<!-- sw:section id=dist-target source=- owner=user gate=no_placeholder -->
현재 Cat-Talk은 **공개 배포를 하지 않는다.** 1차 목표는 본인 기기에서의 개인 사용·테스트이며, 일반 배포 여부는 그 결과를 보고 판단한다. upstream bongo-cat-chat은 불특정 이용자 대상 무료 배포를 지향하지만, Cat-Talk은 그 방향을 그대로 승계하지 않고 보류 상태로 둔다.

공개를 결정할 경우 고려할 점: Cat-Talk은 아이템 자동 합성(인-프로세스 게임 자동화)을 포함하므로, 순수 메신저보다 배포 시 성격이 무겁다(게임 이용약관·안티치트 관계를 이용자가 직접 검토해야 함). 자동 상자깡은 별도 도구로 분리돼 이 배포물에 포함되지 않는다.

## 패키지

<!-- sw:section id=dist-package source=packaging owner=user gate=no_placeholder -->
패키징은 아직 구성 전이다(코드 포팅 미시작). 계획하는 방식: 파이썬 사이드카를 **PyInstaller**로 번들하고, Electron 셸을 **electron-builder**로 Windows x64 설치본으로 묶는다. 설치본은 게임 메모리 읽기에 필요한 `steam_api64.dll`·Mono 런타임 접근 경로와 권한을 보장해야 한다. 구체적 산출물·서명은 패키징 단계에서 확정한다.