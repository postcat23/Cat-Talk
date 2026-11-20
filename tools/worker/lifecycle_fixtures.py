"""test_worker_lifecycle.py의 실제 프로세스 시험용 사이드카 모형(Steam·게임 없음, 진짜 worker_guard를 쓴다).

py -3.11 lifecycle_fixtures.py sidecar [--job] [--watch] [--cancel] [--fill] [--nodrain]
  사이드카처럼 spawn 자식(모형 worker)을 띄우고, --job이면 사이드카 잡(worker_guard.WorkerJob)에 넣는다. 그 뒤
  {"sidecar": pid, "worker": pid, "job": 배정 여부}를 한 줄로 쓰고 계속 돈다(--nodrain이 아니면 이벤트를 읽는다).
  모형 worker: --watch면 부모 감시(worker_guard.watch_parent), --cancel이면 이벤트 큐 cancel_join_thread(실제 worker와 같은 처리),
  --fill이면 빠르게 넣는다(부모가 죽은 뒤 큐가 차는 상황). 큐가 차면 실제 worker의 emit처럼 끝난다(return).
"""
import json
import multiprocessing as mp
import os
from pathlib import Path
import queue
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "sidecar"), str(ROOT / "src")]

_job = None   # 잡 핸들을 이 프로세스 수명 동안 쥔다(사이드카와 같다)


def model_worker(events, stop, watch, cancel, fill):
    if cancel:
        events.cancel_join_thread()
    if watch:
        import worker_guard
        worker_guard.watch_parent(stop, grace=0.3)
    payload = {"type": "state", "notice": "x" * 200}   # worker 상태 한 건 크기
    while not stop.is_set():
        try:
            events.put(payload, timeout=0.2)
        except queue.Full:
            marker = os.environ.get("CATTALK_TEST_MARKER")   # 시험이 '큐가 차서 끝나려 했다'를 확인하는 표식
            if marker:
                Path(marker).write_text("full", encoding="ascii")
            return   # worker emit: 큐가 차면 멈추고 끝난다 — 이때 프로세스 종료가 멈추면 안 된다
        if not fill:   # --fill은 대기 없이 넣는다(Windows 타이머 해상도 때문에 짧은 대기도 약 15ms라 2048개에 30초가 넘는다)
            stop.wait(0.2)


def stub_worker(commands, events, stop, read_only=False, render_avatars=True):
    """진짜 Sidecar.spawn_worker가 띄우는 worker 대역(Steam·게임 없음): stop이 걸릴 때까지 돈다."""
    while not stop.is_set():
        stop.wait(0.05)


def glue_probe(commands, events, stop):
    """진짜 worker 진입점(default_avatar.run_worker_with_default)을 spawn 자식에서 돌리고, run_worker 대신 상태를 보고한다."""
    import threading
    import default_avatar

    def report(commands, events, stop, read_only=False, render_avatars=True):
        events.put({"cancelled": bool(getattr(events, "_joincancelled", False)),
                    "watch": any(t.name == "cattalk-parent-watch" for t in threading.enumerate())})

    default_avatar.run_worker = report
    default_avatar.run_worker_with_default(commands, events, stop)


def sidecar(flags):
    global _job
    context = mp.get_context("spawn")
    events, stop = context.Queue(maxsize=2048), context.Event()
    process = context.Process(target=model_worker, daemon=True,
                              args=(events, stop, "--watch" in flags, "--cancel" in flags, "--fill" in flags))
    process.start()
    assigned = None
    if "--job" in flags:
        import worker_guard
        _job = worker_guard.WorkerJob.create()
        assigned = bool(_job and _job.assign(process.pid))
    print(json.dumps({"sidecar": os.getpid(), "worker": process.pid, "job": assigned}), flush=True)
    drain = "--nodrain" not in flags
    while True:
        if drain:
            try:
                events.get(timeout=0.2)
            except queue.Empty:
                pass
        else:
            time.sleep(0.2)


if __name__ == "__main__":
    if sys.argv[1:2] == ["sidecar"]:
        sidecar(sys.argv[2:])
