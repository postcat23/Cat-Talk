"""진단 로그(관측 전용, D-050). 동작을 바꾸지 않는다.

- mark(): 단계 표식 한 줄을 stderr로 쓴다. main이 사이드카(와 상속받은 worker) stderr를 logs/sidecar.log에 남긴다.
  stdout(fd1)은 server.main이 stderr로 돌려 두었으므로 표식은 stderr에만 쓴다.
- enable_faulthandler(): 치명 오류(세그폴트·교착 덤프) 스택을 logs/faulthandler-<역할>.log에 남긴다(CATTALK_LOG_DIR).
값은 고정 코드·시간·개수만. 주소·계정·로비 ID·대화·경로는 넣지 않는다(업스트림 worker의 진단 원칙과 같다).
"""
import faulthandler
import json
import os
import sys
import time

_files = []
MAX_BYTES = 5 * 1024 * 1024   # electron/logger.js와 같은 상한·로테이션(현재 + .1)


def _append_worker_log(line):
    # spawn된 worker(pythonw)는 sys.stderr가 None이라 main이 받을 수 없다(2026-11-16 실측). worker 표식은 파일에 직접 쓴다
    directory = os.environ.get("CATTALK_LOG_DIR")
    if not directory:
        return
    path = os.path.join(directory, "worker.log")
    try:
        if os.path.exists(path) and os.path.getsize(path) + len(line.encode("utf-8")) > MAX_BYTES:
            os.replace(path, path + ".1")
        with open(path, "a", encoding="utf-8") as handle:
            now = time.time()   # main.log·sidecar.log와 같은 UTC ISO 표기
            handle.write(time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now)) + f".{int(now * 1000) % 1000:03d}Z " + line)
    except OSError:
        pass


def mark(stage, **fields):
    try:
        role = "worker" if os.environ.get("CATTALK_DIAG_ROLE") == "worker" else "sidecar"
        line = f"[diag] {role} {stage}" + (" " + json.dumps(fields, ensure_ascii=False) if fields else "") + "\n"
        if role == "worker":
            _append_worker_log(line)
        elif sys.stderr is not None:
            sys.stderr.write(line)
            sys.stderr.flush()
    except Exception:
        pass


def enable_faulthandler(role):
    directory = os.environ.get("CATTALK_LOG_DIR")
    if not directory:
        return
    try:
        os.makedirs(directory, exist_ok=True)
        handle = open(os.path.join(directory, f"faulthandler-{role}.log"), "a", encoding="utf-8")
        handle.write(f"--- {time.strftime('%Y-%m-%dT%H:%M:%S')} pid {os.getpid()} ---\n")
        handle.flush()
        faulthandler.enable(file=handle, all_threads=True)
        _files.append(handle)   # 핸들이 닫히면 faulthandler가 쓸 곳을 잃는다
    except OSError:
        pass
