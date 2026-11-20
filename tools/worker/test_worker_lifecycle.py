"""1.0.9 worker 생명주기 검증(D-057). 실제 게임·Steam은 쓰지 않는다. 사용: py -3.11 tools/worker/test_worker_lifecycle.py

1. worker 루프(진짜 bongo_chat.worker.run_worker + 가짜 게임·Steam·로비):
   로그오프가 이어져도 교체 요청 0 · Steam 초기화 1 · FeatureProbe(호환성 판정) 1 · Steam 닫기 0, 로그오프 중 보내기 failed,
   다시 로그온하면 같은 세션으로 재개(새 generation), 로그오프 중·연결 중 게임 종료 → 교체 요청 1, 사이드카가 멈추지 않아도 스스로 끝남,
   게임이 켜진 다른 오류 → 같은 프로세스에서 재시도(교체 0), Steam 클라이언트 재시작 → 같은 프로세스에서 재초기화(교체 0),
   게임이 없으면 Steam을 초기화하지 않음.
2. 사이드카 교체·안전망(진짜 server.Sidecar의 tend_worker·retire_worker·close + 가짜 프로세스·가짜 시계):
   60초 안 4번째 교체부터 5→10→20→40→60→60초, 60초 생존하면 리셋, 크래시는 3초 뒤, terminate 재시도·실패 표식·기록 유지.
3. 실제 프로세스(사이드카 모형 lifecycle_fixtures.py, 진짜 worker_guard):
   사이드카 강제 종료 → worker 종료(잡) / 잡이 없으면 고아로 남음(대조) / 잡 없이도 부모 감시로 종료 / Node(Electron 역할) 강제 종료 →
   사이드카·worker 모두 종료 / 큐가 차도 종료가 멈추지 않음(cancel_join_thread, 대조: 없으면 멈춤) /
   시작 정리 = 기록 대상만, 1.0.8 고아 시그니처 대상만 — 사이드카(worker_guard)와 설치 프로그램 스크립트(reap-orphan-workers.ps1)가 같은 결과.
만든 프로세스는 끝에 모두 정리한다.
"""
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT / "sidecar"), str(ROOT / "src")]

import psutil  # noqa: E402

from bongo_chat import worker as W  # noqa: E402
import server  # noqa: E402
import worker_guard  # noqa: E402

PYTHON = sys.executable
CSC = Path(os.environ.get("WINDIR", r"C:\Windows")) / r"Microsoft.NET\Framework64\v4.0.30319\csc.exe"
POWERSHELL = Path(os.environ.get("SystemRoot", r"C:\Windows")) / r"System32\WindowsPowerShell\v1.0\powershell.exe"
REAP_PS1 = ROOT / "scripts" / "installer" / "reap-orphan-workers.ps1"
NO_WINDOW = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0

failed = 0
spawned = []   # 이 시험이 만든 프로세스(psutil) — 끝에 남은 것을 정리한다


def check(name, ok, detail=""):
    global failed
    failed += not ok
    print(f"{'PASS' if ok else 'FAIL'} {name}{'  ' + str(detail) if detail != '' else ''}", flush=True)


def skip(name, why):
    print(f"SKIP {name}  {why}", flush=True)


def alive(pid):
    try:
        return psutil.Process(pid).status() != psutil.STATUS_ZOMBIE
    except psutil.Error:
        return False


def gone_within(pids, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if not any(alive(pid) for pid in pids):
            return True
        time.sleep(0.1)
    return not any(alive(pid) for pid in pids)


def track(pid):
    try:
        spawned.append(psutil.Process(pid))
    except psutil.Error:
        pass


def kill(pid):
    try:
        psutil.Process(pid).kill()
    except psutil.Error:
        pass


# ── 1. worker 루프 ───────────────────────────────────────────────────────────────────────────────────────────────
class World:
    def __init__(self, game_running=True):
        self.game_running, self.game_alive, self.logged_on, self.client_gone = game_running, True, True, False
        self.fail_locate = 0
        self.starts = self.closes = self.verifies = self.pumps = 0
        self.account, self.lobby = "76561198000000001", "109775240000000001"
        self.members = {self.account, "76561198000000002"}


class FakeGame:
    def __init__(self, world):
        self.world, self.pid, self.created, self.root = world, 4242, 1.0, ROOT

    def alive(self):
        return self.world.game_alive


class FakeCompat:
    build, known, unknown, degraded = "1", (), (), ()

    def check(self):
        pass

    def allows(self, gate):
        return True


def install_fakes(world):
    class FakeSteam:
        def __init__(self, root):
            self.initialized = False

        def start(self):
            world.starts += 1
            self.initialized = True

        def close(self):
            if self.initialized:
                world.closes += 1
            self.initialized = False

        def account(self):
            if not world.logged_on:
                raise RuntimeError("steam_unavailable")
            return world.account

        def profile(self, lobby, uid):
            return {"name": "n", "hat": -1, "skin": -1}

        def definition(self, item, prop):
            return "Cat"

        def room_name(self, lobby):
            return "room"

        def pump(self, context, members, accept=True):
            world.pumps += 1
            return []

        def send(self, lobby, text):
            return True

    class FakeLocator:
        source = "presence"

        def __init__(self, steam):
            pass

        def locate(self, account):
            if world.fail_locate:
                world.fail_locate -= 1
                raise RuntimeError("connection_changed")
            return world.lobby, "presence", set(world.members)

        def still(self, account, lobby):
            return True

    def running_game():
        if not world.game_running:
            raise RuntimeError("game_missing_or_ambiguous")
        return FakeGame(world)

    def verify(root, stop=None):
        world.verifies += 1
        return FakeCompat()

    W.running_game, W.verify_compatibility, W.Steam, W.LobbyLocator = running_game, verify, FakeSteam, FakeLocator
    W.steam_client = lambda: (1, 1.0)
    W.client_gone = lambda client: world.client_gone
    W.STEAM_LOGON_POLL, W.RETRY_DELAY, W.RETIRE_WAIT = 0.05, 0.2, 1.0


class Run:
    def __init__(self, world):
        install_fakes(world)
        self.world, self.commands, self.events, self.stop = world, queue.Queue(), queue.Queue(), threading.Event()
        self.seen = []
        self.thread = threading.Thread(target=W.run_worker, args=(self.commands, self.events, self.stop, False, False),
                                       daemon=True)
        self.thread.start()

    def drain(self):
        while True:
            try:
                self.seen.append(self.events.get_nowait())
            except queue.Empty:
                return

    def wait(self, predicate, timeout=3.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.drain()
            for event in self.seen:
                if predicate(event):
                    return event
            time.sleep(0.02)
        return None

    def clear(self):
        self.drain()
        self.seen = []

    def released(self):
        self.drain()
        return sum(1 for event in self.seen if event.get("type") == "steam_released")

    def end(self):
        self.stop.set()
        self.thread.join(5)
        return not self.thread.is_alive()


def ready(event):
    return event.get("type") == "state" and event.get("state") == "ready"


def notice(code):
    return lambda event: event.get("type") == "state" and event.get("notice") == code


def released(event):
    return event.get("type") == "steam_released"


def worker_loop_tests():
    w = World()
    r = Run(w)
    first = r.wait(ready)
    check("1a 연결(ready)", first is not None)
    r.clear()
    w.logged_on = False
    check("1b 로그오프 → steam_unavailable 상태", r.wait(notice("steam_unavailable")) is not None)
    time.sleep(1.0)   # 1초 폴링을 0.05초로 줄였다 — 약 20번
    r.commands.put({"type": "send", "id": "s1", "text": "hi", "context": {}, "queued": time.monotonic()})
    result = r.wait(lambda e: e.get("type") == "result" and e.get("id") == "s1")
    check("1c 로그오프 중 보내기 → failed", bool(result) and result["status"] == "failed", result)
    check("1d 로그오프 지속: 교체 요청 0", r.released() == 0)
    check("1e 로그오프 지속: Steam 초기화 1·FeatureProbe 1·Steam 닫기 0(같은 프로세스·세션)",
          (w.starts, w.verifies, w.closes) == (1, 1, 0), (w.starts, w.verifies, w.closes))
    check("1f 로그오프 중에도 콜백 큐를 비움", w.pumps >= 10, w.pumps)
    r.clear()
    w.logged_on = True
    again = r.wait(ready)
    check("1g 다시 로그온 → 같은 세션으로 ready(재초기화 없음)", again is not None and (w.starts, w.verifies, w.closes) == (1, 1, 0),
          (w.starts, w.verifies, w.closes))
    check("1h 재연결은 새 generation", bool(first and again) and again["generation"] != first["generation"])
    check("1i stop → 루프가 끝나고 Steam을 한 번 닫음", r.end() and w.closes == 1, w.closes)

    w = World()
    r = Run(w)
    r.wait(ready)
    w.logged_on = False
    r.wait(notice("steam_unavailable"))
    w.game_alive = False
    check("2a 로그오프 중 게임 종료 → 교체 요청 1", r.wait(released, 2) is not None and r.released() == 1)
    check("2b Steam 초기화는 1번뿐", w.starts == 1, w.starts)
    check("2c 교체 요청 뒤 stop → 끝남", r.end())

    w = World()
    r = Run(w)
    r.wait(ready)
    r.clear()
    w.game_alive = False
    event = r.wait(released, 2)
    order = [e.get("notice") or e.get("type") for e in r.seen]
    check("3a 연결 중 게임 종료 → process_changed 뒤 교체 요청 1",
          event is not None and "process_changed" in order and order.index("process_changed") < order.index("steam_released")
          and r.released() == 1, order)
    r.thread.join(W.RETIRE_WAIT + 2)
    check("3b 사이드카가 멈추지 않아도 교체 요청 뒤 스스로 끝남", not r.thread.is_alive())

    w = World()
    r = Run(w)
    r.wait(ready)
    r.clear()
    w.fail_locate = 1
    check("4a 게임이 켜진 채 다른 오류(connection_changed)", r.wait(notice("connection_changed")) is not None)
    check("4b 같은 프로세스에서 재시도해 다시 ready(교체 요청 0)", r.wait(ready, 3) is not None and r.released() == 0)
    check("4c Steam은 같은 프로세스에서 다시 초기화(start 2·close 1)", (w.starts, w.closes) == (2, 1), (w.starts, w.closes))
    r.end()

    w = World()
    r = Run(w)
    r.wait(ready)
    w.logged_on = False
    r.wait(notice("steam_unavailable"))
    r.clear()
    w.client_gone = True
    restarted = r.wait(notice("steam_restarted"))
    w.client_gone = False   # 새 Steam 클라이언트
    back = r.wait(notice("steam_unavailable"))
    check("5a 로그오프 중 Steam 클라이언트가 사라짐 → 같은 프로세스에서 재초기화(교체 0)",
          restarted is not None and back is not None and w.starts == 2 and r.released() == 0, (w.starts, r.released()))
    w.logged_on = True
    check("5b 로그온 → ready", r.wait(ready) is not None)
    r.end()

    w = World(game_running=False)
    r = Run(w)
    time.sleep(0.6)
    check("6 게임이 없으면 Steam을 초기화하지 않고 교체도 요청하지 않음", w.starts == 0 and r.released() == 0, (w.starts, r.released()))
    r.end()


# ── 2. 사이드카 교체·안전망 ──────────────────────────────────────────────────────────────────────────────────────
class FakeProc:
    def __init__(self, pid):
        self.pid, self.alive, self.exitcode, self.stubborn = pid, True, None, 0

    def is_alive(self):
        return self.alive

    def terminate(self):
        if self.stubborn > 0:
            self.stubborn -= 1
        else:
            self.die(1)

    def join(self, timeout=None):
        pass

    def die(self, code=0):
        self.alive, self.exitcode = False, code


class Clock:
    def __init__(self):
        self.now = 1000.0

    def monotonic(self):
        return self.now

    def __getattr__(self, name):
        return getattr(time, name)


def sidecar_tests(tmp):
    marks = []
    real_mark, real_time = server.mark, server.time
    server.mark = lambda stage, **fields: marks.append((stage, fields))
    clock = Clock()
    server.time = clock
    try:
        s = server.Sidecar(Path(tmp), offline=True)
        pids = iter(range(900000, 999999))

        def fake_spawn():
            s.stop = threading.Event()
            s.worker = FakeProc(next(pids))
            s.spawned_at = clock.now

        s.spawn_worker = fake_spawn
        s.replace_queues = lambda: None
        fake_spawn()
        delays = []
        for _ in range(9):
            s.retire_worker()
            s.worker.die(0)
            s.tend_worker()
            if s.respawn_at is not None:
                delays.append(round(s.respawn_at - clock.now, 3))
                clock.now = s.respawn_at
                s.tend_worker()
            else:
                delays.append(0)
            clock.now += 1.0
        check("7a 교체가 반복되면 60초 안 4번째부터 5→10→20→40→60→60초", delays == [0, 0, 0, 5, 10, 20, 40, 60, 60], delays)
        check("7b 백오프마다 표식", sum(1 for stage, _ in marks if stage == "worker_respawn_backoff") == 6)
        clock.now += 61
        s.tend_worker()
        check("7c worker가 60초 살아 있으면 안전망 리셋", ("worker_backoff_reset", {}) in marks and s.backoff_level == 0)
        s.retire_worker()
        s.worker.die(0)
        s.tend_worker()
        check("7d 리셋 뒤 교체는 바로", s.respawn_at is None and s.worker.alive)
        s.worker.die(1)
        s.tend_worker()
        check("7e 크래시 → worker_stopped 뒤 3초 지연",
              s.respawn_at is not None and round(s.respawn_at - clock.now, 3) == 3.0 and any(m[0] == "worker_stopped" for m in marks))
        clock.now = s.respawn_at
        s.tend_worker()
        check("7f 3초 뒤 새 worker", s.worker.alive and s.respawn_at is None)
        clock.now += 61
        s.tend_worker()
        s.retire_worker()
        s.worker.stubborn = 1
        clock.now += server.WORKER_RETIRE_GRACE + 1
        s.tend_worker()
        check("7g 은퇴 유예를 넘김 → terminate 확인: 한 번 무시되면 다시 terminate해 끝냄",
              any(m == ("worker_terminate_retry", {"pid": m[1].get("pid"), "attempts": 2}) for m in marks) and s.worker.alive)
        stuck = s.worker
        s.registry.save({str(stuck.pid): {"created": 1.0, "owner": 1, "owner_created": 1.0}})
        s.retire_worker()
        stuck.stubborn = 99
        clock.now += server.WORKER_RETIRE_GRACE + 1
        s.tend_worker()
        check("7h 끝내지 못한 worker → worker_terminate_failed, PID 기록 유지",
              any(m[0] == "worker_terminate_failed" for m in marks) and str(stuck.pid) in s.registry.load())
        stuck.stubborn = 0
        stuck.die(0)
        s.close()
    finally:
        server.mark, server.time = real_mark, real_time


# ── 3. 실제 프로세스 ────────────────────────────────────────────────────────────────────────────────────────────
def start_model(*flags, marker=None):
    env = dict(os.environ, CATTALK_TEST_MARKER=str(marker)) if marker else None
    process = subprocess.Popen([PYTHON, str(HERE / "lifecycle_fixtures.py"), "sidecar", *flags], env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, creationflags=NO_WINDOW)
    info = json.loads(process.stdout.readline())
    track(info["sidecar"])
    track(info["worker"])
    return process, info


def process_tests():
    process, info = start_model("--job")
    time.sleep(0.5)
    check("8a 모형: worker를 사이드카 잡에 넣음", info["job"] is True, info)
    kill(info["sidecar"])
    check("8b 사이드카 강제 종료 → worker 2초 안에 종료(잡)", gone_within([info["worker"]], 2.0))

    process, info = start_model()
    time.sleep(0.5)
    kill(info["sidecar"])
    orphan = not gone_within([info["worker"]], 2.0)
    check("8c 대조: 잡·부모 감시가 없으면 worker가 고아로 남음(1.0.8 이하)", orphan)
    kill(info["worker"])

    process, info = start_model("--watch")
    time.sleep(0.5)
    kill(info["sidecar"])
    check("8d 잡 없이도 부모 감시로 worker 종료", gone_within([info["worker"]], 3.0))

    node = shutil.which("node")
    if not node:
        skip("8e Node(Electron 역할) 강제 종료", "node 없음")
    else:
        parent = subprocess.Popen([node, str(HERE / "node_parent.js"), PYTHON, str(HERE / "lifecycle_fixtures.py"), "sidecar",
                                   "--job", "--watch"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                                  creationflags=NO_WINDOW)
        first, second = json.loads(parent.stdout.readline()), json.loads(parent.stdout.readline())
        info = dict(first, **second)
        for pid in (info["node"], info["sidecar"], info["worker"]):
            track(pid)
        time.sleep(0.5)
        kill(info["node"])
        check("8e Node(Electron 역할) 강제 종료 → 사이드카·worker 3초 안에 모두 종료(고아 0)",
              gone_within([info["sidecar"], info["worker"]], 3.0))

    with tempfile.TemporaryDirectory() as tmp:
        marker = Path(tmp) / "full.txt"
        process, info = start_model("--fill", "--cancel", "--nodrain", marker=marker)
        time.sleep(0.3)
        kill(info["sidecar"])
        ended = gone_within([info["worker"]], 10.0)
        check("9a 부모가 죽고 큐가 차 끝나려 할 때 종료가 멈추지 않음(cancel_join_thread)", marker.exists() and ended,
              (marker.exists(), ended))

        marker = Path(tmp) / "full-control.txt"
        process, info = start_model("--fill", "--nodrain", marker=marker)
        time.sleep(0.3)
        kill(info["sidecar"])
        deadline = time.monotonic() + 10
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(0.1)
        time.sleep(3.0)
        hung = marker.exists() and alive(info["worker"])
        check("9b 대조: cancel_join_thread가 없으면 큐가 차 끝나려 한 뒤에도 프로세스가 남음(1.0.8 이하)", hung,
              (marker.exists(), alive(info["worker"])))
        kill(info["worker"])


def sleeper():
    process = subprocess.Popen([PYTHON, "-c", "import time; time.sleep(600)"], creationflags=NO_WINDOW)
    track(process.pid)
    return process.pid, psutil.Process(process.pid).create_time()


def registry_tests(tmp):
    dead = subprocess.Popen([PYTHON, "-c", "pass"], creationflags=NO_WINDOW)
    dead_created = psutil.Process(dead.pid).create_time() if alive(dead.pid) else 1.0
    dead.wait()
    a_pid, a_created = sleeper()
    b_pid, b_created = sleeper()
    c_pid, _ = sleeper()
    me = psutil.Process()
    path = Path(tmp) / worker_guard.REGISTRY_NAME
    worker_guard.WorkerRegistry(path).save({
        str(a_pid): {"created": a_created, "owner": dead.pid, "owner_created": dead_created},
        str(b_pid): {"created": b_created, "owner": me.pid, "owner_created": me.create_time()},
        "12345678": {"created": 1.0, "owner": dead.pid, "owner_created": dead_created},   # 이미 없는 프로세스
    })
    counts = worker_guard.reap_leftovers(path)
    left = worker_guard.WorkerRegistry(path).load()
    check("10a 기록 정리: 주인이 없는 기록의 worker만 끝냄", not alive(a_pid) and alive(b_pid) and counts["recorded"] == 1, counts)
    check("10b 기록 없는 프로세스는 건드리지 않음", alive(c_pid))
    check("10c 기록: 정리한 것·없는 것은 지우고 주인이 살아 있는 것은 남김", set(left) == {str(b_pid)}, sorted(left))
    kill(b_pid)
    kill(c_pid)


def build_fake(tmp):
    if not CSC.is_file():
        return None
    source = HERE / "fake_worker.cs"
    install = Path(tmp) / "inst"
    other = Path(tmp) / "other"
    for root in (install, other):
        (root / "resources" / "sidecar-bin").mkdir(parents=True)
    exe = install / "resources" / "sidecar-bin" / "cattalk-sidecar.exe"
    result = subprocess.run([str(CSC), "-nologo", "-out:" + str(exe), str(source)], capture_output=True, text=True,
                            creationflags=NO_WINDOW)
    if result.returncode != 0:
        print(result.stdout, result.stderr)
        return None
    shutil.copyfile(exe, other / "resources" / "sidecar-bin" / "cattalk-sidecar.exe")
    return install, exe, other / "resources" / "sidecar-bin" / "cattalk-sidecar.exe"


def pair(exe):
    """fake 'spawn-child' → (부모 pid, worker pid). worker 인자는 --multiprocessing-fork."""
    parent = subprocess.Popen([str(exe), "spawn-child"], creationflags=NO_WINDOW)
    track(parent.pid)
    target = worker_guard._norm(str(exe))
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        for child in psutil.Process(parent.pid).children():   # conhost.exe도 자식으로 붙는다 — 실행 파일·인자로 고른다
            try:
                if worker_guard._norm(child.exe()) == target and worker_guard.FORK_ARG in child.cmdline():
                    track(child.pid)
                    return parent.pid, child.pid
            except psutil.Error:
                continue
        time.sleep(0.05)
    raise RuntimeError("fake child did not start")


def signature_world(fake):
    install, exe, other_exe = fake
    orphan_parent, orphan = pair(exe)
    kill(orphan_parent)                      # (i) 같은 경로 + worker 인자 + 부모 없음 → 대상
    live_parent, live_child = pair(exe)      # (ii) 부모가 살아 있는 worker → 아님
    other_parent, other_child = pair(other_exe)
    kill(other_parent)                       # (iii) 다른 경로의 고아 → 아님
    launcher = subprocess.Popen(["cmd", "/c", "start", "", "/b", str(exe)], creationflags=NO_WINDOW)
    launcher.wait()
    time.sleep(0.5)
    target = worker_guard._norm(str(exe))
    plain = [p.pid for p in psutil.process_iter(["name", "exe", "cmdline"])
             if worker_guard._norm(p.info["exe"]) == target and worker_guard.FORK_ARG not in (p.info["cmdline"] or [])
             and p.pid != live_parent]       # (iv) worker 인자 없는 같은 경로 프로세스(부모 없음) → 아님
    for pid in plain:
        track(pid)
    time.sleep(0.3)
    return {"orphan": orphan, "live_parent": live_parent, "live_child": live_child, "other": other_child, "plain": plain}


def signature_tests(tmp):
    fake = build_fake(tmp)
    if fake is None:
        skip("11 시그니처 정리", "csc 없음 또는 빌드 실패")
        return
    install, exe, _ = fake
    world = signature_world(fake)
    counts = worker_guard.reap_leftovers(Path(tmp) / "empty.json", legacy_exe=str(exe))
    check("11a 사이드카(설치본): 1.0.8 고아 시그니처 대상만 끝냄", not alive(world["orphan"]) and counts["legacy"] == 1, counts)
    check("11b 부모가 살아 있는 worker·다른 경로·worker 인자 없는 프로세스는 그대로",
          alive(world["live_child"]) and alive(world["live_parent"]) and alive(world["other"]) and world["plain"]
          and all(alive(pid) for pid in world["plain"]), world)
    for key in ("live_child", "live_parent", "other"):
        kill(world[key])
    for pid in world["plain"]:
        kill(pid)

    if not POWERSHELL.is_file():
        skip("12 설치 프로그램 정리 스크립트", "powershell 없음")
        return
    world = signature_world(fake)
    run = subprocess.run([str(POWERSHELL), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(REAP_PS1),
                          "-InstallDir", str(install)], capture_output=True, text=True, creationflags=NO_WINDOW)
    output = (run.stdout or "").strip()
    check("12a 설치 프로그램 스크립트: 같은 시그니처 대상만 끝냄(matched=1 stopped=1)",
          run.returncode == 0 and "matched=1 stopped=1" in output and not alive(world["orphan"]), (run.returncode, output))
    check("12b 설치 프로그램 스크립트: 나머지는 그대로",
          alive(world["live_child"]) and alive(world["live_parent"]) and alive(world["other"])
          and all(alive(pid) for pid in world["plain"]), world)
    for key in ("live_child", "live_parent", "other"):
        kill(world[key])
    for pid in world["plain"]:
        kill(pid)


def glue_and_spawn_tests(tmp):
    import multiprocessing as mp
    import lifecycle_fixtures

    context = mp.get_context("spawn")
    commands, events, stop = context.Queue(), context.Queue(), context.Event()
    child = context.Process(target=lifecycle_fixtures.glue_probe, args=(commands, events, stop), daemon=True)
    child.start()
    track(child.pid)
    try:
        report = events.get(timeout=30)
    except queue.Empty:
        report = None
    child.join(5)
    check("14 실제 worker 진입점: 큐 종료 대기 해제(cancel_join_thread) + 부모 감시 스레드가 오류 없이 켜짐",
          report == {"cancelled": True, "watch": True}, report)

    marks = []
    real_mark, real_target = server.mark, server.run_worker_with_default
    server.mark = lambda stage, **fields: marks.append((stage, fields))
    server.run_worker_with_default = lifecycle_fixtures.stub_worker
    try:
        s = server.Sidecar(Path(tmp))
        first = s.worker.pid
        track(first)
        rows = s.registry.load()
        check("15a 진짜 spawn_worker: 새 worker를 사이드카 잡에 넣고 PID 기록", s.job is not None
              and not any(m[0] == "worker_job_assign" for m in marks) and set(rows) == {str(first)}, (sorted(rows), marks[-3:]))
        s.retire_worker()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and (s.worker.pid == first or not s.worker.is_alive()):
            s.poll()
            time.sleep(0.05)
        track(s.worker.pid)
        rows = s.registry.load()
        check("15b 교체: 옛 worker 종료·기록 삭제, 새 worker 기록", s.worker.pid != first and not alive(first)
              and set(rows) == {str(s.worker.pid)}, sorted(rows))
        second = s.worker.pid
        s.close()
        check("15c 사이드카 종료: worker 종료·기록 비움", not alive(second) and s.registry.load() == {})
    finally:
        server.mark, server.run_worker_with_default = real_mark, real_target


def static_tests():
    nsh = (ROOT / "scripts" / "installer.nsh").read_text(encoding="utf-8")
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    check("13a package.json이 설치 포함 파일을 연결", package["build"]["nsis"].get("include") == "scripts/installer.nsh")
    check("13b 설치 포함 파일이 정리 스크립트를 실어 customInit에서 실행",
          "!macro customInit" in nsh and r"scripts\installer\reap-orphan-workers.ps1" in nsh and "-InstallDir \"$INSTDIR\"" in nsh)
    raw = REAP_PS1.read_bytes()
    check("13c 정리 스크립트는 ASCII(PowerShell 5.1 코드 페이지 문제 회피)", all(b < 128 for b in raw))
    check("13d 두 정리 규칙이 같은 worker 인자를 씀", worker_guard.FORK_ARG.encode() in raw)


def main():
    if os.name != "nt":
        print("Windows 전용 시험")
        return 0
    try:
        worker_loop_tests()
        with tempfile.TemporaryDirectory() as tmp:
            sidecar_tests(tmp)
        process_tests()
        with tempfile.TemporaryDirectory() as tmp:
            registry_tests(tmp)
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            glue_and_spawn_tests(tmp)
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            try:
                signature_tests(tmp)
            finally:
                for process in spawned:   # 임시 폴더의 가짜 exe를 쥔 프로세스를 먼저 끝낸다
                    try:
                        process.kill()
                    except psutil.Error:
                        pass
        static_tests()
    finally:
        leftover = []
        for process in spawned:
            try:
                if process.is_running():
                    leftover.append(process.pid)
                    process.kill()
            except psutil.Error:
                pass
        print(f"(정리: 시험이 만든 프로세스 중 끝에 남아 있던 {len(leftover)}개를 종료)")
    print(f"\n{failed} FAILED" if failed else "\nALL PASS")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
