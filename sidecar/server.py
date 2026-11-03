"""스텁 사이드카: stdin/stdout JSON 라인으로 IPC 계약을 흉내낸다.
아직 bongo_chat을 연결하지 않는다 — 전송 경로만 증명한다.
요청: {"id": <int>, "args": {"action": "...", ...}}  응답: {"id": <int>, "result": {...}}
"""
import sys, json, time, itertools

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
_rev = itertools.count(1)

def handle(args):
    if args.get("action") == "view":
        return {
            "stub": True, "ts": time.time(), "revision": next(_rev),
            "context": {"account": "", "lobby": "", "generation": ""},
            "state": "checking", "connected": False, "messages": [], "rooms": [],
        }
    return {"ok": True, "stub": True, "echo": args.get("action")}

def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            out = {"id": req.get("id"), "result": handle(req.get("args", {}))}
        except Exception:
            out = {"id": None, "result": {"error": "sidecar_exception"}}
        sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
        sys.stdout.flush()

if __name__ == "__main__":
    main()
