"""worker 글루(D-033 2단계·D-040): Steam '모든 대화 차단' 판정을 붙이고, 차단한 사람 전체 목록을 사이드카에 알린다.

업스트림 steam.py/worker.py는 수정하지 않는다. worker는 모듈 전역 이름 Steam으로 인스턴스를 만들므로 그 이름을
서브클래스로 바꿔 끼운다(default_avatar 선례). 관계값은 ISteamFriends::GetFriendRelationship(EFriendRelationship)이다.

차단 판정 = 관계값 5(k_EFriendRelationshipIgnored) 하나(사용자 결정). 실측으로 확정된 차단값은 5뿐이다(친구 아닌 멤버
'모든 대화 차단' 0→5, 해제 5→0, 2026-11-09 — Steamworks 문서와도 일치). 1(Blocked)은 deprecated이고 '친구 요청 무시 직후의
저장되지 않는 일시 값'일 수 있어, 차단이 아닌데 잠깐 숨길 위험만 있어 뺀다(한때 {1, 5}로 넓혔다가 되돌림). 6(IgnoredFriend,
친구 차단)도 뺀다 — 친구는 Steam 감지로 숨기지 않고 앱 차단으로 처리한다. 0·1·2·3·4·6·7은 노출.

- 멤버별 판정(D-033 2단계): 로비 멤버 프로필(약 1초마다)에 steam_blocked를 붙인다. 읽기에 실패하면 차단 아님으로 둔다 —
  이 표시만 빠질 뿐 채팅과 앱 차단은 그대로 동작한다.
- 전체 목록(D-040): 게임 고양이 숨김 파일(CatTalkHidden.ids)에 아직 만나지 않은 차단자도 미리 넣어, 입장 순간부터 숨게 한다.
  GetFriendCount(k_EFriendFlagIgnored)·GetFriendByIndex로 열거하고 위와 같게 관계값 5만 남긴다(실게임 DLL 실측: 0x200 열거 =
  관계값 5, 2026-11-11). 연결돼 있는 동안(로비 밖 포함) 업스트림 계정 확인(account, 매 틱) 뒤 1초 간격으로 다시 열거하고,
  목록이 바뀔 때만 이벤트 {"type": "steam_ignored", "account", "ids"}를 보낸다(새 Steam 세션의 첫 열거는 늘 보낸다).
  열거에 실패하면 ids = None — 사이드카는 멤버별 판정만으로 목록을 낸다(종전 동작).
"""
import ctypes as C
import queue
import time

from bongo_chat import worker as worker_module

STEAM_IGNORED = 5             # k_EFriendRelationshipIgnored — 내가 '모든 대화 차단'한 비친구
FRIEND_FLAG_IGNORED = 0x200   # k_EFriendFlagIgnored — 관계값 5인 사람을 열거한다
IGNORED_REFRESH_SECONDS = 1   # 전체 목록 다시 열거 간격. 멤버 프로필 갱신과 같은 주기(사용자 결정)


def install(events=None):
    """events: worker 이벤트 큐. 없으면 전체 목록은 알리지 않는다(멤버별 판정만)."""
    base = worker_module.Steam

    class SteamBlockAware(base):
        def _friends_api(self):
            if not hasattr(self, "_relationship"):
                self._relationship = self.bind("ISteamFriends_GetFriendRelationship", C.c_int, C.c_void_p, C.c_uint64)
            return self._relationship

        def profile(self, lobby, uid):
            row = super().profile(lobby, uid)
            try:
                row["steam_blocked"] = int(self._friends_api()(self.friends, int(uid))) == STEAM_IGNORED
            except Exception:
                row["steam_blocked"] = False
            return row

        def ignored(self):
            """Steam '모든 대화 차단'한 사람 전체(관계값 5)의 SteamID64 문자열, 정렬. 읽기에 실패하면 None."""
            try:
                relationship = self._friends_api()
                if not hasattr(self, "_friend_count"):
                    self._friend_count = self.bind("ISteamFriends_GetFriendCount", C.c_int, C.c_void_p, C.c_int)
                    self._friend_at = self.bind("ISteamFriends_GetFriendByIndex", C.c_uint64, C.c_void_p, C.c_int, C.c_int)
                count = int(self._friend_count(self.friends, FRIEND_FLAG_IGNORED))
                if count < 0:
                    return None
                ids = set()
                for i in range(count):
                    uid = int(self._friend_at(self.friends, i, FRIEND_FLAG_IGNORED))
                    if uid and int(relationship(self.friends, uid)) == STEAM_IGNORED:
                        ids.add(str(uid))
                return sorted(ids)
            except Exception:
                return None

        def account(self):
            uid = super().account()   # 로그인·앱 확인을 통과한 계정만 아래로 온다
            if events is not None:
                now = time.monotonic()
                if now - getattr(self, "_ignored_at", float("-inf")) >= IGNORED_REFRESH_SECONDS:
                    self._ignored_at = now
                    self._publish_ignored(uid)
            return uid

        def _publish_ignored(self, account):
            ids = self.ignored()
            sent = (account, None if ids is None else tuple(ids))
            if sent == getattr(self, "_ignored_sent", None):
                return
            try:
                events.put_nowait({"type": "steam_ignored", "account": account, "ids": ids})
            except queue.Full:
                return   # 채팅 이벤트를 밀어내지 않는다. 다음 열거(1초 뒤)에 다시 보낸다
            self._ignored_sent = sent

    worker_module.Steam = SteamBlockAware
