# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/lang/ko/).

## [Unreleased]

### Added

- `README` — 프로젝트 개요와 Electron + React + Python 사이드카 포팅 계획 문서 추가
- Electron 셸 + 파이썬 사이드카 스텁 IPC 루프 추가
- upstream bongo-cat-chat dev21(981dd43) 소스 import
- 사이드카 오프라인 실제 배선 (ChatService/Store) + IPC id 버그 수정
- 실제 worker 활성화 (spawn + poll 루프 + 종료 정리)
- compatibility 툴체인 import(tools/) + artifacts gitignore
- store 휘발 분할(VolatileStore 글루) + 차단 무력화 (D-003)
- 렌더러 Vite+React 스캐폴드 (툴체인·bridge 증명)
- `renderer` — 목업 기반 UI 컴포넌트 포팅 (정적·목데이터, 브라우저 확인)
- 실제 앱 아이콘으로 창·favicon·드로어 로고 교체
- `renderer` — 상단바 재구성 및 상자 자동 오픈 카드 추가
- `renderer` — 상자 자동 오픈 켜기/끄기 버튼화
- `electron` — 끝 도크·프레임리스·항상위 창 + 설정 연동/클릭통과
- `electron` — 트레이(작업표시줄 숨김 연동)·창 위치 영속
- `renderer` — 참여자 실루엣·프로필/닫기 한 줄·오버레이 높이 규칙 반전
- `renderer` — 참여자 실루엣 둥근 귀·소형 높이에서 오버레이 시 입력창 숨김

### Fixed

- 에러코드 화이트리스트 upstream 정합 + ipc-contract §8 정정
- 사이드카 stdin 상속으로 worker 초기화가 멈추던 문제 수정
