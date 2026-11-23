"""플로팅 아바타(1.0.10) 사이드카 쪽 검증: view의 last_speaker(대화 목록에 보이는 마지막 채팅의 발화자, 본인 포함).
실제 worker·Steam·게임 없이(offline 사이드카 + 가짜 상태 이벤트) 본다. 사용: py -3.11 tools/floating/test_last_speaker.py

입퇴장 행 제외 · 검색 중·HISTORY(limit 1)에도 같은 값 · 내 메시지(own) · 앱 차단하면 그 사람 앞 발화자 · Steam 차단도 제외 ·
저장 못 한 메시지(volatile)가 마지막이면 그것 · 로비가 바뀌면 None."""
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "sidecar"), str(ROOT / "src")]
import server  # noqa: E402

ME, A, B = "76561198000000001", "76561198000000002", "76561198000000003"
LOBBY, OTHER = "109775241000000001", "109775241000000002"
failed = 0


def check(name, ok, detail=""):
    global failed
    failed += not ok
    print(f"{'PASS' if ok else 'FAIL'} {name}{'  ' + detail if detail else ''}")


def state(members, lobby=LOBBY, steam_blocked=()):
    profiles = {uid: {"name": f"name-{uid[-1]}", **({"steam_blocked": uid in steam_blocked} if uid != ME else {})}
                for uid in (ME, A, B)}
    return {"type": "state", "account": ME, "lobby": lobby, "generation": "g1", "connected": True, "lobby_verified": True,
            "send_enabled": True, "name": "lobby", "members": list(members), "profiles": profiles}


def say(sidecar, sender, text, seq=[0]):
    seq[0] += 1
    event = {"type": "message", "context": sidecar.service.context(), "id": f"m{seq[0]}", "sender": sender, "text": text}
    sidecar.service.receive(event)
    return event["id"]


def speaker(sidecar, **args):
    result = sidecar.request({"action": "view", **args}, 64)
    return result.get("last_speaker", "missing")


with tempfile.TemporaryDirectory() as tmp:
    sidecar = server.Sidecar(Path(tmp), offline=True)
    try:
        check("no account/lobby -> None", speaker(sidecar) is None, str(speaker(sidecar)))
        sidecar.service.update(state([ME, A, B]))
        check("lobby without chat (presence rows only) -> None", speaker(sidecar) is None, str(speaker(sidecar)))

        a1 = say(sidecar, A, "hello")
        got = speaker(sidecar)
        check("peer message -> that peer", got == {"id": a1, "sender": A, "name": "name-2", "own": False}, str(got))
        m1 = say(sidecar, ME, "mine")
        got = speaker(sidecar)
        check("own message -> me (own true)", got and got["sender"] == ME and got["own"] is True and got["id"] == m1, str(got))
        b1 = say(sidecar, B, "from b")
        check("latest peer wins", (speaker(sidecar) or {}).get("id") == b1)

        sidecar.service.update(state([ME, A]))   # B leaves → member_left row is the newest timeline row
        tail = sidecar.request({"action": "view", "limit": 1}, 64)["messages"]
        check("(setup) newest timeline row is B's member_left", tail and tail[-1].get("kind") == "member_left", str(tail))
        check("presence row after it does not replace the speaker", (speaker(sidecar) or {}).get("id") == b1)
        check("HISTORY poll (limit 1) still reports it", (speaker(sidecar, limit=1) or {}).get("id") == b1)
        check("search with no match still reports it", (speaker(sidecar, query="zzz-no-match") or {}).get("id") == b1)
        check("search matching an older line still reports the latest", (speaker(sidecar, query="hello") or {}).get("id") == b1)

        sidecar.service.update(state([ME, A, B]))
        block = sidecar.request({"action": "block_user", "account": ME, "steam_id": B, "blocked": True}, 128)
        check("app block accepted", "error" not in block, str(block))
        check("app-blocked sender is skipped -> previous visible (me)", (speaker(sidecar) or {}).get("id") == m1, str(speaker(sidecar)))
        sidecar.request({"action": "block_user", "account": ME, "steam_id": B, "blocked": False}, 128)
        check("unblocked -> back to that sender", (speaker(sidecar) or {}).get("id") == b1)

        a2 = say(sidecar, A, "again")
        check("new peer message", (speaker(sidecar) or {}).get("id") == a2)
        sidecar.service.update(state([ME, A, B], steam_blocked=(A,)))
        check("Steam-blocked sender is skipped", (speaker(sidecar) or {}).get("id") == b1, str(speaker(sidecar)))
        sidecar.service.update(state([ME, A, B]))
        check("Steam unblock -> back", (speaker(sidecar) or {}).get("id") == a2)

        # 저장 실패(volatile): 마지막 저장 행보다 뒤라 그것이 마지막 발화자다. 다음 저장 메시지가 오면 그쪽이 마지막
        add = sidecar.store.add
        sidecar.store.add = lambda *a, **k: (_ for _ in ()).throw(sqlite3.OperationalError("disk"))
        v1 = say(sidecar, B, "unsaved")
        sidecar.store.add = add
        got = speaker(sidecar)
        check("unsaved (volatile) newest message -> its sender", (got or {}).get("id") == v1 and got["sender"] == B, str(got))
        m2 = say(sidecar, ME, "saved after")
        check("later saved message wins over the unsaved one", (speaker(sidecar) or {}).get("id") == m2, str(speaker(sidecar)))

        sidecar.service.update(state([ME, A, B], lobby=OTHER))
        check("other lobby -> None", speaker(sidecar) is None, str(speaker(sidecar)))
    finally:
        sidecar.close()

print(f"\n{failed} FAILED" if failed else "\nALL PASS")
sys.exit(1 if failed else 0)
