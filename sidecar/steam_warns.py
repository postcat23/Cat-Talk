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
"""
import ctypes as C

from bongo_chat import worker as worker_module

import playlist
import warns as model
from diag import mark

CATTALK_OPS = ("warn", "consume", "pl_add", "pl_remove")
PLAYLIST_OPS = ("pl_add", "pl_remove")


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
                row["cattalk_pl"] = self._member_data(lobby, uid, playlist.KEY)
            except Exception:
                pass   # 읽지 못하면 이 멤버의 경고·플리만 빠진다(채팅은 그대로)
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
                return self._playlist(lobby, account, kind, op.get("id"))
            steam = self.steam
            own_warns = model.parse_warns(steam._member_data(lobby, account, model.WARNS_KEY))
            own_wanted = model.parse_wanted(steam._member_data(lobby, account, model.WANTED_KEY))
            written = {}
            if op.get("op") == "warn":
                cut = max((model.parse_wanted(steam._member_data(lobby, uid, model.WANTED_KEY)).get(target, 0) for uid in members), default=0)
                updated = model.apply_warn(own_warns, target, steam.server_time(), cut)
                written[model.WARNS_KEY] = model.dump_warns(updated)
            elif op.get("op") == "consume" and type(op.get("when")) is int and op["when"] > 0:
                warns, wanted = model.apply_consume(own_warns, own_wanted, target, op["when"])
                if warns != own_warns:
                    written[model.WARNS_KEY] = model.dump_warns(warns)
                if wanted != own_wanted:
                    written[model.WANTED_KEY] = model.dump_wanted(wanted)
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

        def _playlist(self, lobby, account, kind, video):
            """내 cattalk.pl에 영상 하나 추가·삭제(D-053). 쓰기 직전 Steam의 내 값을 다시 읽어 고친다."""
            if not playlist.valid_id(video):
                mark("playlist_write_rejected", op=kind, reason="bad_id")
                return "failed"
            steam = self.steam
            own = playlist.parse(steam._member_data(lobby, account, playlist.KEY))
            if kind == "pl_add":
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
