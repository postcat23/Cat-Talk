<img src="renderer/src/assets/app-icon.png" width="72" alt="Cat Talk 아이콘">

# Cat-Talk

![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white) ![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB) ![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white)

Bongo Cat 로비 채팅을 데스크톱 메신저처럼 읽고 쓰는 Windows 서드파티 앱.

- 현재 Steam 계정이 참여한 Bongo Cat 로비의 채팅을 하나의 메신저 UI에서 읽고 보냅니다. 상대방은 이 앱을 설치할 필요가 없습니다.
- 받은 대화는 스크롤·검색으로 다시 봅니다. 대화는 앱을 켜 둔 동안 메모리에만 두며, 종료하면 사라집니다.
- 기본 기능(채팅)은 게임 메모리 읽기와 송신만 합니다. 상자 자동 오픈·모든 고양이 투명화·차단한 사람 고양이 숨김 같은 선택 기능은 켤 때 게임 파일(`Assembly-CSharp.dll`)을 패치합니다. 패치 전에 원본을 백업하고, 기능을 끄면 동작만 멈추며 패치된 파일은 남습니다(원본은 Steam '게임 파일 무결성 확인'으로 다시 받을 수 있습니다). 게임 이용약관·안티치트 정책과의 관계는 사용자 책임입니다.

## 원본과의 관계 · 라이선스

- 원본: [misosiruda/bongo-cat-chat](https://github.com/misosiruda/bongo-cat-chat) — MIT License, © 2026 Bongo Cat Chat contributors.
- 본 저장소는 **원저자의 허가를 받아 원본(Python/Qt)을 클론해 Electron + React + Python 사이드카 구조로 재구성**했습니다. Cat-Talk 자체 코드는 PolyForm Noncommercial License 1.0.0([LICENSE](LICENSE))을 따르고, upstream 봉고캣챗(bongo-cat-chat)에서 온 코드는 MIT를 유지합니다([THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES.md)). "Cat Talk" 이름·아이콘·로고는 라이선스 대상이 아닙니다([NOTICE](NOTICE)).
- 원본과 마찬가지로 **게임 개발사의 공식 제품이 아니며 승인된 연동도 아닙니다.** 게임 이름·이미지·외부 의존성의 권리는 각 권리자에게 있습니다.

## 기술 선택 근거

| 선택 기술 | 이유 |
|---|---|
| Electron + React 셸 | 메신저 화면을 웹 기술로 만들어 데스크톱 창·트레이로 제공. 모바일이 불가능해 크로스플랫폼 프레임워크의 이점이 없음 |
| Python 사이드카 유지 | 검증된 Steam 연동·게임 메모리 읽기 계층(Python)을 다시 쓰지 않고 그대로 사용 |
| Windows 전용 | 로컬 게임 프로세스·`steam_api64.dll`·Mono 런타임에 묶여 있어 다른 OS·모바일은 지원 불가 |

## 아키텍처

```
React 렌더러  ◀── IPC ──▶  Electron main  ◀── stdio JSON ──▶  Python 사이드카
```

| 레이어 | 처리 |
|---|---|
| Electron main | 창·트레이·단일 인스턴스, 사이드카 실행(시스템 Python 3.11), 자동 업데이트, 선택 기능의 게임 패치 관리 |
| React 렌더러 | 메신저 화면(대화·참여자·반응 카드·설정 드로어) |
| IPC | main ↔ 사이드카 stdio JSON 라인([docs/ipc-contract.md](docs/ipc-contract.md)) |
| Python 사이드카 | Steam 연동·게임 메모리 읽기·채팅 서비스. 대화는 메모리에만, 설정만 디스크에 저장 |

## 주요 기능

- 로비 채팅 읽기·보내기, 대화 스크롤·검색(이번 실행 동안)
- 참여자 목록·프로필, 닉네임 변경(내 화면에만), 차단(앱 차단 + Steam '모든 대화 차단' 반영)
- 반응(선물·이모트) 카드, 안 읽은 수 배지·팝업 알림·트레이 표시
- 선택 기능(게임 패치): 상자 자동 오픈, 모든 고양이 투명화, 차단한 사람 고양이 숨김
- 자동 업데이트(GitHub Releases)

## 비목표

- 게임 내 캐릭터 위 말풍선 표시 ✕
- 앱 미실행 중의 과거 대화를 서버에서 복원 ✕

## 요구 환경 · 한계

- Windows x64, Steam 실행, Bongo Cat 설치. `steam_api64.dll`·Mono 런타임에 접근합니다.
- 게임 프로세스 메모리를 읽으므로 게임 업데이트 시 주소·타입 구조 재검증이 필요합니다. 게임의 이용약관·안티치트 정책과의 관계는 사용자가 직접 검토해야 합니다.
- 설치본에는 Python이 들어 있지 않습니다. Python 3.11과 사이드카 패키지(`sidecar/requirements.txt`)를 따로 설치해야 합니다.
- 개발 환경이 없는 다른 PC에서의 동작은 아직 확인하지 않았습니다.

## 라이선스

- **Cat-Talk 자체 코드:** [PolyForm Noncommercial License 1.0.0](LICENSE). 비상업 목적(개인 사용 등)의 사용·수정·재배포는 허용하고, 상업적 이용은 허용하지 않습니다. 조건은 LICENSE 원문을 따릅니다.
- **이름·아이콘·로고:** 라이선스 대상이 아니며 모든 권리를 유보합니다. 아래 'Trademarks/브랜딩'과 [NOTICE](NOTICE) 참고.
- **upstream 봉고캣챗(bongo-cat-chat) 유래 코드:** MIT를 유지하고 원본 저작권 표기도 그대로 둡니다. 대상 파일 목록은 [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES.md).
- **그 밖의 서드파티 구성요소(번들 의존성·폰트 등):** 각자의 원래 라이선스를 따릅니다. 원문은 [LICENSES/](LICENSES/).

## Trademarks/브랜딩

"Cat Talk" 이름, 앱 아이콘, 로고는 본 라이선스(LICENSE)의 대상이 아니며 모든 권리를 유보합니다. 허용된 비상업 포크·재배포라도 이 이름·아이콘·로고는 쓸 수 없고 리브랜딩해야 합니다.

- 대상 파일: `electron/app-icon.ico`, `renderer/src/assets/app-icon.png`, `renderer/src/assets/favicon.ico`
- `src/bongo_chat/ui`의 upstream 아이콘은 MIT 자산이라 대상이 아닙니다.
- 한·영 전문: [NOTICE](NOTICE)
