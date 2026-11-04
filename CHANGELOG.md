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

### Fixed

- 에러코드 화이트리스트 upstream 정합 + ipc-contract §8 정정
- 사이드카 stdin 상속으로 worker 초기화가 멈추던 문제 수정
