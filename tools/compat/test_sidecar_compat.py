"""1.0.8 ② 사이드카 쪽 검증: 호환 상태 알림(compat_status)과 worker 교체 요청(reload_compat).
실제 worker·Steam·게임 없이(offline 사이드카) 본다. 사용: py -3.11 tools/compat/test_sidecar_compat.py"""
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "sidecar"), str(ROOT / "src")]
import server  # noqa: E402

failed = 0


def check(name, ok, detail=""):
    global failed
    failed += not ok
    print(f"{'PASS' if ok else 'FAIL'} {name}{'  ' + detail if detail else ''}")


with tempfile.TemporaryDirectory() as tmp:
    sidecar = server.Sidecar(Path(tmp), offline=True)
    try:
        check("no status before a verdict", sidecar.compat_update() is None)
        sidecar.track_compat({"state": "checking", "unknown": [], "degraded": []})
        check("checking is not a verdict", sidecar.compat_update() is None)
        sidecar.track_compat({"state": "ready", "game_build": "26754239", "unknown": ["chat"], "degraded": ["chat_send"]})
        event = sidecar.compat_update()
        check("ready with unknown -> compat_status event",
              event == {"event": "compat_status", "build": "26754239", "unknown": ["chat"], "degraded": ["chat_send"]}, str(event))
        check("same status is not repeated", sidecar.compat_update() is None)
        sidecar.track_compat({"state": "unavailable", "unknown": [], "degraded": []})
        check("worker restart (unavailable) does not report 'all known'", sidecar.compat_update() is None)
        sidecar.track_compat({"state": "no_lobby", "game_build": "26754239", "unknown": [], "degraded": []})
        event = sidecar.compat_update() or {}
        check("recovered verdict -> event with empty unknown", event.get("unknown") == [] and event.get("degraded") == [], str(event))
        result = sidecar.request({"action": "reload_compat"}, 32)
        check("reload_compat accepted", result == {"ok": True}, str(result))
    finally:
        sidecar.close()

print(f"\n{failed} FAILED" if failed else "\nALL PASS")
sys.exit(1 if failed else 0)
