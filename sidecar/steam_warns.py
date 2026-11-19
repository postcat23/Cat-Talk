"""worker 글루(D-052 경고·공개수배): Cat Talk 전용 로비 멤버 데이터(cattalk.warns·cattalk.wanted)를 읽고 쓴다.

upstream steam.py/worker.py는 수정하지 않는다(steam_relationship 선례: 모듈 전역 이름을 서브클래스로 바꿔 끼운다).
upstream은 로비 쓰기를 하지 않는 원칙(worker.close 주석 'No LeaveLobby, joins or lobby setting mutations')인데, 이 기능은
사용자 결정으로 그 원칙에서 벗어나 '내 멤버 데이터의 cattalk.* 키'만 쓴다. 게임 키(hat·skin 등)·로비 데이터·채팅 채널은 건드리지 않는다.

- 읽기: 멤버 프로필(약 1초마다)에 cattalk_warns·cattalk_wanted 원문을 싣는다. 집계는 사이드카가 한다(warns.tally).
- 쓰기: 사이드카가 큐로 보내는 send 명령 중 "cattalk" 필드가 있는 것만 여기서 처리한다(채팅 1초 제한·echo와 무관한 경로).
  {"op": "warn", "target"} = 내 경고 +1, {"op": "consume", "target", "when"} = 처형 시각까지의 내 항목 정리 + 표식.
  쓰기 직전에 내 현재 값을 Steam에서 다시 읽어 고친다(사이드카 사본에 기대지 않는다). 연결 대상(계정·로비·세대)이 명령과 다르면 failed.
- 진단 표식(worker.log): 거절 사유 코드, 쓴 키 수·바이트, 쓴 직후 다시 읽은 값이 같은지(로컬 확인 — 상대 도착 여부는 사이드카 warn_data가 본다).

플레이리스트 공유(D-053, /플리)도 같은 길을 쓴다: 프로필에 cattalk_pl 원문을 싣고, {"op": "pl_add" | "pl_remove", "id"}로
내 cattalk.pl을 고친다(쓰기 직전에 Steam에서 다시 읽음). 로비 전체 중복 검사는 차단을 아는 사이드카가 하고, 여기서는 내 목록의
상한(10)·중복만 본다. 결과 상태: accepted / failed / pl_full / pl_exists.
재입장 복원 {"op": "pl_restore", "entries": [[영상, 시각], …]}은 지금 내 cattalk.pl이 비었을 때만 그대로(원래 등록 시각) 쓴다.

칭찬(1.0.8, 경고의 거울)도 같은 길이다: 프로필에 cattalk_praise·cattalk_praised 원문을 싣고, {"op": "praise"} = 내 칭찬 +1,
{"op": "praise_consume", "target", "when"} = 칭찬 도장 발동 시각까지의 내 항목 정리 + 표식. 경고와 키만 다르다(TALLY_KEYS).
"""
import ctypes as C
import json

from bongo_chat import worker as worker_module

import playlist
import warns as model
from diag import mark

CATTALK_OPS = ("warn", "consume", "praise", "praise_consume", "pl_add", "pl_remove", "pl_restore")
PLAYLIST_OPS = ("pl_add", "pl_remove", "pl_restore")
# 누적·발동 표식 명령 → (누적 키, 표식 키, 누적 +1인가). 경고와 칭찬은 키만 다르고 같은 함수로 고친다
TALLY_KEYS = {
    "warn": (model.WARNS_KEY, model.WANTED_KEY, True), "consume": (model.WARNS_KEY, model.WANTED_KEY, False),
    "praise": (model.PRAISE_KEY, model.PRAISED_KEY, True), "praise_consume": (model.PRAISE_KEY, model.PRAISED_KEY, False),
}


def install():
    base_steam = worker_module.Steam

    class SteamWarnAware(base_steam):
        def _member_data(self, lobby, uid, key):
            if not hasattr(self, "_get_member_data"):
                self._get_member_data = self.bind("ISteamMatchmaking_GetLobbyMemberData", C.c_char_p, C.c_void_p, C.c_uint64, C.c_uint64, C.c_char_p)
            value = self._get_member_data(self.matchmaking, int(lobby), int(uid), key.encode())
            return (value or b"").decode("utf-8", "replace")

        def set_member_data(self, lobby, key, value):
            if not hasattr(self, "_set_member_data"):
                self._set_member_data = self.bind("ISteamMatchmaking_SetLobbyMemberData", None, C.c_void_p, C.c_uint64, C.c_char_p, C.c_char_p)
            self._set_member_data(self.matchmaking, int(lobby), key.encode(), value.encode())

        def server_time(self):
            if not hasattr(self, "_server_time"):
                self._server_time = self.bind("ISteamUtils_GetServerRealTime", C.c_uint32, C.c_void_p)
            return int(self._server_time(self.utils))

        def profile(self, lobby, uid):
            row = super().profile(lobby, uid)
            try:
                row["cattalk_warns"] = self._member_data(lobby, uid, model.WARNS_KEY)
                row["cattalk_wanted"] = self._member_data(lobby, uid, model.WANTED_KEY)
                row["cattalk_praise"] = self._member_data(lobby, uid, model.PRAISE_KEY)
                row["cattalk_praised"] = self._member_data(lobby, uid, model.PRAISED_KEY)
                row["cattalk_pl"] = self._member_data(lobby, uid, playlist.KEY)
            except Exception:
                pass   # 읽지 못하면 이 멤버의 경고·칭찬·플리만 빠진다(채팅은 그대로)
            return row

    worker_module.Steam = SteamWarnAware

    base_live = worker_module.LiveConnection

    class LiveWarnAware(base_live):
        def send(self, command):
            op = command.get("cattalk")
            if op is None:
                return super().send(command)
            try:
                return self._cattalk(command, op)
            except Exception as exc:
                mark("warn_write_error", error=type(exc).__name__)
                return "failed"   # 연결이 바뀌는 중이면 다음 스냅숏이 처리한다. 쓰기 실패로 연결을 흔들지 않는다

        def _cattalk(self, command, op):
            kind = op.get("op") if isinstance(op, dict) and op.get("op") in CATTALK_OPS else "invalid"
            label = "playlist_write_rejected" if kind in PLAYLIST_OPS else "warn_write_rejected"
            if self.read_only or not isinstance(op, dict):
                mark(label, op=kind, reason="read_only" if self.read_only else "bad_op")
                return "failed"
            account, lobby, members, valid, verified = self.destination()
            current = {"account": account, "lobby": lobby, "generation": self.generation}
            target = op.get("target")
            if not verified or command.get("context") != current or (kind not in PLAYLIST_OPS and target not in members):
                mark(label, op=kind,
                     reason="unverified" if not verified else "context" if command.get("context") != current else "target")
                return "failed"
            if kind in PLAYLIST_OPS:
                return self._playlist(lobby, account, kind, op)
            steam = self.steam
            if kind not in TALLY_KEYS:
                mark("warn_write_rejected", op=kind, reason="bad_op")
                return "failed"
            if kind == "praise" and target == account:
                mark("warn_write_rejected", op=kind, reason="self")   # 자기 칭찬 금지(사용자 명세) — 사이드카도 막지만 쓰기 직전 한 번 더
                return "failed"
            count_key, marker_key, adding = TALLY_KEYS[kind]
            own_counts = model.parse_warns(steam._member_data(lobby, account, count_key))
            own_markers = model.parse_wanted(steam._member_data(lobby, account, marker_key))
            written = {}
            if adding:
                cut = max((model.parse_wanted(steam._member_data(lobby, uid, marker_key)).get(target, 0) for uid in members), default=0)
                updated = model.apply_warn(own_counts, target, steam.server_time(), cut)
                written[count_key] = model.dump_warns(updated)
            elif type(op.get("when")) is int and op["when"] > 0:
                counts, markers = model.apply_consume(own_counts, own_markers, target, op["when"])
                if counts != own_counts:
                    written[count_key] = model.dump_warns(counts)
                if markers != own_markers:
                    written[marker_key] = model.dump_wanted(markers)
            else:
                mark("warn_write_rejected", op=kind, reason="bad_op")
                return "failed"
            for key, value in written.items():
                steam.set_member_data(lobby, key, value)
            readback = all(steam._member_data(lobby, account, key) == value for key, value in written.items())
            mark("warn_write", op=kind, keys=len(written), bytes=sum(len(v.encode()) for v in written.values()),
                 readback=readback, self_target=target == account)
            self.profile_time = 0   # 다음 틱에 프로필을 다시 읽어 사이드카가 바뀐 값을 곧 본다
            return "accepted"

        def _playlist(self, lobby, account, kind, op):
            """내 cattalk.pl에 영상 하나 추가·삭제, 또는 재입장 복원(D-053). 쓰기 직전 Steam의 내 값을 다시 읽어 고친다."""
            steam = self.steam
            own = playlist.parse(steam._member_data(lobby, account, playlist.KEY))
            video = op.get("id")
            if kind == "pl_restore":
                updated = playlist.parse(json.dumps(op.get("entries"))) if isinstance(op.get("entries"), list) else []
                if not updated:
                    mark("playlist_write_rejected", op=kind, reason="bad_entries")
                    return "failed"
                if own:
                    mark("playlist_write_rejected", op=kind, reason="not_empty")
                    return "accepted"   # Steam이 내 목록을 지우지 않았다(잠깐 끊긴 것 등) — 덮어쓰지 않는다
            elif not playlist.valid_id(video):
                mark("playlist_write_rejected", op=kind, reason="bad_id")
                return "failed"
            elif kind == "pl_add":
                updated, status = playlist.apply_add(own, video, steam.server_time())
                if status != "ok":
                    mark("playlist_write_rejected", op=kind, reason=status)
                    return "pl_full" if status == "full" else "pl_exists"
            else:
                updated = playlist.apply_remove(own, video)
                if updated == own:
                    mark("playlist_write_rejected", op=kind, reason="absent")
                    return "accepted"   # 이미 없다(같은 삭제를 두 번 눌렀거나 다른 창에서 지움) — 할 일이 없다
            value = playlist.dump(updated)
            steam.set_member_data(lobby, playlist.KEY, value)
            readback = steam._member_data(lobby, account, playlist.KEY) == value
            mark("playlist_write", op=kind, entries=len(updated), bytes=len(value.encode()), readback=readback)
            self.profile_time = 0
            return "accepted"

    worker_module.LiveConnection = LiveWarnAware
