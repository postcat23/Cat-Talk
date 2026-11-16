"""worker 글루: worker가 Steam API를 놓으면(SteamAPI_Shutdown) 사이드카에 알린다.

Steam은 앱(3419430)을 프로세스 단위로 추적한다(Steam 로그에 worker PID가 Bongo Cat 프로세스로 등록된다). upstream worker는 게임이
꺼지면 Steam.close()(Shutdown)를 부르고 같은 프로세스에서 게임을 다시 찾는데, 그 프로세스가 살아 있는 한 Steam은 Bongo Cat을
'실행 중'(HKCU\\Software\\Valve\\Steam\\Apps\\3419430\\Running=1)으로 유지해 Steam에서 게임을 다시 실행하지 못한다(D-019 실측:
worker 프로세스가 끝나고 2~3초 뒤 풀린다). 사이드카는 이 알림을 받으면 그 worker를 끝내고 새 worker를 띄운다. 새 worker는 게임을
찾기 전에는 Steam을 초기화하지 않으므로, 게임이 꺼져 있는 동안 Steam 등록이 없다.

upstream steam.py/worker.py는 수정하지 않는다. worker는 모듈 전역 이름 Steam으로 인스턴스를 만들므로 그 이름을 서브클래스로 바꿔 끼운다
(steam_relationship 선례). 초기화에 실패해 Steam을 잡지 못한 인스턴스(initialized False)는 알리지 않는다 — 놓을 등록이 없다.
"""
import queue

from bongo_chat import worker as worker_module

RELEASED = {"type": "steam_released"}


def install(events):
    base = worker_module.Steam

    class SteamReleaseAware(base):
        def close(self):
            held = self.initialized
            try:
                super().close()
            finally:
                if held:
                    try:
                        events.put(dict(RELEASED), timeout=1)
                    except queue.Full:
                        # 사이드카가 50ms마다 비우므로 사실상 없다. 놓치면 이 worker가 다음에 Steam을 놓을 때까지 등록이 남는다
                        pass

    worker_module.Steam = SteamReleaseAware
