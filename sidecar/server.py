"""Cat-Talk 사이드카: stdin/stdout JSON 라인으로 upstream ChatService/Store를 노출한다.

dispatch/request/poll/close는 src/bongo_chat/desktop.py의 Controller에서 Qt·updates·
notifications·merger를 뺀 포팅이다. worker는 run_worker를 기본 아바타 글루(default_avatar)로 감싸 spawn한다.
요청: {"id": <int>, "args": {"action": "...", ...}}  응답: {"id": <int>, "result": {...}}
"""
from collections import OrderedDict
import hashlib
import json
import multiprocessing as mp
import os
from pathlib import Path
import queue
import re
import sqlite3
import sys
import threading
import time
from uuid import uuid4

# spawn 자식도 이 모듈을 재import하므로 경로 설정은 모듈 최상단에 둔다.
# PyInstaller 번들(prod)은 bongo_chat을 번들 안에 넣으므로 소스 트리의 src/를 쓰지 않는다(D-036).
if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bongo_chat.profiles import steam_profile_uri
from bongo_chat.reactions import png
from bongo_chat.service import ChatService, NOTIFICATION_KEYS
from bongo_chat.worker import unavailable
from default_avatar import run_worker_with_default
from volatile_store import VolatileStore
import warns as warn_model
from diag import enable_faulthandler, mark

MAX_REQUEST = 32768
# 렌더러로 보내지 않는 worker 프로필 키: Steam 차단 판정(D-033), 경고 멤버 데이터 원문(D-052 — 집계값 warns만 보낸다)
INTERNAL_PROFILE_KEYS = {"steam_blocked", "cattalk_warns", "cattalk_wanted"}
CATTALK_ID = "cattalk-"     # 경고 멤버 데이터 쓰기 명령 id 접두(채팅 send 명령과 결과를 가른다)
WARN_OP_RETRY = 5.0          # 같은 정리 쓰기를 다시 보내기 전 기다리는 시간(프로필에 반영되기 전 중복 방지)
WANTED_MARKER_GRACE = 5.0    # 합계 3으로 띄운 뒤 이 시간 안에 오는 같은 대상의 처형 표식은 같은 처형으로 본다(기여자마다 표식을 따로 씀)
# worker 교체(steam_release 글루): Steam을 놓은 worker가 스스로 끝나기를 기다리는 상한. 그 worker는 재시도 대기 중이라 stop을 걸면
# discovery·avatars 정리(join 각 1초) 뒤 끝난다. 넘기면 terminate한다.
WORKER_RETIRE_GRACE = 5.0
# 교체가 아닌 worker 종료(크래시·강제 종료) 뒤 새 worker를 띄우기까지. 업스트림이 같은 프로세스에서 재시도하는 간격(3초)과 같다.
WORKER_RESPAWN_DELAY = 3.0
# 아바타 PNG는 view에 싣지 않고 id만 보낸다(600ms 폴링마다 수십 KB×참여자×2가 되는 것을 막는다).
# 메모리에만 두고 렌더러가 avatars 액션으로 한 번씩 받아 간다.
MAX_AVATARS = 256
MAX_AVATAR_REQUEST = 64
# bongo_chat.localization.LANGUAGES 사본 — 그 모듈은 PySide6를 import해 사이드카에서 쓸 수 없다.
LANGUAGES = ("system", "ko", "en")
# upstream desktop.py Controller.request와 동일한 9개. 그 외(invalid_query·invalid_setting·
# account_changed·invalid_merge_limit·request_too_large 포함)는 request_failed로 접힌다.
ALLOWED_ERRORS = {
    "connection_changed", "development_limit_50", "control_character", "storage_failed_before_send",
    "legal_unavailable", "invalid_steam_id", "steam_profile_unavailable", "steam_profile_failed",
    "block_unavailable", "warn_unavailable", "warn_command",
}
# Cat-Talk 드로어 전용 설정(upstream 화이트리스트 밖): key -> (기본값, 검증). 창 배치는 window-state.json이 맡는다.
UI_SETTINGS = {
    "chat_opacity": (100, lambda value: type(value) is int and 20 <= value <= 100),
    "presence_notices": (True, lambda value: type(value) is bool),
    "clear_cats": (False, lambda value: type(value) is bool),
    "auto_open_chest": (False, lambda value: type(value) is bool),
}
NOT_WIRED = {
    "merge_connect", "merge_start", "merge_stop", "merge_acknowledge", "merge_maximum", "merge_group",
    "legal", "check_updates", "restart_update", "update_permission",
}
# Steam 개인 계정 steamID64의 기준값(universe 1·type 1·instance 1, account id 0).
# 교환 제안 페이지의 partner는 steamID64 - 기준값, 곧 32비트 account id다.
STEAM_ID64_BASE = 76561197960265728


def steam_trade_uri(service, steam_id, context):
    """Steam 앱에서 여는 교환 요청 페이지 URI. 대상 검증은 프로필 열기(service.profile_uri)와 같은 순서·같은 에러다.

    형식(bongo_chat.profiles와 같은 숫자·64비트 규칙)이 아니거나 기준값 미만이면 invalid_steam_id,
    연결 context가 바뀌었거나 현재 참여자가 아니면 steam_profile_unavailable. upstream은 호출만 한다.
    교환은 전용 steam:// 딥링크가 없어 https 페이지를 steam://openurl/로 감싼다(프로필처럼 Steam 클라이언트에서 열린다).
    """
    if (not isinstance(steam_id, str)
            or re.fullmatch(r"[1-9][0-9]{0,19}", steam_id) is None
            or not STEAM_ID64_BASE <= int(steam_id) <= (1 << 64) - 1):
        raise ValueError("invalid_steam_id")
    if context != service.context() or steam_id not in service.profile_targets():
        raise ValueError("steam_profile_unavailable")
    return f"steam://openurl/https://steamcommunity.com/tradeoffer/new/?partner={int(steam_id) - STEAM_ID64_BASE}"


# 참여자 닉네임 덮어쓰기(D-032): 업스트림 범용 KV(settings)를 계정 네임스페이스 키로 쓴다(upstream 무수정).
# 값은 {steam_id: name} JSON이고 재실행·로비 이동 뒤에도 남는다. 이름은 앞뒤 공백 제거 후 15자(코드 포인트) 이하.
NICKNAME_MAX = 15


def nickname_key(account):
    return f"nicknames:{account}"


# 게임 고양이 숨김 목록(D-033 3단계)에 넣는 Steam ID 형식(bongo_chat.profiles의 정규 uint64 문자열 규칙과 같은 숫자 모양).
# 목록은 게임 폴더 파일의 한 줄씩이 되므로 다른 문자가 섞이지 않게 거른다.
STEAM_ID64_TEXT = re.compile(r"[1-9][0-9]{0,19}")


def data_dir():
    """데이터 폴더. Electron main이 CATTALK_DATA로 넘긴다(창 상태·패처 백업과 같은 폴더, D-041).
    없으면(사이드카 단독 실행) main과 같은 기본값 %LOCALAPPDATA%\\CatTalk — 전에는 CatTalk-dev였고 옮기지 않는다."""
    configured = os.environ.get("CATTALK_DATA")
    if configured:
        return Path(configured)
    return Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "CatTalk"


class Sidecar:
    def __init__(self, data, offline=False, read_only=False):
        # D-003: 채팅 계열은 인메모리(종료 시 소멸), settings만 디스크.
        started = time.monotonic()
        self.store = VolatileStore(data / "settings.sqlite3")
        self.service = ChatService(self.store)
        mark("db_open", seconds=round(time.monotonic() - started, 3))
        self.diag_state = None   # 마지막으로 남긴 (state, notice, lobby_verified, send_enabled) — 바뀔 때만 표식
        self.known_accounts = set()
        self.avatar_images = OrderedDict()   # id -> data URI
        self.default_avatar = None   # (id, data URI): 게임 기본 고양이. 아바타 미해결 시 렌더러 플레이스홀더
        self.incoming_count = 0   # 수락된 타인 메시지 누적 수. 렌더러가 증가를 보고 알림을 판단한다
        self.steam_hidden = set()   # Steam '모든 대화 차단'한 사람(D-033 2단계). 앱 차단 목록(service.blocked)과 별개
        self.steam_hidden_account = ""
        # Steam '모든 대화 차단'한 사람 전체(worker 열거, D-040). 게임 고양이 숨김 목록에만 쓴다. None = 열거 실패(또는 아직 모름)
        self.steam_ignored = None
        self.steam_ignored_account = ""   # 전체 목록 응답(성공·실패)을 받은 계정
        self.hidden_pushed = None   # main에 마지막으로 알린 게임 고양이 숨김 목록(D-033 3단계). 이번 실행에서 아직 없으면 None
        self.worker = None
        self.read_only = read_only
        self.retire_by = None   # Steam을 놓은 worker를 끝내는 중이면 강제 종료 기한(monotonic). 끝나면 새 worker를 띄운다
        self.respawn_at = None   # worker가 예기치 않게 끝났으면 다시 띄울 시각(monotonic)
        # 경고·공개수배(D-052): 로비 멤버 데이터 집계. 원문은 worker가 멤버 프로필(cattalk_warns·cattalk_wanted)에 싣는다
        self.warn_counts = {}      # 대상 → 경고 총횟수(현재 로비 멤버, 0 제외)
        self.wanted_events = []    # 렌더러가 다음 view에서 한 번 받아 갈 공개수배 [{id, target}]
        self.wanted_fired = OrderedDict()   # 이미 띄운 공개수배(로비:대상:처형 시각) — 같은 처형을 두 번 띄우지 않는다
        self.warn_ops = {}         # 진행 중인 cattalk 쓰기: 명령 id → (op 키, 보낸 시각, op)
        self.warn_failed = 0       # 렌더러에 알릴 경고 쓰기 실패 수(다음 view에서 받아 간다)
        self.warn_diag_last = None  # 진단 표식: 마지막으로 남긴 경고 데이터 수신 요약(바뀔 때만 남긴다)
        # 처형 표식으로 놓친 공개수배 잡기: 기준 로비, 표식을 이미 한 번 본 멤버, 대상별로 아는 가장 늦은 처형 시각
        self.wanted_base_lobby = None
        self.wanted_base_members = set()
        self.wanted_seen_cut = {}
        self.wanted_last = {}      # 대상 → (마지막으로 띄운 처형 시각, 띄운 때 monotonic) — 두 경로가 같은 처형을 두 번 띄우지 않게
        self.closed = False
        self.last_prune = time.monotonic()
        self.context = mp.get_context("spawn")
        self.commands = self.context.Queue(maxsize=64)
        self.events = self.context.Queue(maxsize=2048)
        self.stop = self.context.Event()
        if offline:
            self.service.update(unavailable("offline"))
        else:
            self.spawn_worker()

    def spawn_worker(self):
        # worker마다 stop을 새로 둔다(교체할 worker만 멈춘다). 큐는 이어 쓴다: 옛 worker는 정상 종료로 끝나 큐를 깨끗이 놓고,
        # 남은 명령은 새 worker가 연결 context 불일치로 failed 처리한다(업스트림이 같은 프로세스에서 재시도할 때와 같다).
        # render_avatars=True: 디코딩은 worker가 검증된 채팅 준비를 publish한 뒤에 시작한다.
        self.stop = self.context.Event()
        self.worker = self.context.Process(target=run_worker_with_default,
            args=(self.commands, self.events, self.stop, self.read_only, True), daemon=True)
        self.worker.start()
        mark("worker_spawn", pid=self.worker.pid)

    def retire_worker(self):
        """Steam을 놓은 worker를 끝낸다(steam_release 글루). Steam은 그 프로세스가 끝나야 Bongo Cat '실행 중'을 푼다(D-019).
        stop만 걸고 기다린다 — worker는 재시도 대기(stop.wait) 중이라 discovery·avatars 정리 후 곧 끝난다. 새 worker는 tend_worker가 띄운다."""
        if self.closed or self.worker is None or self.retire_by is not None or not self.worker.is_alive():
            return
        mark("worker_retire", pid=self.worker.pid)
        self.stop.set()
        self.retire_by = time.monotonic() + WORKER_RETIRE_GRACE

    def tend_worker(self):
        """worker 교체(Steam 놓음)와 예기치 않은 종료 뒤 재시작을 맡는다. poll마다 부른다(메인 스레드라 짧게 끝낸다).
        새 worker를 띄우지 못하면(OSError 등) 사이드카는 살려 두고 WORKER_RESPAWN_DELAY 뒤 다시 띄운다."""
        if self.closed or self.worker is None:
            return
        if self.retire_by is not None:
            if self.worker.is_alive():
                if time.monotonic() < self.retire_by:
                    return
                self.worker.terminate()  # 이 앱의 자식 worker만. 게임 프로세스는 건드리지 않는다.
                self.worker.join(1)
                mark("worker_terminated", pid=self.worker.pid)
                # 쓰는 도중 끊긴 프로세스는 큐를 망가뜨릴 수 있어 새 큐로 바꾼다(남은 이벤트는 이번 poll에서 이미 비웠다)
                self.replace_queues()
            mark("worker_retired", pid=self.worker.pid, exitcode=self.worker.exitcode)
            self.retire_by = None
            self.respawn()
            return
        if self.worker.is_alive():
            return
        if self.respawn_at is None:
            # 교체가 아닌 종료(크래시·강제 종료 등): 지금처럼 끊김을 알리고, 잠시 뒤 새 worker로 다시 연결한다
            mark("worker_stopped", exitcode=self.worker.exitcode)
            try:
                self.service.update(unavailable("worker_stopped"))
            except (sqlite3.Error, OSError):
                self.service.storage_error = True
            self.respawn_at = time.monotonic() + WORKER_RESPAWN_DELAY
        elif time.monotonic() >= self.respawn_at:
            self.respawn_at = None
            self.respawn()

    def respawn(self):
        try:
            self.spawn_worker()
        except Exception as exc:
            mark("worker_spawn_failed", error=type(exc).__name__)
            self.respawn_at = time.monotonic() + WORKER_RESPAWN_DELAY

    def update_warns(self):
        """경고·공개수배 집계(D-052). 로비 전원의 cattalk 멤버 데이터로 대상별 경고 총횟수를 세고, THRESHOLD에 닿은 대상은
        공개수배를 한 번 띄운다. 내가 기여한 대상이면 내 항목을 정리하고 처형 표식을 남기는 쓰기를 worker로 보낸다.
        내가 꺼져 있던 동안 처형된 내 옛 항목(다른 사람의 표식보다 오래됨)도 같은 쓰기로 정리한다."""
        state = self.service.state
        account, lobby = state.get("account", ""), state.get("lobby", "")
        members = set(state.get("members") or [])
        if not (account and lobby and state.get("lobby_verified")):
            self.warn_counts = {}
            return
        data = {}
        for uid, profile in (state.get("profiles") or {}).items():
            if uid in members and isinstance(profile, dict) and "cattalk_warns" in profile:
                data[uid] = (warn_model.parse_warns(profile.get("cattalk_warns")), warn_model.parse_wanted(profile.get("cattalk_wanted")))
        tally = warn_model.tally(data)
        self.warn_counts = {target: row["count"] for target, row in tally.items() if target in members}
        self.warn_diag(account, members, state.get("profiles") or {}, data, tally)
        context = self.service.context()
        mine = data.get(account)
        for target, row in tally.items():
            if row["count"] < warn_model.THRESHOLD:
                continue
            fired = self.fire_wanted(lobby, target, row["last"], members, "count", count=row["count"],
                                     mine=bool(mine and target in mine[0]), self_target=target == account,
                                     contributors=sum(1 for warns, _ in data.values() if target in warns and warns[target][1] > row["cut"]))
            if fired and mine and target in mine[0]:
                self.queue_cattalk({"op": "consume", "target": target, "when": row["last"]}, context)
        self.detect_executions(lobby, account, members, data)
        if mine:
            for target, when in warn_model.stale(mine[0], warn_model.cuts(data)).items():
                if target in members:
                    self.queue_cattalk({"op": "consume", "target": target, "when": when}, context)

    def fire_wanted(self, lobby, target, when, members, via, **diag):
        """공개수배를 한 번 띄운다(같은 처형 = 로비·대상·처형 시각은 한 번만). 새로 띄웠으면 True.
        via: count = 합계가 3인 순간을 직접 봄, marker = 그 순간을 놓쳤지만 새 처형 표식을 봄."""
        key = f"{lobby}:{target}:{when}"
        if key in self.wanted_fired:
            return False
        mark("wanted_fire", via=via, shown=target in members, **diag)
        self.wanted_fired[key] = True
        while len(self.wanted_fired) > 256:
            self.wanted_fired.popitem(last=False)
        self.wanted_last[target] = (max(when, self.wanted_last.get(target, (0, 0.0))[0]), time.monotonic())
        if target in members:
            self.wanted_events.append({"id": key, "target": target})
            del self.wanted_events[:-16]
        return True

    def detect_executions(self, lobby, account, members, data):
        """처형 표식(cattalk.wanted)으로 놓친 공개수배를 띄운다.
        합계 3은 처형한 기여자가 0.3초쯤 뒤 바로 정리해 사라지므로, 1초마다 읽는 다른 클라이언트는 그 순간을 놓칠 수 있다(1.0.4 실측).
        표식은 로비에 남으므로 '이미 알던 멤버의 표식이 대상의 처형 시각을 앞으로 밀었다' = 새 처형으로 보고 띄운다.
        켜질 때·로비를 옮길 때·새 멤버 데이터가 처음 보일 때 이미 있던 표식은 지난 처형이라 기준으로만 삼는다.
        옛 항목 정리(stale)가 남기는 표식은 이미 아는 처형 시각과 같아 앞으로 밀지 않으므로 띄우지 않는다."""
        if self.wanted_base_lobby != lobby:
            self.wanted_base_lobby, self.wanted_base_members, self.wanted_seen_cut, self.wanted_last = lobby, set(), {}, {}
        known = {uid: entry for uid, entry in data.items() if uid in self.wanted_base_members}
        now = time.monotonic()
        for target, when in warn_model.cuts(known).items():
            if when <= self.wanted_seen_cut.get(target, 0):
                continue
            last_when, last_at = self.wanted_last.get(target, (0, 0.0))
            if when <= last_when or now - last_at < WANTED_MARKER_GRACE:
                continue   # 합계 3으로 이미 띄운 같은 처형(다른 기여자의 표식이 몇 초 늦게·조금 다른 시각으로 와도)
            self.fire_wanted(lobby, target, when, members, "marker", self_target=target == account)
        for target, when in warn_model.cuts(data).items():
            self.wanted_seen_cut[target] = max(self.wanted_seen_cut.get(target, 0), when)
        self.wanted_base_members = (self.wanted_base_members | set(data)) & members

    def warn_diag(self, account, members, profiles, data, tally):
        """진단 표식(D-050·D-052): 경고 멤버 데이터 수신 상태를 개수로만, 바뀔 때만 남긴다(ID·이름·값은 넣지 않는다).
        others_with_data가 0에서 늘면 다른 클라이언트가 쓴 값이 Steam을 거쳐 여기 도착한 것이다."""
        unread = sum(1 for uid in members if not isinstance(profiles.get(uid), dict) or "cattalk_warns" not in profiles[uid])
        malformed = sum(1 for uid, (warns, wanted) in data.items()
                        if ((profiles[uid].get("cattalk_warns") or "").strip() not in ("", "{}") and not warns)
                        or ((profiles[uid].get("cattalk_wanted") or "").strip() not in ("", "{}") and not wanted))
        others = [uid for uid, (warns, wanted) in data.items() if uid != account and (warns or wanted)]
        summary = {
            "members": len(members), "unread": unread, "malformed": malformed,
            "own_entries": len(data.get(account, ({}, {}))[0]),
            "others_with_data": len(others), "others_entries": sum(len(data[uid][0]) for uid in others),
            "wanted_markers": sum(len(wanted) for _, wanted in data.values()),
            "targets": len(tally), "max_count": max((row["count"] for row in tally.values()), default=0),
        }
        if summary != self.warn_diag_last:
            self.warn_diag_last = summary
            mark("warn_data", **summary)

    def queue_cattalk(self, op, context):
        """경고 멤버 데이터 쓰기를 worker로 보낸다(채팅 send와 같은 큐, cattalk 필드로 구분). 같은 정리 쓰기는 반영될 때까지 다시 보내지 않는다.
        보냈으면 True. 큐가 가득 차면 False(경고는 다시 누르면 되고, 정리는 다음 집계에서 다시 시도한다)."""
        key = None if op["op"] == "warn" else f"{op['op']}:{op['target']}:{op.get('when')}"
        now = time.monotonic()
        if key and any(k == key and now - sent < WARN_OP_RETRY for k, sent, _ in self.warn_ops.values()):
            return True
        command = {"type": "send", "id": CATTALK_ID + uuid4().hex, "cattalk": op, "context": context, "queued": now}
        try:
            self.commands.put_nowait(command)
        except queue.Full:
            mark("warn_queue_full", op=op["op"])
            return False
        self.warn_ops[command["id"]] = (key, now, op)
        mark("warn_queued", op=op["op"])
        return True

    def warn_result(self, event):
        entry = self.warn_ops.pop(event.get("id"), None)
        status = event.get("status")
        mark("warn_result", op=entry[2].get("op") if entry else "unknown",
             status=status if isinstance(status, str) and status.isascii() and len(status) <= 40 else type(status).__name__,
             seconds=round(time.monotonic() - entry[1], 3) if entry else None)
        if entry and entry[2].get("op") == "warn" and event.get("status") != "accepted":
            self.warn_failed += 1   # 렌더러가 다음 view에서 '경고하지 못했습니다' 안내
        # 정리 쓰기가 실패하면 기록만 지운다 — 다음 집계가 아직 남은 항목을 보고 다시 보낸다
        now = time.monotonic()
        for cid in [cid for cid, (_, sent, _) in self.warn_ops.items() if now - sent > 30]:
            del self.warn_ops[cid]   # 결과가 오지 않은 쓰기(worker 교체 등)는 30초 뒤 잊는다

    def replace_queues(self):
        for pipe in (self.commands, self.events):
            pipe.cancel_join_thread()
            pipe.close()
        self.commands = self.context.Queue(maxsize=64)
        self.events = self.context.Queue(maxsize=2048)

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
                    self.update_steam_hidden()
                    self.mark_state(event)
                elif event.get("type") == "message":
                    # Steam 차단한 사람의 메시지는 업스트림이 받아 두지만(앱 차단이 아니므로) 화면에서 숨기니 알림 수에서 뺀다
                    if self.service.receive(event) and event.get("sender") not in self.steam_hidden:
                        self.incoming_count += 1
                elif event.get("type") == "reaction":
                    self.service.receive_reaction(event)
                elif event.get("type") == "default_avatar":
                    uri = event.get("avatar")
                    if png(uri):
                        self.default_avatar = (hashlib.sha1(uri.encode("ascii")).hexdigest()[:16], uri)
                elif event.get("type") == "steam_ignored":
                    self.update_steam_ignored(event)
                elif event.get("type") == "result":
                    if str(event.get("id", "")).startswith(CATTALK_ID):
                        self.warn_result(event)   # 경고 멤버 데이터 쓰기 결과(채팅 전송 결과가 아니다)
                    else:
                        self.service.result(event["id"], event["status"])
                elif event.get("type") == "steam_released":
                    # 업스트림은 연결 끊김 상태를 먼저 보내고(보내던 메시지는 거기서 '알 수 없음'으로 정리) 그 뒤 Steam을 놓는다
                    self.retire_worker()
            self.update_warns()
            if time.monotonic()-self.last_prune > 60:
                self.service.write(self.store.prune)
                self.last_prune = time.monotonic()
        except (sqlite3.Error, OSError):
            self.service.storage_error = True
        self.tend_worker()   # 저장소 오류(storage_error)와 섞지 않는다

    def mark_state(self, event):
        # worker 상태 전이(연결 단계·오류 코드·재시도)만 남긴다. 계정·로비·이름·멤버는 남기지 않는다
        key = (event.get("state"), event.get("notice"), bool(event.get("lobby_verified")), bool(event.get("send_enabled")))
        if key != self.diag_state:
            self.diag_state = key
            mark("worker_state", state=key[0], notice=key[1], lobby_verified=key[2], send_enabled=key[3],
                 members=len(event.get("members") or []))

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

    def publish_avatars(self, result):
        """profiles·participants의 data URI를 id로 바꾼다. 원본은 service 상태라 복사해서 고친다."""
        for group in ("profiles", "participants"):
            published = {}
            for uid, profile in result[group].items():
                profile = dict(profile)
                uri = profile.pop("avatar", None)
                if png(uri):
                    avatar_id = hashlib.sha1(uri.encode("ascii")).hexdigest()[:16]
                    self.avatar_images[avatar_id] = uri
                    self.avatar_images.move_to_end(avatar_id)
                    profile["avatar_id"] = avatar_id
                published[uid] = profile
            result[group] = published
        while len(self.avatar_images) > MAX_AVATARS:
            self.avatar_images.popitem(last=False)
        # 기본 고양이는 LRU 밖에 따로 둔다(밀려나면 플레이스홀더가 다시 이모지가 된다)
        if self.default_avatar:
            result["default_avatar_id"] = self.default_avatar[0]
        result["avatar_stage"] = self.service.state.get("avatar_stage", "disabled")
        result["avatar_error"] = self.service.state.get("avatar_error", "")

    def ui_settings(self):
        """저장값이 깨졌으면 기본값. 읽기 실패 시 None — 렌더러는 현재 값을 유지한다."""
        values = {}
        try:
            for key, (default, valid) in UI_SETTINGS.items():
                value = self.store.setting(key, default=default)
                values[key] = value if valid(value) else default
        except (sqlite3.Error, OSError):
            self.service.storage_error = True
            return None
        return values

    def update_steam_hidden(self):
        """Steam '모든 대화 차단'한 사람(worker가 멤버 프로필에 steam_blocked로 싣는다, D-033 2단계).

        지금 멤버는 플래그대로 넣고 빼고, 나간 사람은 마지막 판정을 유지한다(차단한 채 나가도 이번 실행의 지난 대화는
        계속 숨김). 계정이 바뀌면 비운다. 글루 저장소에도 넘겨 대화 조회에서 앱 차단과 같은 단계로 빼게 한다.
        """
        state = self.service.state
        account = state.get("account", "")
        if account != self.steam_hidden_account:
            self.steam_hidden.clear()
            self.steam_hidden_account = account
        members = set(state.get("members") or [])
        for uid, profile in (state.get("profiles") or {}).items():
            if uid in members and uid != account and isinstance(profile, dict) and "steam_blocked" in profile:
                if profile["steam_blocked"] is True:
                    self.steam_hidden.add(uid)
                else:
                    self.steam_hidden.discard(uid)
        self.store.hidden_senders = frozenset(self.steam_hidden)

    def hide_steam_blocked(self, result):
        """view 결과에서 Steam 차단한 사람을 뺀다. 지난 대화·입퇴장은 이미 대화 조회(VolatileStore.message_page)에서
        빠졌고, 여기서는 저장 못 한 메시지·참여자·프로필·반응·프로필 대상·앱 차단 목록(= 앱 차단 − 스팀 차단)을 정리한다.
        steam_blocked 플래그는 렌더러로 보내지 않는다."""
        hidden = self.steam_hidden
        if hidden:
            gone = {m["id"] for m in result["messages"] if m.get("sender") in hidden}
            result["messages"] = [m for m in result["messages"] if m.get("sender") not in hidden]
            result["volatile_peer_ids"] = [i for i in result.get("volatile_peer_ids", []) if i not in gone]
            result["profile_targets"] = [u for u in result.get("profile_targets", []) if u not in hidden]
            result["blocked_users"] = [u for u in result.get("blocked_users", []) if u.get("steam_id") not in hidden]
            if "reactions" in result:
                result["reactions"] = [r for r in result["reactions"] if r.get("sender") not in hidden]
        for group in ("profiles", "participants"):
            result[group] = {uid: {k: v for k, v in profile.items() if k not in INTERNAL_PROFILE_KEYS}
                             for uid, profile in result[group].items() if uid not in hidden}

    def update_steam_ignored(self, event):
        """worker가 열거한 Steam '모든 대화 차단' 전체 목록(D-040). ids가 None이면 열거 실패 — 멤버별 판정만 쓴다."""
        account, ids = event.get("account"), event.get("ids")
        if not isinstance(account, str):
            return
        self.steam_ignored_account = account
        self.steam_ignored = (frozenset(i for i in ids if isinstance(i, str) and STEAM_ID64_TEXT.fullmatch(i))
                              if isinstance(ids, list) else None)

    def hidden_ids(self):
        """게임 고양이 숨김 목록(D-033 3단계·D-040): (앱 차단 ∪ Steam 차단) SteamID64, 정렬. 판정이 덜 끝났으면 None.

        Steam 차단 = worker가 열거한 전체 목록(steam_ignored) ∪ 지금 로비 멤버의 멤버별 판정(steam_hidden ∩ 멤버). 전체 목록 덕분에
        아직 만나지 않은 차단자도 입장 전부터 파일에 있어 게임이 처음부터 숨긴다. 나간 멤버의 지난 판정은 보지 않는다 — 계속
        차단이면 전체 목록에 있고, 방 밖에서 풀었으면 빠져야 한다(그래야 '목록이 빔' = 차단이 하나도 없음, 원본 복원 제안 D-038).
        열거에 실패했으면(None) 종전대로 이번 실행의 멤버별 판정 전체(steam_hidden, 나간 멤버 유지)를 쓴다.

        현재 계정의 앱 차단 목록을 읽었고, 이 계정의 전체 목록 응답(성공·실패)이 왔고, 지금 로비 멤버(나 제외) 모두의 멤버별 판정
        (worker가 프로필에 싣는 steam_blocked)이 도착했을 때만 낸다. 그 전에 내면 이미 숨긴 차단자가 목록에서 잠깐 빠져 게임에서
        다시 보인다. 계정이 없거나(게임 꺼짐·연결 대기) 차단 목록을 못 읽었으면 None — 파일을 비우지 않고 그대로 둔다.
        """
        if self.closed:
            return None
        state = self.service.state
        account = state.get("account", "")
        blocked = self.service.blocked
        if (not account or blocked is None or self.service.block_account != account or self.steam_hidden_account != account
                or self.steam_ignored_account != account):
            return None
        profiles = state.get("profiles") or {}
        members = state.get("members") or []
        for uid in members:
            profile = profiles.get(uid)
            if uid != account and not (isinstance(profile, dict) and "steam_blocked" in profile):
                return None
        steam = self.steam_hidden if self.steam_ignored is None else self.steam_ignored | (self.steam_hidden & set(members))
        return sorted(uid for uid in set(blocked) | steam if isinstance(uid, str) and STEAM_ID64_TEXT.fullmatch(uid))

    def hidden_update(self):
        """main에 알릴 새 목록. 판정이 끝난 뒤 이번 실행의 첫 목록(앱 실행 때 1회)과, 그 뒤 바뀐 목록만 낸다. 아니면 None."""
        ids = self.hidden_ids()
        if ids is None or ids == self.hidden_pushed:
            return None
        self.hidden_pushed = ids
        return ids

    def nicknames(self, account):
        """현재 계정의 닉네임 덮어쓰기(steam_id → 이름). 계정이 없으면 {}, 깨진 저장값은 버린다."""
        value = self.store.setting(nickname_key(account), default={}) if account else {}
        if not isinstance(value, dict):
            return {}
        return {k: v for k, v in value.items() if isinstance(k, str) and isinstance(v, str)}

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
            self.update_steam_hidden()   # 대화 조회 전에 글루 저장소의 숨김 대상을 최신으로
            result = self.service.view(lobby, query, before, start, seen, limit)
            if "reactions" in args:
                result["reactions"] = self.service.take_reactions(result["lobby"],
                    args["reactions"] is True and not query and not self.closed)
            self.hide_steam_blocked(result)   # 아바타 이미지를 싣기 전에 뺀다
            # TODO(2c): update/auto_merge/notification/language 서브시스템 배선
            self.publish_avatars(result)
            result["incoming_count"] = self.incoming_count
            # 경고·공개수배(D-052): 대상별 경고 총횟수(보이는 멤버만)와, 검색이 아닐 때 새로 생긴 공개수배(한 번만 받아 간다)
            visible = set(result["participants"])
            result["warns"] = {uid: n for uid, n in self.warn_counts.items() if uid in visible}
            if not query:
                result["wanted"] = [w for w in self.wanted_events if w["target"] in visible]
                self.wanted_events = []
                result["warn_failed"], self.warn_failed = self.warn_failed, 0
            settings = self.ui_settings()
            if settings is not None:
                result["ui_settings"] = settings
            # 렌더러는 항상 맵을 받는다(D-032). 읽기 실패 회차는 {} — 표시는 기본 Steam 닉네임으로 돌아간다
            try:
                result["nicknames"] = self.nicknames(account)
            except (sqlite3.Error, OSError):
                self.service.storage_error = True
                result["nicknames"] = {}
            return result
        if action == "open_steam_profile":
            # 대상 검증과 URI 생성만 한다. 실제로 여는 일은 Electron main이 맡는다.
            return {"uri": self.service.profile_uri(args.get("steam_id"), args.get("context"))}
        if action == "open_steam_trade":
            # Cat-Talk 추가(upstream 없음). 프로필 열기와 같은 대상 검증 후 교환 페이지 URI만 만든다.
            return {"uri": steam_trade_uri(self.service, args.get("steam_id"), args.get("context"))}
        if action == "avatars":
            ids = args["ids"]
            if not isinstance(ids, list) or len(ids) > MAX_AVATAR_REQUEST:
                raise ValueError("invalid_query")
            images = {i: self.avatar_images[i] for i in ids if isinstance(i, str) and i in self.avatar_images}
            if self.default_avatar and self.default_avatar[0] in ids:
                images[self.default_avatar[0]] = self.default_avatar[1]
            return {"images": images}
        if action == "send":
            # 사용자가 명시적으로 보낸 요청만 worker로 넘긴다. 자동 송신 경로는 없다.
            # 경고 명령(@이름 경고!)은 채팅으로 보내지 않는다(D-052 — 렌더러가 warn으로 가로채고, 놓쳐도 여기서 막는다)
            if isinstance(args.get("text"), str) and warn_model.COMMAND.match(args["text"]):
                raise ValueError("warn_command")
            command = self.service.prepare(args["context"], args["text"])
            command["queued"] = time.monotonic()
            try:
                self.commands.put_nowait(command)
            except queue.Full:
                self.service.result(command["id"], "failed")
                raise
            return {"id": command["id"]}
        if action == "resend":
            # Cat-Talk 추가(upstream 없음): 전송 실패(failed)한 내 메시지를 저장된 원문으로 다시 보낸다. send와 같은
            # prepare·큐 경로라 새 uuid의 pending 행이 맨 아래에 생기고, 옛 실패 행은 prepare가 통과한 뒤 지운다(중복 0).
            # unknown(결과 불명)은 실제로 나갔을 수 있어 대상이 아니다. 대상이 아니면 resend_unavailable(→ request_failed).
            # 실패 행은 service.pending에서 이미 빠져 있어 echo 짝짓기에 끼어들지 않는다.
            context, old = args.get("context"), args.get("id")
            if context != self.service.context():
                raise ValueError("connection_changed")
            body = self.store.failed_own_body(old, context["account"], context["lobby"]) if isinstance(old, str) else None
            if body is None:
                raise ValueError("resend_unavailable")
            command = self.service.prepare(context, body)
            self.store.delete_failed_own(old)
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
            if key in UI_SETTINGS:
                if not UI_SETTINGS[key][1](value):
                    raise ValueError("invalid_setting")
                self.store.setting(key, value)
                return {"ok": True}
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
        elif action == "set_nickname":
            # Cat-Talk 추가(upstream 없음, D-032): 계정별·Steam ID 기준 표시 이름 덮어쓰기. 빈 값은 초기화.
            if not account or args["account"] != account:
                raise ValueError("account_changed")
            steam_id, name = args.get("steam_id"), args.get("name")
            steam_profile_uri(steam_id)   # 프로필 열기와 같은 정규 uint64 Steam ID 검증만 쓴다(아니면 invalid_steam_id)
            if not isinstance(name, str) or len(name.strip()) > NICKNAME_MAX:
                raise ValueError("invalid_nickname")
            nicknames = self.nicknames(account)
            if name.strip():
                nicknames[steam_id] = name.strip()
            else:
                nicknames.pop(steam_id, None)
            self.store.setting(nickname_key(account), nicknames)
        elif action == "warn":
            # 경고·공개수배(D-052): 내 cattalk.warns의 대상 +1(로비 멤버 데이터 쓰기, worker가 Steam에서 다시 읽어 고친다).
            # 대상은 지금 로비 멤버여야 한다(자기 자신 포함 — 사용자 결정). 결과는 비동기: 실패는 다음 view의 warn_failed로 알린다
            context, target = args.get("context"), args.get("target")
            state = self.service.state
            reason = ("closed" if self.closed else "context" if context != self.service.context()
                      else "unverified" if not state.get("lobby_verified")
                      else "target" if not isinstance(target, str) or target not in (state.get("members") or [])
                      else None)
            if reason is None and not self.queue_cattalk({"op": "warn", "target": target}, context):
                reason = "queue_full"
            mark("warn_request", ok=reason is None, reason=reason, self_target=target == state.get("account"))   # 진단: 거절 사유 코드만
            if reason:
                raise ValueError("warn_unavailable")
        elif action == "block_user":
            # D-033: 업스트림 차단 파이프라인 재활성화(desktop.py Controller와 같은 배선). 계정 일치·자기 자신 제외·
            # bool 검사는 service.set_blocked가 한다(아니면 block_unavailable, 형식이 틀리면 invalid_steam_id).
            # 목록은 VolatileStore가 settings의 'blocked:<account>'에 영속하고, 채팅·입퇴장·반응은 업스트림이 거른다.
            if self.closed:
                raise ValueError("block_unavailable")
            self.service.set_blocked(args.get("steam_id"), args.get("blocked"), args.get("account"))
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
    enable_faulthandler("sidecar")
    mark("start", pid=os.getpid(), frozen=bool(getattr(sys, "frozen", False)))
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
            # 요청 응답이 아닌 알림 줄(D-033 3단계). main만 받아 게임 폴더 숨김 목록 파일에 쓴다(렌더러로 가지 않는다).
            try:
                ids = sidecar.hidden_update()
            except (sqlite3.Error, OSError):
                ids = None
            if ids is not None:
                ipc.write(json.dumps({"event": "hidden_ids", "ids": ids}) + "\n")
                ipc.flush()
            if shutdown.is_set() and inbox.empty():
                break
            time.sleep(0.05)
    finally:
        sidecar.close()


if __name__ == "__main__":
    mp.freeze_support()
    if sys.argv[1:2] == ["--selftest"]:   # 번들 점검용. Electron은 이 인자를 넘기지 않는다(selftest.py)
        from selftest import run
        sys.exit(run(sys.argv[2:]))
    main()
