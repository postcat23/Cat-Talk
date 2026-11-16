"""worker 글루(D-052 경고·공개수배): Cat Talk 전용 로비 멤버 데이터(cattalk.warns·cattalk.wanted)를 읽고 쓴다.

upstream steam.py/worker.py는 수정하지 않는다(steam_relationship 선례: 모듈 전역 이름을 서브클래스로 바꿔 끼운다).
upstream은 로비 쓰기를 하지 않는 원칙(worker.close 주석 'No LeaveLobby, joins or lobby setting mutations')인데, 이 기능은
사용자 결정으로 그 원칙에서 벗어나 '내 멤버 데이터의 cattalk.* 키'만 쓴다. 게임 키(hat·skin 등)·로비 데이터·채팅 채널은 건드리지 않는다.

- 읽기: 멤버 프로필(약 1초마다)에 cattalk_warns·cattalk_wanted 원문을 싣는다. 집계는 사이드카가 한다(warns.tally).
- 쓰기: 사이드카가 큐로 보내는 send 명령 중 "cattalk" 필드가 있는 것만 여기서 처리한다(채팅 1초 제한·echo와 무관한 경로).
  {"op": "warn", "target"} = 내 경고 +1, {"op": "consume", "target", "when"} = 처형 시각까지의 내 항목 정리 + 표식.
  쓰기 직전에 내 현재 값을 Steam에서 다시 읽어 고친다(사이드카 사본에 기대지 않는다). 연결 대상(계정·로비·세대)이 명령과 다르면 failed.
"""
import ctypes as C

from bongo_chat import worker as worker_module

import warns as model


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
            except Exception:
                pass   # 읽지 못하면 이 멤버의 경고만 빠진다(채팅은 그대로)
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
            except Exception:
                return "failed"   # 연결이 바뀌는 중이면 다음 스냅숏이 처리한다. 쓰기 실패로 연결을 흔들지 않는다

        def _cattalk(self, command, op):
            if self.read_only or not isinstance(op, dict):
                return "failed"
            account, lobby, members, valid, verified = self.destination()
            current = {"account": account, "lobby": lobby, "generation": self.generation}
            target = op.get("target")
            if not verified or command.get("context") != current or target not in members:
                return "failed"
            steam = self.steam
            own_warns = model.parse_warns(steam._member_data(lobby, account, model.WARNS_KEY))
            own_wanted = model.parse_wanted(steam._member_data(lobby, account, model.WANTED_KEY))
            if op.get("op") == "warn":
                cut = max((model.parse_wanted(steam._member_data(lobby, uid, model.WANTED_KEY)).get(target, 0) for uid in members), default=0)
                updated = model.apply_warn(own_warns, target, steam.server_time(), cut)
                steam.set_member_data(lobby, model.WARNS_KEY, model.dump_warns(updated))
            elif op.get("op") == "consume" and type(op.get("when")) is int and op["when"] > 0:
                warns, wanted = model.apply_consume(own_warns, own_wanted, target, op["when"])
                if warns != own_warns:
                    steam.set_member_data(lobby, model.WARNS_KEY, model.dump_warns(warns))
                if wanted != own_wanted:
                    steam.set_member_data(lobby, model.WANTED_KEY, model.dump_wanted(wanted))
            else:
                return "failed"
            self.profile_time = 0   # 다음 틱에 프로필을 다시 읽어 사이드카가 바뀐 값을 곧 본다
            return "accepted"

    worker_module.LiveConnection = LiveWarnAware
