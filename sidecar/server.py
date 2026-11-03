"""Cat-Talk 사이드카: stdin/stdout JSON 라인으로 upstream ChatService/Store를 노출한다.

dispatch/request/poll/close는 src/bongo_chat/desktop.py의 Controller에서 Qt·updates·
notifications·merger를 뺀 포팅이다. worker는 run_worker를 spawn한다(아바타 제외).
요청: {"id": <int>, "args": {"action": "...", ...}}  응답: {"id": <int>, "result": {...}}
"""
import json
import multiprocessing as mp
import os
from pathlib import Path
import queue
import sqlite3
import sys
import threading
import time

# spawn 자식도 이 모듈을 재import하므로 경로 설정은 모듈 최상단에 둔다.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bongo_chat.store import Store
from bongo_chat.service import ChatService, NOTIFICATION_KEYS
from bongo_chat.worker import run_worker, unavailable

MAX_REQUEST = 32768
# bongo_chat.localization.LANGUAGES 사본 — 그 모듈은 PySide6를 import해 사이드카에서 쓸 수 없다.
LANGUAGES = ("system", "ko", "en")
# upstream desktop.py Controller.request와 동일한 9개. 그 외(invalid_query·invalid_setting·
# account_changed·invalid_merge_limit·request_too_large 포함)는 request_failed로 접힌다.
ALLOWED_ERRORS = {
    "connection_changed", "development_limit_50", "control_character", "storage_failed_before_send",
    "legal_unavailable", "invalid_steam_id", "steam_profile_unavailable", "steam_profile_failed",
    "block_unavailable",
}
NOT_WIRED = {
    "merge_connect", "merge_start", "merge_stop", "merge_acknowledge", "merge_maximum", "merge_group",
    "block_user", "open_steam_profile", "legal", "check_updates", "restart_update", "update_permission",
}


def data_dir():
    configured = os.environ.get("CATTALK_DATA")
    if configured:
        return Path(configured)
    return Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "CatTalk-dev"


class Sidecar:
    def __init__(self, data, offline=False, read_only=False):
        self.store = Store(data / "history.sqlite3")
        self.service = ChatService(self.store)
        self.known_accounts = set()
        self.worker = None
        self.closed = False
        self.last_prune = time.monotonic()
        self.context = mp.get_context("spawn")
        self.commands = self.context.Queue(maxsize=64)
        self.events = self.context.Queue(maxsize=2048)
        self.stop = self.context.Event()
        if offline:
            self.service.update(unavailable("offline"))
        else:
            # render_avatars=False: 아바타(Pillow)는 다음 단계.
            self.worker = self.context.Process(target=run_worker,
                args=(self.commands, self.events, self.stop, read_only, False), daemon=True)
            self.worker.start()

    def poll(self):
        try:
            for _ in range(200):
                try:
                    event = self.events.get_nowait()
                except queue.Empty:
                    break
                if event.get("type") == "state":
                    # TODO(2c): unsupported_game_build → updates.request 분기
                    if event.get("account"):
                        self.known_accounts.add(event["account"])
                    self.service.update(event)
                elif event.get("type") == "message":
                    self.service.receive(event)
                elif event.get("type") == "reaction":
                    self.service.receive_reaction(event)
                elif event.get("type") == "result":
                    self.service.result(event["id"], event["status"])
            if self.worker and not self.worker.is_alive() and self.service.state.get("notice") != "worker_stopped":
                self.service.update(unavailable("worker_stopped"))
            if time.monotonic()-self.last_prune > 60:
                self.service.write(self.store.prune)
                self.last_prune = time.monotonic()
        except (sqlite3.Error, OSError):
            self.service.storage_error = True

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.stop.set()
        if self.worker:
            self.worker.join(3)
            if self.worker.is_alive():
                self.worker.terminate()  # 이 앱의 자식 worker만. 게임 프로세스는 건드리지 않는다.
                self.worker.join(2)
        self.poll()
        self.service.end("app_closed")
        self.store.close()
        for pipe in (self.commands, self.events):
            pipe.cancel_join_thread()
            pipe.close()

    def request(self, args, size):
        try:
            if size > MAX_REQUEST:
                raise ValueError("request_too_large")
            return self.dispatch(args)
        except (sqlite3.Error, OSError):
            self.service.storage_error = True
            return {"error": "storage_failed"}
        except (ValueError, TypeError, KeyError, queue.Full) as exc:
            # 네이티브 예외 메시지·경로를 렌더러로 흘리지 않는다.
            code = str(exc)
            if code not in ALLOWED_ERRORS:
                code = "request_failed"
            return {"error": code}

    def dispatch(self, args):
        action = args["action"]
        account = self.service.state.get("account", "")
        if action in NOT_WIRED:
            return {"error": "not_wired"}
        if action == "view":
            lobby = args.get("lobby") if args.get("account", account) == account else None
            query = args.get("query", "")
            before = args.get("before")
            start, seen, limit = args.get("start"), args.get("seen"), args.get("limit", 100)
            if (not isinstance(query, str) or len(query) > 120
                    or any(value is not None and (type(value) is not int or value < 0) for value in (before, start, seen))
                    or before is not None and start is not None
                    or type(limit) is not int or not 1 <= limit <= 1000):
                raise ValueError("invalid_query")
            result = self.service.view(lobby, query, before, start, seen, limit)
            if "reactions" in args:
                result["reactions"] = self.service.take_reactions(result["lobby"],
                    args["reactions"] is True and not query and not self.closed)
            # TODO(2c): update/auto_merge/notification/language 서브시스템 배선
            return result
        if action == "send":
            # 사용자가 명시적으로 보낸 요청만 worker로 넘긴다. 자동 송신 경로는 없다.
            command = self.service.prepare(args["context"], args["text"])
            command["queued"] = time.monotonic()
            try:
                self.commands.put_nowait(command)
            except queue.Full:
                self.service.result(command["id"], "failed")
                raise
            return {"id": command["id"]}
        if action == "draft":
            owner = args["account"]
            if not owner or owner not in self.known_accounts | {account} or args["lobby"] not in {r["lobby"] for r in self.store.rooms(owner)}:
                raise ValueError("account_changed")
            self.store.draft(owner, args["lobby"], args["text"])
        elif action == "setting":
            key, value = args["key"], args["value"]
            if key == "language":
                # TODO(2c): language 서브시스템(resolve_language·translations) 배선
                if value not in LANGUAGES:
                    raise ValueError("invalid_setting")
                self.store.setting(key, value)
                return {"ok": True}
            if key == "reactions_enabled":
                self.service.set_reactions_enabled(value)
                return {"ok": True}
            if key in NOTIFICATION_KEYS:
                self.service.set_notification(key, value)
                return {"ok": True}
            if not (key == "theme" and value in ("light", "dark", "system") or key == "collapsed" and type(value) is bool):
                raise ValueError("invalid_setting")
            self.store.setting(key, value)
        elif action == "delete":
            if not account or args["account"] != account:
                raise ValueError("account_changed")
            self.service.forget(account, args.get("lobby"))
        elif action == "refresh":
            try:
                self.service.recover_storage()
            except (sqlite3.Error, OSError):
                self.service.storage_error = True
            if self.worker and self.worker.is_alive():
                self.commands.put_nowait({"type": "refresh"})
        else:
            raise ValueError("unknown_action")
        return {"ok": True}


def request_id(line):
    """요청 id를 본 처리와 분리해 먼저 얻는다. 줄 자체가 깨졌으면 None."""
    try:
        req = json.loads(line)
    except ValueError:
        return None, None
    if not isinstance(req, dict):
        return None, None
    return req.get("id"), req


def handle(sidecar, line):
    id, req = request_id(line)
    if req is None:
        return {"id": None, "result": {"error": "malformed_request"}}
    try:
        args = req.get("args")
        size = len(json.dumps(args, ensure_ascii=False, separators=(",", ":")))
        result = sidecar.request(args, size)
    except Exception:
        result = {"error": "sidecar_exception"}
    return {"id": id, "result": result}


def read_stdin(stream, inbox, shutdown):
    # 스토어/서비스에 접근하지 않는다. 줄을 inbox에 넣기만 한다.
    try:
        for line in stream:
            line = line.strip()
            if line:
                inbox.put(line)
    finally:
        shutdown.set()


def main():
    # 네이티브(Steam/Mono)·자식 프로세스가 C 레벨로 stdout에 쓰면 IPC 스트림이 깨진다.
    # 진짜 stdout은 IPC 전용으로 떼어 두고 fd1은 stderr로 돌린다. worker spawn 전에 해야 한다.
    ipc_fd = os.dup(1)
    os.dup2(2, 1)
    ipc = os.fdopen(ipc_fd, "w", encoding="utf-8", buffering=1)
    # stdin도 IPC 전용 fd로 떼고 fd0은 devnull로 둔다. 리더 스레드가 stdin 파이프에서 동기 읽기로
    # 대기하는 동안 그 핸들을 물려받은 spawn 자식(worker)은 초기화에서 막힌다(Windows 실측:
    # 다음 요청 줄이 들어올 때까지 worker CPU 0.0s, 이벤트 없음).
    ipc_in = os.fdopen(os.dup(0), "r", encoding="utf-8")
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)
    os.close(devnull)

    sidecar = Sidecar(data_dir(), offline=os.environ.get("CATTALK_OFFLINE") == "1",
                      read_only=os.environ.get("CATTALK_READONLY") == "1")
    inbox, shutdown = queue.Queue(), threading.Event()
    threading.Thread(target=read_stdin, args=(ipc_in, inbox, shutdown), daemon=True).start()
    try:
        # 메인 스레드만 Store/ChatService를 소유한다.
        while True:
            sidecar.poll()
            while True:
                try:
                    line = inbox.get_nowait()
                except queue.Empty:
                    break
                ipc.write(json.dumps(handle(sidecar, line), ensure_ascii=False) + "\n")
                ipc.flush()
            if shutdown.is_set() and inbox.empty():
                break
            time.sleep(0.05)
    finally:
        sidecar.close()


if __name__ == "__main__":
    mp.freeze_support()
    main()
