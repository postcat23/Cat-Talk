# 코드 서명

> 상태: 결정됨 — 공개 배포에서도 코드 서명을 하지 않는다(D-037, 2026-11-10).

## 서명 방식

<!-- sw:section id=signing-method source=- owner=user gate=no_placeholder -->
**코드 서명을 하지 않는다(미서명 빌드).** 토이·소규모 배포에 서명 인증서의 정기 지출은 과하다고 판단했다(D-037). electron-builder에 서명 설정을 넣지 않는다(현상 유지). 대신 README '설치 안내'에서 다음을 사실대로 안내한다.

- SmartScreen 경고([추가 정보] → [실행])와 '알 수 없는 게시자' 표시
- 백신 오탐 가능성
- 스마트 앱 컨트롤이 켜진 PC에서 차단될 수 있음

이전에는 공개 배포를 결정하면 서명 도입(upstream이 준비하던 OSS 무료 서명 SignPath 경로 포함)을 검토하기로 했었다.

## 인증서·키

<!-- sw:section id=signing-cert source=- owner=user gate=no_placeholder -->
보유한 인증서·서명 키가 없고, 서명을 하지 않기로 했으므로 마련하지 않는다.

## 검증

<!-- sw:section id=signing-verify source=- owner=user gate=no_placeholder -->
미서명 빌드라 서명 검증 절차는 없다. 자동 업데이트도 업데이트 파일의 서명을 검증하지 않는다(electron-updater 6.8.x는 `app-update.yml`에 `publisherName`이 없으면 서명 검증을 생략하고 해시만 검증, D-030). 그래서 업데이트 무결성은 GitHub Releases에서 HTTPS로 받는 `latest.yml`의 해시에 기댄다. 나중에 서명을 도입하면 앱·설치·제거 실행 파일에 서명을 적용하고, electron-builder가 `publisherName`을 기록해 업데이트 서명 검증이 켜진다.
