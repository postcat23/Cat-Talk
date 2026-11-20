"""worker용 글루: 게임 기본 고양이 스킨을 1회 렌더해 사이드카로 보낸다.

아바타 미해결·스킨 변경 중에 렌더러가 데모 이모지 대신 쓸 플레이스홀더다.
upstream worker는 run_worker 안에서 `from .avatars import Avatars`를 호출 시점에 import하므로
모듈 속성을 이 서브클래스로 바꿔 끼운다(upstream 파일은 수정하지 않는다).
기본 스킨은 upstream worker와 같다: 장착 해제(-1) 슬롯은 CatLeft/CatRight, 모자 없음.
run_worker_with_default는 Steam '모든 대화 차단' 글루(steam_relationship — 멤버별 판정 D-033, 전체 목록 알림 D-040)와
경고·공개수배 멤버 데이터 글루(steam_warns, D-052)도 함께 끼운다. 1.0.9부터 worker 교체 요청(steam_released)은 worker가
직접 '게임이 꺼졌을 때만' 보낸다(bongo_chat.worker — 예전 steam_release 글루는 Steam을 놓을 때마다 보내 로그오프 중 교체 루프가 됐다).
worker 생명주기(D-057): 이벤트 큐가 종료 때 멈추지 않게 하고, 사이드카가 사라지면 스스로 끝난다(worker_guard).
"""
import queue
import threading
import time

from bongo_chat import avatars as avatars_module
from bongo_chat.worker import run_worker
from steam_relationship import install as install_steam_block
from steam_warns import install as install_steam_warns
from worker_guard import watch_parent

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


def _install_diag():
    """worker 단계 표식(관측 전용, D-050): worker 모듈이 쓰는 이름을 감싸 시작·끝·시간·결과 코드만 남긴다.
    원래 함수를 그대로 부르고 예외도 그대로 다시 던진다(동작 불변). 1.0.8부터 메모리 탐색(discovery)이 없다 — 로비는 Steam에서
    찾고(lobby.LobbyLocator), 어느 경로로 찾았는지는 사이드카의 worker_state 표식(lobby_source)에 남는다."""
    import os
    from bongo_chat import worker as worker_module
    from diag import enable_faulthandler, mark
    os.environ["CATTALK_DIAG_ROLE"] = "worker"
    enable_faulthandler("worker")
    mark("start", pid=os.getpid())

    def timed(stage, fn):
        def wrapper(*args, **kwargs):
            started = time.monotonic()
            try:
                result = fn(*args, **kwargs)
            except Exception as exc:
                code = str(exc)
                mark(stage, ok=False, seconds=round(time.monotonic() - started, 3),
                     error=code if code.isascii() and code.replace("_", "").isalnum() and len(code) <= 80 else type(exc).__name__)
                raise
            mark(stage, ok=True, seconds=round(time.monotonic() - started, 3))
            return result
        return wrapper

    worker_module.running_game = timed("game_detect", worker_module.running_game)
    timed_verify = timed("compatibility", worker_module.verify_compatibility)

    def verify_with_features(*args, **kwargs):
        # 1.0.8 기능별 판정: 모르는 기능·멈춘 게이트(이름뿐)와 공개 빌드 번호를 남긴다. 저하 신고의 1차 단서
        result = timed_verify(*args, **kwargs)
        mark("compat_features", build=getattr(result, "build", ""), unknown=list(getattr(result, "unknown", ())),
             degraded=list(getattr(result, "degraded", ())))
        return result

    worker_module.verify_compatibility = verify_with_features
    steam_class = worker_module.Steam
    steam_class.start = timed("steam_init", steam_class.start)


def run_worker_with_default(commands, events, stop, read_only=False, render_avatars=True):
    # 1.0.9(D-057): 종료 때 이벤트 큐 전송 스레드를 기다리지 않는다. 읽는 쪽(사이드카)이 없으면 파이프가 차 그 join이 영원히
    # 끝나지 않아, 프로세스가 Steam 등록·게임 파일 핸들을 쥔 채 남았다(2026-11-20 모델 재현). 아직 안 보낸 이벤트는 버려도 된다 —
    # 교체 요청(steam_released)은 사이드카가 받아 stop을 건 뒤에야 끝나므로 이미 전달됐다.
    events.cancel_join_thread()
    try:
        _install_diag()
    except Exception:
        pass   # 진단 실패가 worker를 막지 않는다
    watch_parent(stop)   # 사이드카가 사라지면 스스로 끝난다(사이드카 잡의 두 번째 겹)
    avatars_module.Avatars = _with_default(avatars_module.Avatars, events)
    install_steam_block(events)   # 멤버 프로필에 Steam '모든 대화 차단' 여부(D-033 2단계) + 차단한 사람 전체 목록 알림(D-040)
    install_steam_warns()   # 경고·공개수배(D-052): cattalk.* 멤버 데이터 읽기(프로필)·쓰기(cattalk 명령)
    run_worker(commands, events, stop, read_only, render_avatars)
