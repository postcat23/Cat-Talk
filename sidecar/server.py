"""Cat-Talk 사이드카: stdin/stdout JSON 라인으로 upstream ChatService/Store를 노출한다.

현재는 오프라인 모드만 배선한다(worker 미spawn — 2b-2에서 활성화).
dispatch/request는 src/bongo_chat/desktop.py의 Controller에서 Qt를 뺀 포팅이다.
요청: {"id": <int>, "args": {"action": "...", ...}}  응답: {"id": <int>, "result": {...}}
"""
import json
import os
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bongo_chat.store import Store
from bongo_chat.service import ChatService, NOTIFICATION_KEYS
from bongo_chat.worker import unavailable

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
    def __init__(self, data):
        self.store = Store(data / "history.sqlite3")
        self.service = ChatService(self.store)
        self.known_accounts = set()
        # 오프라인: worker·commands/events 큐를 만들지 않는다(2b-2).
        self.service.update(unavailable("offline"))

    def request(self, args, size):
        try:
            if size > MAX_REQUEST:
                raise ValueError("request_too_large")
            return self.dispatch(args)
        except (sqlite3.Error, OSError):
            self.service.storage_error = True
            return {"error": "storage_failed"}
        except (ValueError, TypeError, KeyError) as exc:
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
                    args["reactions"] is True and not query)
            # TODO(2c): update/auto_merge/notification/language 서브시스템 배선
            return result
        if action == "send":
            command = self.service.prepare(args["context"], args["text"])
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


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sidecar = Sidecar(data_dir())
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        id, req = request_id(line)
        if req is None:
            result = {"error": "malformed_request"}
        else:
            try:
                args = req.get("args")
                size = len(json.dumps(args, ensure_ascii=False, separators=(",", ":")))
                result = sidecar.request(args, size)
            except Exception:
                result = {"error": "sidecar_exception"}
        sys.stdout.write(json.dumps({"id": id, "result": result}, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
