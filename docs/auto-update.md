# 자동 업데이트

> 상태: 작성됨(현황). 설치본 자동 업데이트를 구성했다(D-030, 2026-11-09). 레포가 비공개인 동안은 확인이 실패하며, 공개 배포를 결정할 때 이 문서를 갱신한다.

## 업데이트 채널

<!-- sw:section id=update-channel source=- owner=user gate=no_placeholder -->
설치본(NSIS)은 **electron-updater**로 **GitHub Releases**(`postcat23/Cat-Talk`, `package.json`의 `build.publish`)를 채널로 쓴다. dev(`npm start`)는 업데이트를 확인하지 않는다. upstream bongo-cat-chat도 GitHub Release 채널을 쓴다.

- 확인: 앱을 켤 때와 6시간마다. 새 버전은 백그라운드로 내려받는다.
- 레포가 비공개인 동안은 토큰이 없어 확인이 실패한다(의도한 동작). 실패는 알리지 않고, 드로어는 '최신'이라고 단정하지 않고 버전만 보여 준다. 레포를 공개하면 설정을 바꾸지 않아도 동작한다.
- 게시: `npm run release`(`electron-builder --publish always`, 빌드 PC에 `GH_TOKEN` 필요)는 GitHub에 초안(draft) 릴리스를 올린다. 초안을 게시해야 설치본이 내려받는다. 로컬 빌드만 할 때는 `npm run dist`(게시 안 함).

## 적용·롤백

<!-- sw:section id=update-apply source=- owner=user gate=no_placeholder -->
내려받기가 끝나면 드로어 '앱 업데이트'에 '업데이트 가능'과 [업데이트]가 보인다. [업데이트]는 사이드카(worker)를 정상 종료한 뒤 조용히 설치하고 앱을 다시 실행한다. 누르지 않아도 다음에 앱을 정상 종료할 때 설치된다.

- 메시지를 보내는 중이면 끝날 때까지 [업데이트]를 막는다. 입력창에 쓰던 글이 있으면(앱을 끄면 사라지는 설계, D-024) '입력 중인 글은 사라집니다' 확인 카드에서 한 번 더 [업데이트]를 눌러야 적용한다.
- 서명하지 않은 설치본은 업데이트 파일의 서명 검증을 하지 않는다(electron-updater 6.8.x는 `app-update.yml`에 `publisherName`이 없으면 생략하고 해시만 검증한다). 서명을 도입하면 electron-builder가 `publisherName`을 기록해 검증이 켜진다.
- 롤백: 자동 롤백은 없다. 문제가 있으면 이전 버전 설치 파일(GitHub Releases)로 수동 설치한다. 데이터 폴더(`%LOCALAPPDATA%\CatTalk-dev`)는 설치·업데이트와 별개로 유지된다.
