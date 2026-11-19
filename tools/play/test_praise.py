"""칭찬(1.0.8, 경고의 거울) 사이드카·worker 로직 검증 — 실제 Steam·게임 없이(가짜 상태·가짜 Steam) 본다.
누적·로비 합집합·3회 발동(한 번만)·기여자별 정리(리셋)·놓친 발동(표식 경로)·옛 항목 정리·경고와 독립·자기 칭찬 거절·명령 차단.
사용: py -3.11 tools/play/test_praise.py"""
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "sidecar"), str(ROOT / "src")]
import warns as model  # noqa: E402
from play_tally import praise_tally, warn_tally  # noqa: E402

failed = 0
ME, A, B, C, T = "76561198000000001", "76561198000000002", "76561198000000003", "76561198000000004", "76561198000000005"
LOBBY = "109775240000000001"


def check(name, ok, detail=""):
    global failed
    failed += not ok
    print(f"{'PASS' if ok else 'FAIL'} {name}{'  ' + detail if detail else ''}")


def state(profiles, members=None, account=ME, lobby=LOBBY, verified=True):
    return {"account": account, "lobby": lobby, "lobby_verified": verified,
            "members": list(members if members is not None else profiles), "profiles": profiles}


def row(praise=None, praised=None, warns=None, wanted=None):
    """멤버 프로필: 칭찬·경고 원문(dump 형식)."""
    return {"cattalk_praise": model.dump_warns(praise or {}), "cattalk_praised": model.dump_wanted(praised or {}),
            "cattalk_warns": model.dump_warns(warns or {}), "cattalk_wanted": model.dump_wanted(wanted or {})}


# ── 누적·합집합·3회 발동·리셋 ──
tally, queued = praise_tally(), []
q = queued.append
tally.update(state({ME: row({T: (1, 100)}), A: row(), T: row()}), q)
check("1 praise -> count 1, no fire", tally.counts == {T: 1} and not tally.events)
tally.update(state({ME: row({T: (1, 100)}), A: row({T: (1, 101)}), T: row()}), q)
check("union across contributors -> 2", tally.counts == {T: 2} and not tally.events)
tally.update(state({ME: row({T: (2, 102)}), A: row({T: (1, 101)}), T: row()}), q)
check("3 (two from me) -> fires once", tally.counts == {T: 3} and len(tally.events) == 1 and tally.events[0]["target"] == T,
      str(tally.events))
check("praise event id is prefixed (separate from wanted ids)", tally.events[0]["id"] == f"praise:{LOBBY}:{T}:102")
check("my entries consumed (reset), op praise_consume at fire time", queued == [{"op": "praise_consume", "target": T, "when": 102}], str(queued))
tally.events.clear()
tally.update(state({ME: row({T: (2, 102)}), A: row({T: (1, 101)}), T: row()}), q)
check("same fire not shown twice", not tally.events)
# 기여자가 각자 정리: 항목을 지우고 표식을 남긴다 → 합계 0
after = {ME: row({}, {T: 102}), A: row({}, {T: 102}), T: row()}
tally.update(state(after), q)
check("after consume -> count reset to 0", T not in tally.counts and not tally.events)
tally.update(state({ME: row({T: (1, 110)}, {T: 102}), A: row({}, {T: 102}), T: row()}), q)
check("new praise after reset counts from 1", tally.counts == {T: 1})

# ── 놓친 발동: 합계 3의 순간을 못 봤지만 아는 멤버의 새 표식 ──
late, lq = praise_tally(), []
late.update(state({ME: row(), A: row({T: (2, 200)}), B: row(), T: row()}), lq.append)    # 기준
late.update(state({ME: row(), A: row({}, {T: 203}), B: row({}, {T: 203}), T: row()}), lq.append)
check("late observer fires via marker once", len(late.events) == 1 and late.events[0]["target"] == T, str(late.events))
late.events.clear()
late.update(state({ME: row(), A: row({}, {T: 203}), B: row({}, {T: 203}), T: row()}), lq.append)
check("marker path does not repeat", not late.events)

# ── 꺼져 있던 동안 발동된 내 옛 항목은 정리 ──
stale, sq = praise_tally(), []
stale.update(state({ME: row({T: (1, 300)}), A: row({}, {T: 305}), T: row()}), sq.append)
check("my stale entry (older than marker) is consumed", sq == [{"op": "praise_consume", "target": T, "when": 305}], str(sq))

# ── 경고와 독립 ──
w, p, wq, pq = warn_tally(), praise_tally(), [], []
mixed = state({ME: row(praise={T: (2, 400)}, warns={A: (1, 401)}), B: row(praise={T: (1, 402)}, warns={A: (1, 403)}), A: row(), T: row()})
w.update(mixed, wq.append)
p.update(mixed, pq.append)
check("warn tally ignores praise data", w.counts == {A: 2} and not w.events)
check("praise tally ignores warn data", p.counts == {T: 3} and len(p.events) == 1 and pq[0]["op"] == "praise_consume")
check("warn ids unchanged (no prefix)", warn_tally().id_prefix == "" and praise_tally().id_prefix == "praise:")
not_ready = praise_tally()
not_ready.counts = {T: 2}
not_ready.update(state({ME: row({T: (2, 1)})}, verified=False), [].append)
check("unverified lobby clears counts", not_ready.counts == {})

# ── 사이드카: 명령·차단·진단·설정 ──
import server  # noqa: E402

with tempfile.TemporaryDirectory() as tmp:
    sidecar = server.Sidecar(Path(tmp), offline=True)
    try:
        ctx = {"account": ME, "lobby": LOBBY, "generation": 1}
        sidecar.service.context = lambda: ctx
        sidecar.service.state = {"account": ME, "lobby": LOBBY, "lobby_verified": True, "members": [ME, A]}
        check("praise self -> praise_self (no write)", sidecar.request({"action": "praise", "context": ctx, "target": ME}, 64) == {"error": "praise_self"})
        check("praise non-member -> praise_unavailable", sidecar.request({"action": "praise", "context": ctx, "target": B}, 64) == {"error": "praise_unavailable"})
        check("warn self still allowed (D-052)", sidecar.request({"action": "warn", "context": ctx, "target": ME}, 64) == {"ok": True})
        check("praise member -> queued", sidecar.request({"action": "praise", "context": ctx, "target": A}, 64) == {"ok": True}
              and any(op[2] == {"op": "praise", "target": A} for op in sidecar.warn_ops.values()))
        check("'@x 칭찬!' is never sent as chat", sidecar.request({"action": "send", "context": ctx, "text": "@누구 칭찬!"}, 64) == {"error": "praise_command"})
        check("praised_display accepted", sidecar.request({"action": "praised_display", "result": "shown"}, 64) == {"ok": True})
        check("play_praise setting defaults on", server.UI_SETTINGS["play_praise"][0] is True and sidecar.ui_settings().get("play_praise") is True)
        check("praise raw data stays internal", {"cattalk_praise", "cattalk_praised"} <= server.INTERNAL_PROFILE_KEYS)
    finally:
        sidecar.close()

# ── worker 쓰기(가짜 Steam) ──
import steam_warns  # noqa: E402
from bongo_chat import worker as worker_module  # noqa: E402

steam_warns.install()


class FakeSteam:
    def __init__(self):
        self.data, self.clock = {}, 1000

    def _member_data(self, lobby, uid, key):
        return self.data.get((lobby, uid, key), "")

    def set_member_data(self, lobby, key, value):
        self.data[(lobby, ME, key)] = value

    def server_time(self):
        self.clock += 1
        return self.clock


conn = object.__new__(worker_module.LiveConnection)
conn.read_only, conn.generation, conn.profile_time, conn.steam = False, 1, 5, FakeSteam()
conn.destination = lambda: (ME, LOBBY, {ME, A}, True, True)
ctx = {"account": ME, "lobby": LOBBY, "generation": 1}
send = lambda op: conn.send({"type": "send", "id": "cattalk-x", "cattalk": op, "context": ctx})   # noqa: E731
check("worker praise +1 writes cattalk.praise", send({"op": "praise", "target": A}) == "accepted"
      and model.parse_warns(conn.steam.data[(LOBBY, ME, model.PRAISE_KEY)]) == {A: (1, 1001)})
check("worker praise does not touch warns", (LOBBY, ME, model.WARNS_KEY) not in conn.steam.data)
check("worker rejects self praise (no write)", send({"op": "praise", "target": ME}) == "failed"
      and model.parse_warns(conn.steam.data[(LOBBY, ME, model.PRAISE_KEY)]) == {A: (1, 1001)})
check("worker praise_consume clears + marks", send({"op": "praise_consume", "target": A, "when": 1001}) == "accepted"
      and model.parse_warns(conn.steam.data[(LOBBY, ME, model.PRAISE_KEY)]) == {}
      and model.parse_wanted(conn.steam.data[(LOBBY, ME, model.PRAISED_KEY)]) == {A: 1001})
check("worker warn still writes cattalk.warns", send({"op": "warn", "target": ME}) == "accepted"
      and model.parse_warns(conn.steam.data[(LOBBY, ME, model.WARNS_KEY)])[ME][0] == 1)
check("worker unknown op rejected", send({"op": "nope", "target": A}) == "failed")

print(f"\n{failed} FAILED" if failed else "\nALL PASS")
sys.exit(1 if failed else 0)
