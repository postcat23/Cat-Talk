<img src="renderer/src/assets/app-icon.png" width="72" alt="Cat Talk 아이콘">

# Cat-Talk

![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white) ![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB) ![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white) [![Release](https://img.shields.io/github/v/release/postcat23/Cat-Talk?logo=github&logoColor=white)](https://github.com/postcat23/Cat-Talk/releases/latest)

Bongo Cat 로비 채팅을 데스크톱 메신저처럼 읽고 쓰는 Windows 서드파티 앱.

[⬇ 최신 버전 다운로드](https://github.com/postcat23/Cat-Talk/releases/latest)

⚠ 서명되지 않은 앱이라 설치 시 Windows 보안 경고가 뜹니다 — [설치](#설치) 참고.

## 주요 기능

- 지금 Steam 계정이 참여한 Bongo Cat 로비의 채팅을 메신저 화면에서 읽고 보냅니다. 상대방은 이 앱을 설치할 필요가 없습니다.
- 대화 스크롤·검색. 대화는 앱을 켜 둔 동안 메모리에만 두며, 종료하면 사라집니다.
- 참여자 목록·프로필, 닉네임 변경(내 화면에만), 차단(앱 차단 + Steam '모든 대화 차단' 반영)
- 반응(선물·이모트) 카드, 안 읽은 수 배지·팝업 알림·트레이 표시
- 선택 기능(게임 패치, 기본 꺼짐): 상자 자동 오픈, 모든 고양이 투명화, 차단한 사람 고양이 숨김
  - 켤 때 게임 파일(`Assembly-CSharp.dll`)을 패치하고, 패치 전에 원본을 백업합니다.
  - 패치를 쓰는 기능을 모두 끄면 앱이 [원본 복원]을 제안합니다. Steam '게임 파일 무결성 확인'으로도 원본을 다시 받을 수 있습니다.
  - 게임 이용약관·안티치트 정책과의 관계는 사용자 책임입니다.
- 자동 업데이트(GitHub Releases)

## 설치

- **요구 환경:** Windows 10/11 64비트(x64), Steam, Bongo Cat. 설치본은 Python 등 별도 설치 없이 단독 실행됩니다(관리자 권한 불필요).
- [최신 릴리스](https://github.com/postcat23/Cat-Talk/releases/latest)에서 `Cat-Talk-Setup-<버전>.exe`를 받아 실행합니다.
- **보안 경고:** 서명되지 않은 앱이라 SmartScreen 'Windows의 PC 보호'가 뜨면 [추가 정보] → [실행]을 누릅니다. '알 수 없는 게시자'로 보이는 것도 같은 이유입니다. 백신 오탐이나 Windows 11 '스마트 앱 컨트롤' 차단이 있을 수 있습니다.
- 자세한 설치·업데이트 안내 → [docs/installation.md](docs/installation.md)

## 원본 · 라이선스

- 원본 [misosiruda/bongo-cat-chat](https://github.com/misosiruda/bongo-cat-chat)(MIT)을 원저자의 허가를 받아 클론해 재구성했습니다. 게임 개발사의 공식 제품이 아니며 승인된 연동도 아닙니다.
- 라이선스는 다음과 같습니다.
  - Cat-Talk 자체 코드: PolyForm Noncommercial 1.0.0(비상업 사용)
  - 원본에서 온 코드: MIT 유지
  - "Cat Talk" 이름·아이콘·로고: 라이선스 대상이 아니며 권리를 유보합니다.
- 자세한 내용: [LICENSE](LICENSE) · [NOTICE](NOTICE) · [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES.md)

## 문서

- [docs/architecture.md](docs/architecture.md) — 구조: 기술 선택 근거, 구성요소, 데이터 흐름, 기술 한계
- [docs/installation.md](docs/installation.md) — 설치·첫 사용·업데이트
- [docs/ipc-contract.md](docs/ipc-contract.md) — 프로세스 간 메시지 계약
