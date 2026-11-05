"""worker용 글루: 게임 기본 고양이 스킨을 1회 렌더해 사이드카로 보낸다.

아바타 미해결·스킨 변경 중에 렌더러가 데모 이모지 대신 쓸 플레이스홀더다.
upstream worker는 run_worker 안에서 `from .avatars import Avatars`를 호출 시점에 import하므로
모듈 속성을 이 서브클래스로 바꿔 끼운다(upstream 파일은 수정하지 않는다).
기본 스킨은 upstream worker와 같다: 장착 해제(-1) 슬롯은 CatLeft/CatRight, 모자 없음.
"""
import queue
import threading
import time

from bongo_chat import avatars as avatars_module
from bongo_chat.worker import run_worker

DEFAULT_SKIN = "Cat"
RENDER_TIMEOUT = 60   # 에셋 로드 + 1장 합성 상한(초). 넘기면 포기하고 이모지 폴백 유지


def _with_default(base, events):
    class DefaultAvatars(base):
        def __init__(self, root):
            super().__init__(root)
            threading.Thread(target=self._publish_default, daemon=True).start()

        def _publish_default(self):
            # Avatars 내부 상태(stop·stage·lock·cache)에 의존한다. upstream 변경 시 확인할 것.
            key = (DEFAULT_SKIN, None)
            deadline = time.monotonic() + RENDER_TIMEOUT
            while not self.stop.is_set() and time.monotonic() < deadline and self.stage != "unavailable":
                uri = self.get(*key)
                if uri:
                    try:
                        events.put({"type": "default_avatar", "avatar": uri}, timeout=1)
                    except queue.Full:
                        pass   # 장식용이다. 채팅 이벤트를 밀어내지 않는다
                    return
                with self.lock:
                    if key in self.cache:   # 렌더 실패가 None으로 캐시됨
                        return
                time.sleep(0.2)

    return DefaultAvatars


def run_worker_with_default(commands, events, stop, read_only=False, render_avatars=True):
    avatars_module.Avatars = _with_default(avatars_module.Avatars, events)
    run_worker(commands, events, stop, read_only, render_avatars)
