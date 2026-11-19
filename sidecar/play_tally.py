"""경고·공개수배(D-052)와 칭찬(1.0.8)이 함께 쓰는 집계·발동 상태 기계. 사이드카 메인 스레드 전용(Steam·큐 없음 — 쓰기는 queue 콜백).

로비 전원의 cattalk 멤버 데이터로 대상별 총횟수를 세고(warns.tally), THRESHOLD에 닿은 대상의 발동(경고 = 공개수배, 칭찬 = 칭찬 도장)을
로비·대상·발동 시각마다 한 번 띄운다. 발동되면 기여자는 자기 항목을 지우고 발동 표식을 남기는 쓰기를 worker로 보낸다(consume).
내가 꺼져 있던 동안 발동된 내 옛 항목(다른 사람의 표식보다 오래됨)도 같은 쓰기로 정리한다. 종류마다 다른 것은 프로필 키·worker 명령·
진단 표식 이름뿐이다(칭찬은 경고의 거울 — 사용자 명세 2026-11-19). 경고 쪽 이름·이벤트 id는 1.0.7까지와 같다.
"""
import time
from collections import OrderedDict

import warns as model
from diag import mark

# 합계 3으로 띄운 뒤 이 시간 안에 오는 같은 대상의 발동 표식은 같은 발동으로 본다(기여자마다 표식을 따로 씀)
MARKER_GRACE = 5.0
MAX_FIRED = 256      # 이미 띄운 발동 기억 상한(오래된 것부터 잊는다)
MAX_EVENTS = 16      # 렌더러가 아직 받아 가지 않은 발동 상한


class PlayTally:
    """kind: "warn" | "praise". count_key·marker_key = worker 프로필 원문 키, add_op·consume_op = worker cattalk 명령,
    data_mark·fire_mark·markers_label = 진단 표식 이름. events는 view가 한 번 받아 간다([{id, target}]), failed는 쓰기 실패 수."""

    def __init__(self, kind, count_key, marker_key, add_op, consume_op, data_mark, fire_mark, markers_label):
        self.kind, self.count_key, self.marker_key = kind, count_key, marker_key
        self.add_op, self.consume_op = add_op, consume_op
        self.data_mark, self.fire_mark, self.markers_label = data_mark, fire_mark, markers_label
        self.id_prefix = "" if kind == "warn" else f"{kind}:"   # 경고 id는 예전 그대로, 칭찬은 경고 id와 섞이지 않게
        self.counts = {}         # 대상 → 총횟수(현재 로비 멤버, 0 제외)
        self.events = []         # 렌더러가 다음 view에서 한 번 받아 갈 발동 [{id, target}]
        self.fired = OrderedDict()   # 이미 띄운 발동(로비:대상:발동 시각) — 같은 발동을 두 번 띄우지 않는다
        self.failed = 0          # 렌더러에 알릴 누적(+1) 쓰기 실패 수(다음 view에서 받아 간다)
        self.diag_last = None    # 진단 표식: 마지막으로 남긴 데이터 수신 요약(바뀔 때만 남긴다)
        # 발동 표식으로 놓친 발동 잡기: 기준 로비, 표식을 이미 한 번 본 멤버, 대상별로 아는 가장 늦은 발동 시각
        self.base_lobby = None
        self.base_members = set()
        self.seen_cut = {}
        self.last = {}           # 대상 → (마지막으로 띄운 발동 시각, 띄운 때 monotonic) — 두 경로가 같은 발동을 두 번 띄우지 않게

    def update(self, state, queue):
        """state = worker 상태(계정·로비·멤버·프로필). queue(op) = worker로 정리 쓰기를 보낸다(사이드카 queue_cattalk)."""
        account, lobby = state.get("account", ""), state.get("lobby", "")
        members = set(state.get("members") or [])
        if not (account and lobby and state.get("lobby_verified")):
            self.counts = {}
            return
        profiles = state.get("profiles") or {}
        data = {}
        for uid, profile in profiles.items():
            if uid in members and isinstance(profile, dict) and self.count_key in profile:
                data[uid] = (model.parse_warns(profile.get(self.count_key)), model.parse_wanted(profile.get(self.marker_key)))
        tally = model.tally(data)
        self.counts = {target: row["count"] for target, row in tally.items() if target in members}
        self.diagnose(account, members, profiles, data, tally)
        mine = data.get(account)
        for target, row in tally.items():
            if row["count"] < model.THRESHOLD:
                continue
            fired = self.fire(lobby, target, row["last"], members, "count", count=row["count"],
                              mine=bool(mine and target in mine[0]), self_target=target == account,
                              contributors=sum(1 for entries, _ in data.values() if target in entries and entries[target][1] > row["cut"]))
            if fired and mine and target in mine[0]:
                queue({"op": self.consume_op, "target": target, "when": row["last"]})
        self.detect(lobby, account, members, data)
        if mine:
            for target, when in model.stale(mine[0], model.cuts(data)).items():
                if target in members:
                    queue({"op": self.consume_op, "target": target, "when": when})

    def fire(self, lobby, target, when, members, via, **diag):
        """발동을 한 번 띄운다(같은 발동 = 로비·대상·발동 시각은 한 번만). 새로 띄웠으면 True.
        via: count = 합계가 3인 순간을 직접 봄, marker = 그 순간을 놓쳤지만 새 발동 표식을 봄."""
        key = f"{lobby}:{target}:{when}"
        if key in self.fired:
            return False
        mark(self.fire_mark, via=via, shown=target in members, **diag)
        self.fired[key] = True
        while len(self.fired) > MAX_FIRED:
            self.fired.popitem(last=False)
        self.last[target] = (max(when, self.last.get(target, (0, 0.0))[0]), time.monotonic())
        if target in members:
            self.events.append({"id": self.id_prefix + key, "target": target})
            del self.events[:-MAX_EVENTS]
        return True

    def detect(self, lobby, account, members, data):
        """발동 표식으로 놓친 발동을 띄운다.
        합계 3은 발동한 기여자가 0.3초쯤 뒤 바로 정리해 사라지므로, 1초마다 읽는 다른 클라이언트는 그 순간을 놓칠 수 있다(1.0.4 실측).
        표식은 로비에 남으므로 '이미 알던 멤버의 표식이 대상의 발동 시각을 앞으로 밀었다' = 새 발동으로 보고 띄운다.
        켜질 때·로비를 옮길 때·새 멤버 데이터가 처음 보일 때 이미 있던 표식은 지난 발동이라 기준으로만 삼는다.
        옛 항목 정리(stale)가 남기는 표식은 이미 아는 발동 시각과 같아 앞으로 밀지 않으므로 띄우지 않는다."""
        if self.base_lobby != lobby:
            self.base_lobby, self.base_members, self.seen_cut, self.last = lobby, set(), {}, {}
        known = {uid: entry for uid, entry in data.items() if uid in self.base_members}
        now = time.monotonic()
        for target, when in model.cuts(known).items():
            if when <= self.seen_cut.get(target, 0):
                continue
            last_when, last_at = self.last.get(target, (0, 0.0))
            if when <= last_when or now - last_at < MARKER_GRACE:
                continue   # 합계 3으로 이미 띄운 같은 발동(다른 기여자의 표식이 몇 초 늦게·조금 다른 시각으로 와도)
            self.fire(lobby, target, when, members, "marker", self_target=target == account)
        for target, when in model.cuts(data).items():
            self.seen_cut[target] = max(self.seen_cut.get(target, 0), when)
        self.base_members = (self.base_members | set(data)) & members

    def diagnose(self, account, members, profiles, data, tally):
        """진단 표식(D-050·D-052): 멤버 데이터 수신 상태를 개수로만, 바뀔 때만 남긴다(ID·이름·값은 넣지 않는다).
        others_with_data가 0에서 늘면 다른 클라이언트가 쓴 값이 Steam을 거쳐 여기 도착한 것이다."""
        unread = sum(1 for uid in members if not isinstance(profiles.get(uid), dict) or self.count_key not in profiles[uid])
        malformed = sum(1 for uid, (entries, markers) in data.items()
                        if ((profiles[uid].get(self.count_key) or "").strip() not in ("", "{}") and not entries)
                        or ((profiles[uid].get(self.marker_key) or "").strip() not in ("", "{}") and not markers))
        others = [uid for uid, (entries, markers) in data.items() if uid != account and (entries or markers)]
        summary = {
            "members": len(members), "unread": unread, "malformed": malformed,
            "own_entries": len(data.get(account, ({}, {}))[0]),
            "others_with_data": len(others), "others_entries": sum(len(data[uid][0]) for uid in others),
            self.markers_label: sum(len(markers) for _, markers in data.values()),
            "targets": len(tally), "max_count": max((row["count"] for row in tally.values()), default=0),
        }
        if summary != self.diag_last:
            self.diag_last = summary
            mark(self.data_mark, **summary)


def warn_tally():
    return PlayTally("warn", "cattalk_warns", "cattalk_wanted", "warn", "consume", "warn_data", "wanted_fire", "wanted_markers")


def praise_tally():
    return PlayTally("praise", "cattalk_praise", "cattalk_praised", "praise", "praise_consume", "praise_data", "praised_fire",
                     "praised_markers")
