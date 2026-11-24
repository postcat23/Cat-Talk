"""문구 트리거 이벤트(1.0.10) 사이드카 쪽 검증: 드로어 '플레이 > 이벤트 모션' 설정(play_event)의 기본값·저장·검증.
효과 판정·재생은 렌더러만 한다(로컬 발동 — tools/play/test-event.js). 실제 Steam·게임 없이(offline 사이드카) 본다.
사용: py -3.11 tools/play/test_event_setting.py"""
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO / "sidecar"), str(REPO / "src")]
import server  # noqa: E402

failed = 0


def check(name, ok, detail=""):
    global failed
    if not ok:
        failed += 1
    print(f"{'PASS' if ok else 'FAIL'} {name}{'  ' + str(detail) if detail else ''}")


with tempfile.TemporaryDirectory() as tmp:
    sidecar = server.Sidecar(Path(tmp), offline=True)
    try:
        ui = sidecar.request({"action": "view"}, 64).get("ui_settings") or {}
        check("default play_event = true (기본 켜기)", ui.get("play_event") is True, ui)
        check("other play toggles unchanged", ui.get("play_warn") is True and ui.get("play_praise") is True, ui)
        r = sidecar.request({"action": "setting", "key": "play_event", "value": False}, 64)
        check("set play_event false accepted", r.get("ok") is True, r)
        ui = sidecar.request({"action": "view"}, 64).get("ui_settings") or {}
        check("play_event false persisted", ui.get("play_event") is False, ui)
        # 잘못된 값은 거절(invalid_setting은 렌더러로 넘길 오류 목록 밖이라 request_failed로 온다 — 다른 설정과 같다), 저장값은 그대로
        r = sidecar.request({"action": "setting", "key": "play_event", "value": "off"}, 64)
        ui = sidecar.request({"action": "view"}, 64).get("ui_settings") or {}
        check("non-bool rejected, stored value unchanged", "error" in r and ui.get("play_event") is False, r)
        sidecar.request({"action": "setting", "key": "play_event", "value": True}, 64)
        ui = sidecar.request({"action": "view"}, 64).get("ui_settings") or {}
        check("back to true", ui.get("play_event") is True, ui)
    finally:
        sidecar.close()

print(f"\n{failed} FAILED" if failed else "\nALL PASS")
sys.exit(1 if failed else 0)
