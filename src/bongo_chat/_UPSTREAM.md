Imported from misosiruda/bongo-cat-chat @ 981dd43 (dev21). MIT. 이 디렉터리는 upstream 동기화를 위해 원본 경로·내용을 유지한다. 수정은 여기 말고 사이드카 글루(sidecar/)에서 한다.

## 원본과 다른 곳(동기화 때 유지·대조)

- `feature-contract.json` `profiles[2]`(세 번째 프로필) — 2026-11-19 게임 빌드 26754239 대응. upstream에 이 빌드용 프로필이 아직 없어(마지막 계약 변경 b147836, 빌드 26364842) 여기서 추가했다. 사이드카 번들과 설치 사전 점검(electron/auto-chest.js)이 같은 파일을 쓰므로 글루로 옮기지 않았다. 기존 두 프로필·검사기·네이티브 해시는 그대로다. 지문 다섯 개는 FeatureProbe로 실측했고, lobby·privacy만 바뀌었다(privacy: `LobbyMemberInstance.set_IsHidden`이 고양이 끄기를 축소 애니메이션 `AnimatedSetActive`로 바꿈 등, lobby: Heathen.Steamworks 쪽 변경). upstream이 같은 빌드 프로필을 내면 같은 값인지 대조해 하나만 남긴다.
