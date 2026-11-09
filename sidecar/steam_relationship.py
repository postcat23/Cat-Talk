"""worker 글루(D-033 2단계): 로비 멤버 프로필에 Steam '모든 대화 차단' 여부(steam_blocked)를 붙인다.

업스트림 steam.py/worker.py는 수정하지 않는다. worker는 모듈 전역 이름 Steam으로 인스턴스를 만들므로 그 이름을
서브클래스로 바꿔 끼운다(default_avatar 선례). 관계값은 ISteamFriends::GetFriendRelationship(EFriendRelationship)이고,
프로필과 같이 약 1초마다 멤버별로 읽는다.

차단 판정 = 관계값 5(k_EFriendRelationshipIgnored) 하나(사용자 결정). 실측으로 확정된 차단값은 5뿐이다(친구 아닌 멤버
'모든 대화 차단' 0→5, 해제 5→0, 2026-11-09 — Steamworks 문서와도 일치). 1(Blocked)은 deprecated이고 '친구 요청 무시 직후의
저장되지 않는 일시 값'일 수 있어, 차단이 아닌데 잠깐 숨길 위험만 있어 뺀다(한때 {1, 5}로 넓혔다가 되돌림). 6(IgnoredFriend,
친구 차단)도 뺀다 — 친구는 Steam 감지로 숨기지 않고 앱 차단으로 처리한다. 0·1·2·3·4·6·7은 노출.
읽기에 실패하면 차단 아님으로 둔다 — 이 표시만 빠질 뿐 채팅과 앱 차단은 그대로 동작한다.
"""
import ctypes as C

from bongo_chat import worker as worker_module

STEAM_IGNORED = 5   # k_EFriendRelationshipIgnored — 내가 '모든 대화 차단'한 비친구


def install():
    base = worker_module.Steam

    class SteamBlockAware(base):
        def profile(self, lobby, uid):
            row = super().profile(lobby, uid)
            try:
                if not hasattr(self, "_relationship"):
                    self._relationship = self.bind("ISteamFriends_GetFriendRelationship", C.c_int, C.c_void_p, C.c_uint64)
                row["steam_blocked"] = int(self._relationship(self.friends, int(uid))) == STEAM_IGNORED
            except Exception:
                row["steam_blocked"] = False
            return row

    worker_module.Steam = SteamBlockAware
