Imported from misosiruda/bongo-cat-chat @ 981dd43 (dev21). MIT.

**1.0.8부터 Cat Talk 소유 포크다(사용자 결정, 2026-11-19).** 업스트림 머지를 중단했으므로 이 디렉터리를 직접 고친다. 사이드카 글루(`sidecar/`)를 거쳐 우회하던 방식은 새 변경에 쓰지 않는다(기존 글루는 그대로 둔다).

## 원본과 다른 곳

- `lobby.py`(신규) · `worker.py` · `steam.py` — 현재 로비를 게임 메모리 대신 Steam에서 찾는다(리치 프레즌스 → `LAST_LOBBY` 레지스트리 → 로비 콜백 → 친구 게임 정보, '나 ∈ 멤버' 검증). worker는 메모리 탐색(`MemoryDiscovery`)을 하지 않는다. `steam_api64.dll`은 해시 대신 필요한 export를 확인한다(`steam.REQUIRED_EXPORTS`).
- `environment.py` · `service.py` — 호환성을 기능별로 판정한다(T0~T3 티어, 멈춘 게이트 `degraded`). 모르는 지문이 있어도 연결을 막지 않는다.
- `feature-contract.json` → `sidecar/compat/contract.json`(schema 2)으로 옮겼다. 1.0.7의 '원본 유지' 예외(세 번째 프로필 추가)는 이 이전으로 해소됐다.
- `memory.py`(Mono 런타임 읽기 층)는 그대로 남아 있다. 채팅 경로는 쓰지 않고, 연결되지 않은 자동 합성(`merge_install`)만 참조한다.
