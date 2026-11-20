"""worker 생명주기 보호(1.0.9, D-057): 고아 방지 · 시작 시 남은 worker 정리. 사이드카와 worker 양쪽에서 쓴다.

배경(2026-11-20 진단):
- Electron(libuv)은 사이드카를 '부모가 죽으면 같이 죽는' Job Object에 넣고, 그 자식(worker)은 빠져나가게 한다. 그래서 본체가
  비정상 종료되면 사이드카는 정리 없이 즉시 죽고 worker만 고아로 남는다(Node 22로 재현). 사이드카가 죽어도 마찬가지다.
- 고아는 이벤트 큐(2048)가 차면 끝나려다 큐 전송 스레드 join에서 영구히 멈춰, Steam의 Bongo Cat '실행 중' 등록(D-019)과 게임 파일
  핸들(UnityPy가 연 globalgamemanagers.assets 등)을 계속 쥔다 — 11-16→11-19 개발 실행 고아 65시간, 11-19 업데이트 File locked.

세 겹으로 막는다:
1. WorkerJob — 사이드카가 만든 KILL_ON_JOB_CLOSE 잡. worker를 띄운 직후 넣는다. 사이드카가 어떻게 끝나든(정상·크래시·강제 종료)
   OS가 잡 핸들을 닫으며 worker(와 그 자식 FeatureProbe)를 끝낸다.
2. watch_parent — worker가 사이드카 프로세스 핸들을 기다리다 사라지면 스스로 끝난다(잡에 넣지 못했을 때).
3. worker의 이벤트 큐는 cancel_join_thread로 종료 때 멈추지 않는다(default_avatar.run_worker_with_default).
그리고 남은 것은 시작 때 정리한다(reap_leftovers):
- 1.0.9부터는 worker PID·시작 시각을 데이터 폴더 workers.json에 적는다. 그 기록의 주인(사이드카)이 이미 없고 같은 시작 시각의
  프로세스가 살아 있으면 끝낸다(PID 재사용 방지).
- 1.0.8 이하가 남긴 고아는 기록이 없어 설치본에서만 시그니처로 찾는다: 같은 실행 파일(설치 경로의 cattalk-sidecar.exe) +
  worker 실행 인자(--multiprocessing-fork) + 부모 없음. 설치 프로그램도 같은 규칙이다(scripts/installer/reap-orphan-workers.ps1).
- 개발 실행(pythonw)의 고아는 임의의 Python 프로세스와 구분할 수 없어 기록으로만 정리한다(사용자 결정, 2026-11-20).
값은 고정 코드·개수만 표식에 남긴다(PID 외 경로·명령줄은 남기지 않는다).
"""
import ctypes
import json
import multiprocessing
import os
from pathlib import Path
import threading
import time

import psutil

from diag import mark

FORK_ARG = "--multiprocessing-fork"   # multiprocessing spawn 자식(= worker)의 실행 인자. 사이드카 자신에게는 없다
REGISTRY_NAME = "workers.json"
KILL_WAIT = 3.0                       # TerminateProcess 뒤 실제로 끝나기를 기다리는 상한(초)
PARENT_GONE_GRACE = 2.0               # 부모가 사라진 뒤 worker 루프가 Steam을 놓고 끝나기를 기다리는 시간, 넘기면 즉시 종료

# Windows Job Object(kernel32). 구조체는 JOBOBJECT_EXTENDED_LIMIT_INFORMATION(x64 144바이트)
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9
PROCESS_TERMINATE = 0x0001
PROCESS_SET_QUOTA = 0x0100


class _BasicLimits(ctypes.Structure):
    _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                ("LimitFlags", ctypes.c_uint32), ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", ctypes.c_uint32),
                ("Affinity", ctypes.c_size_t), ("PriorityClass", ctypes.c_uint32), ("SchedulingClass", ctypes.c_uint32)]


class _IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint64) for name in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                                                       "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]


class _ExtendedLimits(ctypes.Structure):
    _fields_ = [("BasicLimitInformation", _BasicLimits), ("IoInfo", _IoCounters), ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t)]


class WorkerJob:
    """사이드카 수명에 묶인 잡. 핸들은 일부러 닫지 않는다 — 이 프로세스가 끝날 때 OS가 닫으며 안의 프로세스를 모두 끝낸다.
    핸들은 상속되지 않는다(lpJobAttributes 없음, multiprocessing spawn은 핸들 상속 없이 자식을 만든다)."""

    def __init__(self):
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateJobObjectW.restype = ctypes.c_void_p
        kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p]
        kernel32.SetInformationJobObject.restype = ctypes.c_bool
        kernel32.SetInformationJobObject.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_bool, ctypes.c_uint32]
        kernel32.AssignProcessToJobObject.restype = ctypes.c_bool
        kernel32.AssignProcessToJobObject.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_bool
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        self._kernel32 = kernel32
        handle = kernel32.CreateJobObjectW(None, None)
        if not handle:
            raise OSError(ctypes.get_last_error(), "CreateJobObject")
        info = _ExtendedLimits()
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not kernel32.SetInformationJobObject(handle, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION, ctypes.byref(info),
                                                ctypes.sizeof(info)):
            error = ctypes.get_last_error()
            kernel32.CloseHandle(handle)
            raise OSError(error, "SetInformationJobObject")
        self.handle = handle

    @classmethod
    def create(cls):
        """Windows가 아니거나 만들지 못하면 None(표식). 그때는 worker의 부모 감시가 두 번째 겹이다."""
        if os.name != "nt":
            return None
        try:
            return cls()
        except (OSError, AttributeError) as exc:
            mark("worker_job", ok=False, error=type(exc).__name__)
            return None

    def assign(self, pid):
        process = self._kernel32.OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, False, int(pid))
        if not process:
            return False
        try:
            return bool(self._kernel32.AssignProcessToJobObject(self.handle, process))
        finally:
            self._kernel32.CloseHandle(process)

    def close(self):
        """핸들을 지금 닫는다(안의 프로세스가 끝난다). 자가 점검·시험 전용 — 사이드카는 부르지 않는다."""
        if self.handle:
            self._kernel32.CloseHandle(self.handle)
            self.handle = None


def watch_parent(stop, grace=PARENT_GONE_GRACE):
    """worker 쪽 두 번째 겹: 사이드카(부모)가 사라지면 stop을 걸고 grace 뒤 프로세스를 끝낸다. Steam 등록과 게임 파일 핸들은
    프로세스가 끝나야 풀린다(D-019). 부모 핸들(multiprocessing spawn이 넘긴 sentinel)을 기다리므로 PID 재사용과 무관하다."""
    parent = multiprocessing.parent_process()
    if parent is None:
        return False

    def run():
        parent.join()   # 부모 프로세스가 끝날 때까지(어떤 이유로든) 기다린다
        mark("parent_gone")
        stop.set()
        time.sleep(grace)
        os._exit(0)

    threading.Thread(target=run, name="cattalk-parent-watch", daemon=True).start()
    return True


def _norm(path):
    return os.path.normcase(os.path.realpath(path)) if path else ""


def _start_time(pid):
    try:
        return psutil.Process(pid).create_time()
    except psutil.Error:
        return None


def kill_process(pid, created=None, timeout=KILL_WAIT):
    """한 프로세스를 끝내고(TerminateProcess) 기다린다. created가 있으면 시작 시각이 같을 때만(PID 재사용 방지).
    'killed'(끝냄) · 'gone'(이미 없음·다른 프로세스) · 'failed'(남아 있음) 중 하나."""
    try:
        process = psutil.Process(pid)
        if created is not None and process.create_time() != created:
            return "gone"
        process.terminate()
        process.wait(timeout)
        return "killed"
    except psutil.NoSuchProcess:
        return "gone"
    except (psutil.TimeoutExpired, psutil.Error):
        return "failed" if psutil.pid_exists(pid) else "gone"


class WorkerRegistry:
    """workers.json = {"<worker pid>": {"created": 시작 시각, "owner": 사이드카 pid, "owner_created": 사이드카 시작 시각}}.
    사이드카 메인 스레드만 쓴다. 쓰기 실패는 무시한다(정리는 잡과 부모 감시가 먼저 맡는다)."""

    def __init__(self, path):
        self.path = Path(path)
        self.owner = (os.getpid(), _start_time(os.getpid()))

    def load(self):
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        if not isinstance(data, dict):
            return {}
        rows = {}
        for key, row in data.items():
            if (str(key).isdigit() and isinstance(row, dict) and isinstance(row.get("owner"), int)
                    and all(isinstance(row.get(name), (int, float)) for name in ("created", "owner_created"))):
                rows[str(key)] = row
        return rows

    def save(self, rows):
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.path.with_name(self.path.name + ".tmp")
            temp.write_text(json.dumps(rows, separators=(",", ":")), encoding="utf-8")
            os.replace(temp, self.path)
        except OSError:
            pass

    def record(self, pid):
        created = _start_time(pid)
        if created is None or self.owner[1] is None:
            return
        rows = self.load()
        rows[str(pid)] = {"created": created, "owner": self.owner[0], "owner_created": self.owner[1]}
        self.save(rows)

    def forget(self, pid):
        rows = self.load()
        if rows.pop(str(pid), None) is not None:
            self.save(rows)


def is_orphan_worker(row, parent, exe):
    """시그니처(설치 프로그램 reap-orphan-workers.ps1과 같은 규칙): 실행 파일이 exe와 같고, worker 실행 인자가 있고, 부모가 없다.
    부모 없음 = 부모 PID 프로세스가 없거나, 다른 실행 파일이거나, 자식보다 늦게 시작했다(PID가 재사용됐다).
    row = {"exe", "cmdline", "created"}, parent = {"exe", "created"} 또는 None."""
    target = _norm(exe)
    if not target or _norm(row.get("exe")) != target or FORK_ARG not in (row.get("cmdline") or []):
        return False
    if parent is None or _norm(parent.get("exe")) != target:
        return True
    return parent.get("created", 0) > row.get("created", 0)


def legacy_orphans(exe):
    """1.0.8 이하가 남긴 고아 worker(기록 없음). 판정할 수 없는 프로세스(권한 등)는 건드리지 않는다."""
    name = os.path.basename(exe).lower()
    found = []
    for process in psutil.process_iter(["name"]):
        if (process.info["name"] or "").lower() != name or process.pid == os.getpid():
            continue
        try:
            with process.oneshot():
                row = {"pid": process.pid, "exe": process.exe(), "cmdline": process.cmdline(),
                       "ppid": process.ppid(), "created": process.create_time()}
            try:
                owner = psutil.Process(row["ppid"])
                parent = {"exe": owner.exe(), "created": owner.create_time()}
            except psutil.NoSuchProcess:
                parent = None
        except psutil.Error:
            continue
        if is_orphan_worker(row, parent, exe):
            found.append(row)
    return found


def reap_leftovers(registry_path, legacy_exe=None):
    """시작 때 한 번: 이전 실행이 남긴 worker를 끝낸다. {"recorded": n, "legacy": n, "failed": n}.
    기록 중 주인 사이드카가 아직 살아 있는 것은 그 사이드카의 worker라 건드리지 않는다."""
    counts = {"recorded": 0, "legacy": 0, "failed": 0}
    registry = WorkerRegistry(registry_path)
    rows, keep = registry.load(), {}
    for key, row in rows.items():
        pid = int(key)
        if pid == os.getpid():
            continue
        owner_created = _start_time(row["owner"])
        if owner_created is not None and owner_created == row["owner_created"]:
            keep[key] = row
            continue
        status = kill_process(pid, row["created"])
        if status == "killed":
            counts["recorded"] += 1
        elif status == "failed":
            counts["failed"] += 1
            keep[key] = row   # 끝내지 못했다: 다음 시작 때 다시
    if keep != rows:
        registry.save(keep)
    if legacy_exe:
        for row in legacy_orphans(legacy_exe):
            status = kill_process(row["pid"], row["created"])
            if status == "killed":
                counts["legacy"] += 1
            elif status == "failed":
                counts["failed"] += 1
    return counts
