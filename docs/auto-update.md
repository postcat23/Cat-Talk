# 자동 업데이트

> 상태: 작성됨(현황). 현재 미구성이며, 공개 배포를 결정할 때 이 문서를 갱신한다.

## 업데이트 채널

<!-- sw:section id=update-channel source=- owner=user gate=no_placeholder -->
현재 **자동 업데이트를 구성하지 않는다.** 개인 사용 단계라 수동 빌드·교체로 충분하다. upstream bongo-cat-chat은 GitHub Release에 올라온 정식 버전을 내려받는 자동 업데이트를 쓰며, Cat-Talk도 공개 배포를 결정하면 GitHub Release 채널 도입을 검토한다.

## 적용·롤백

<!-- sw:section id=update-apply source=- owner=user gate=no_placeholder -->
현재는 수동 재빌드라 별도의 적용·롤백 절차가 없다. 자동 업데이트를 도입하면 upstream 방식(내려받기 준비 완료 후 안내를 거쳐 앱 재시작으로 적용, 입력·전송·저장 상태 확인과 초안 보존, 서명·해시 재검사)을 참고해 적용·롤백 흐름을 설계한다.