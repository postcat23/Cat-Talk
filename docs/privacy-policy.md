# 개인정보 처리 안내

> 상태: 작성됨. owner=user 섹션을 채웠다. docs-check로 충족 여부를 검증한다.

## 수집·저장 데이터

<!-- sw:section id=privacy-data source=src,lib,README.md owner=user gate=no_placeholder -->
Cat-Talk이 다루는 데이터는 다음과 같다.

- **수신 채팅**: 앱 실행 중 참여한 Bongo Cat 로비에서 받은 대화. 발신자 식별자(Steam ID 문자열), 표시 이름, 본문, 수신 시각.
- **내가 보낸 메시지**: 앱에서 전송한 문장과 전송 상태.
- **초안**: 로비별로 작성 중이던 입력.
- **설정**: 테마, 사이드바 접힘, 언어, 알림 on/off, 고양이 반응 효과 on/off.

진단 로그에는 기본적으로 채팅 본문·전체 사용자 ID·로비 입장 코드를 넣지 않는다. 별도 분석·추적 목적의 데이터 수집은 없다.

## 저장 위치·보관

<!-- sw:section id=privacy-storage source=- owner=user gate=no_placeholder -->
저장은 **휘발과 영속 두 계층**으로 분리한다.

- **휘발(메모리)**: 채팅·초안·세션·입퇴장 기록은 인메모리 데이터베이스에만 둔다. **앱을 종료하면 사라지며 디스크에 기록하지 않는다.** 검색·사이드바 로비 목록은 "이번 실행 세션" 범위로 한정된다. 앱 미실행 중의 대화나 종료 전 과거 대화를 서버에서 복원하는 기능은 없다.
- **영속(로컬 디스크)**: 설정만 `%LOCALAPPDATA%\CatTalk-dev\settings.sqlite3`에 저장해 재실행 후에도 유지한다. 채팅 차단 기능은 구현하지 않으므로 차단 목록을 저장하지 않는다.

모든 데이터는 사용자 본인 기기에 머문다. 별도 메시지 서버·클라우드 동기화·다른 메신저로의 전달은 없다. 렌더러는 채팅을 디스크에 영속하지 않는다(off-the-record).

## 외부 통신

<!-- sw:section id=privacy-network source=- owner=user gate=no_placeholder -->
Cat-Talk이 수행하는 외부 통신은 다음으로 한정된다.

- **Steam 로비 채팅**: 게임의 기존 Steam 로비 채팅 경로를 통해 메시지를 주고받는다. 별도 수신 포트를 열거나 HTTP 서버를 띄우지 않는다.
- **GitHub Release 자동 업데이트 확인**: 새 버전 확인·내려받기. 사용자가 끌 수 있다.

그 외의 외부 전송은 없다. 자동 상자깡(`bongo-cat-auto-chest`)은 **별도 도구**로 분리돼 있으며 이 앱의 통신 범위에 포함되지 않는다.