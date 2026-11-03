# 코드 서명

> 상태: 작성됨(현황). 현재 미적용이며, 공개 배포를 결정할 때 이 문서를 갱신한다.

## 서명 방식

<!-- sw:section id=signing-method source=- owner=user gate=no_placeholder -->
현재 **코드 서명을 적용하지 않는다(미서명 빌드).** 개인 사용·테스트 단계라 서명이 필수가 아니며, 공개 배포를 보류한 상태다. 공개를 결정하면 Windows 코드 서명을 도입해 SmartScreen 경고·변조 위험을 줄일지 검토한다. upstream은 OSS 대상 무료 서명(SignPath) 신청을 준비 중이며, 도입 시 그 경로를 참고한다.

## 인증서·키

<!-- sw:section id=signing-cert source=- owner=user gate=no_placeholder -->
현재 보유한 인증서·서명 키가 없다. 공개 배포를 결정하면 선택지를 검토한다: OSS 프로젝트 대상 무료 서명(SignPath 등) 또는 자체 코드 서명 인증서. 키 보관·CI 연동 방식은 그 시점에 확정한다.

## 검증

<!-- sw:section id=signing-verify source=- owner=user gate=no_placeholder -->
미서명 빌드이므로 현재 서명 검증 절차는 없다. 서명을 도입하면 앱·설치·제거 실행 파일에 서명을 적용하고, 배포 전 서명·해시 검증 절차를 수립한다.