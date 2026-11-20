"""Separate native process. Its IPC has no network listener or auto-send source.

Cat Talk 1.0.8 (fork): the lobby comes from Steam (lobby.LobbyLocator), not from game memory. The game's own lobby
announcements are candidates and Steam membership is the authority, so chat no longer depends on the game's managed
code layout (the lobby/privacy fingerprints that stopped 1.0.6 on build 26754239).

Cat Talk 1.0.9 (D-057): process lifecycle. Steam counts this process as Bongo Cat from SteamAPI_Init until the process
exits (D-019), so a process that has initialized Steam asks the sidecar to replace it ('steam_released') only when the
game is gone. While Steam is merely logged off (the client lost its server connection, BLoggedOn false) the same process
and Steam session wait and check logon every second: no new process, no FeatureProbe run, no SteamAPI re-init.
1.0.3-1.0.8 replaced the process instead, every ~0.5 s for as long as the outage lasted (2,255 processes in a 21-minute
outage on 2026-11-18). Any other failure while the game is running is retried in this process."""
import queue
import time
from uuid import uuid4

import psutil

from .environment import UnsupportedGameBuild, running_game, verify_compatibility
from .lobby import LobbyLocator
from .steam import Steam
from .reactions import ReactionAssets

STEAM_LOGON_POLL = 1.0   # 1.0.9 (user spec): while logged off, check logon every second in the same process and session
RETRY_DELAY = 3.0        # in-process retry after any other failure (the upstream interval)
RETIRE_WAIT = 10.0       # after asking to be replaced, wait this long for the sidecar's stop, then end anyway
RETIRE = {"type": "steam_released"}   # 'replace this process': it holds Steam's Bongo Cat registration and the game is gone


def steam_client():
    """(pid, start time) of the Steam client process this session talks to, or None when unknown. The client writes its
    pid to HKCU\\Software\\Valve\\Steam\\ActiveProcess when it starts (checked 2026-11-20 against the running steam.exe)."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam\ActiveProcess") as key:
            pid = int(winreg.QueryValueEx(key, "pid")[0])
        return (pid, psutil.Process(pid).create_time()) if pid > 0 else None
    except (OSError, ValueError, TypeError, psutil.Error):
        return None


def client_gone(client):
    """True only when the remembered Steam client process has certainly ended (Steam exited or restarted). Its session in
    this process is dead then and must be initialized again; a mere logoff keeps the same client process."""
    if client is None:
        return False
    try:
        return psutil.Process(client[0]).create_time() != client[1]
    except psutil.NoSuchProcess:
        return True
    except psutil.Error:
        return False


def reject_commands(commands, emit):
    """Sends that are already queued cannot go out while logged off: answer them 'failed' (they are never retried)."""
    for _ in range(32):
        try:
            command = commands.get_nowait()
        except queue.Empty:
            return
        if command.get("type") == "send":
            emit({"type": "result", "id": command["id"], "status": "failed"})


def await_logon(live, steam, client, commands, emit, stop):
    """Steam lost its server connection (BLoggedOn false). Keep this process and its Steam session (1.0.9): check logon
    every second and return once logged on again. Raises process_changed when the game ends (the process is then
    replaced) and steam_restarted when the Steam client process itself is gone (the session is re-initialized here)."""
    emit(unavailable("steam_unavailable"))
    context = {key: live.state.get(key, "") for key in ("account", "lobby", "generation")}
    while not stop.wait(STEAM_LOGON_POLL):
        reject_commands(commands, emit)
        steam.pump(context, set(), accept=False)   # keep the callback queue drained; nothing is accepted while offline
        if not live.game.alive():
            raise RuntimeError("process_changed")
        if client_gone(client):
            raise RuntimeError("steam_restarted")
        try:
            steam.account()
        except RuntimeError as exc:
            if str(exc) == "steam_unavailable":
                continue
            raise
        live.identity = None   # reconnected: start a new generation, as a fresh worker used to
        return


def unavailable(notice):
    return {"type": "state", "state": "unavailable", "notice": notice, "account": "", "lobby": "",
            "generation": "", "connected": False, "lobby_verified": False,
            "members": [], "profiles": {}, "send_enabled": False}


class LiveConnection:
    def __init__(self, game, steam, read_only=False, avatars=None, compatibility=None):
        self.game, self.steam = game, steam
        self.locator = LobbyLocator(steam)
        self.read_only, self.avatars = read_only, avatars
        self.compatibility = compatibility
        self.identity = None
        self.generation = ""
        self.state = unavailable("checking")
        self.profiles = {}
        self.profile_time = 0
        self.last_send = 0

    def destination(self):
        """Steam-verified destination: a candidate the game announced, confirmed by Steam membership + lobby data.
        Returns (account, lobby, members, valid, verified); valid and verified are the same check now."""
        if self.compatibility:
            self.compatibility.check()
        if not self.game.alive():
            raise RuntimeError("process_changed")
        account = self.steam.account()
        lobby, _, members = self.locator.locate(account)
        if self.steam.account() != account or not self.game.alive():
            raise RuntimeError("connection_changed")
        valid = lobby != "0"
        return account, lobby, members, valid, valid

    def allows(self, gate):
        return not self.compatibility or self.compatibility.allows(gate)

    def snapshot(self):
        account, lobby, members, valid, verified = self.destination()
        identity = (self.game.pid, self.game.created, account, lobby, valid)
        changed = identity != self.identity
        if changed:
            self.identity, self.generation = identity, str(uuid4())
            self.profiles = {}
            self.profile_time = 0
        if valid and time.monotonic()-self.profile_time >= 1:
            profiles = {}
            for uid in members:
                row = self.steam.profile(lobby, uid)
                if not self.allows("avatars"):
                    # T2 paused: the game's hat/skin member data meaning is unverified on this build, so show the
                    # Steam name and the default cat. Cat Talk's own fields in the row (warn/playlist/blocks, T0) stay.
                    row["hat"] = row["skin"] = None
                    profiles[uid] = row
                    continue
                # The game publishes -1 for an explicitly unequipped slot.
                # Its default body/paw sprites are CatLeft/CatRight. Unknown
                # slots and failed item lookups must not become default outfits.
                skin = "Cat" if row["skin"] == -1 else self.steam.definition(row["skin"], "name")
                hat = None if row["hat"] == -1 else self.steam.definition(row["hat"], "name")
                if self.avatars and skin and (hat or row["hat"] == -1):
                    row["avatar"] = self.avatars.get(skin.replace(" ", ""), hat.replace(" ", "") if hat else None)
                profiles[uid] = row
            self.profiles, self.profile_time = profiles, time.monotonic()
        if (self.steam.account() != account or (valid and not self.locator.still(account, lobby))
                or not self.game.alive()):
            raise RuntimeError("connection_changed")
        if not valid:
            notice = "no_lobby"
        else:
            notice = "read_only" if self.read_only else ""
        state = {"type": "state", "account": account, "lobby": lobby if valid else "",
                 "generation": self.generation, "connected": valid, "lobby_verified": verified,
                 "members": sorted(members) if verified else [],
                 "observed": time.monotonic(),
                 # Profiles refresh once a second, membership every tick.
                 "profiles": {uid: row for uid, row in self.profiles.items()
                              if verified and uid in members},
                 # T1: chat sending needs a known chat fingerprint; receiving does not (it only parses).
                 "send_enabled": verified and not self.read_only and self.allows("chat_send"),
                 "avatar_stage": getattr(self.avatars, "stage", "disabled"),
                 "avatar_error": getattr(self.avatars, "error", ""),
                 "state": "ready" if verified else "no_lobby",
                 "name": self.steam.room_name(lobby) if valid else "",
                 "lobby_source": self.locator.source if valid else "",   # diagnostics only (presence/registry/callback/friends)
                 # Paused gates for the soft banner; the public build number only names the build in that banner.
                 "degraded": list(self.compatibility.degraded) if self.compatibility else [],
                 # Features whose fingerprint the contract does not list: the sidecar tells main to fetch the remote manifest (1.0.8 ②).
                 "unknown": list(self.compatibility.unknown) if self.compatibility else [],
                 "game_build": self.compatibility.build if self.compatibility else "",
                 "notice": notice}
        self.state = state
        return state, members, changed

    def send(self, command):
        if self.read_only or time.monotonic()-self.last_send < 1.0:
            return "failed"
        if time.monotonic()-command.get("queued", 0) > 2.0:
            return "failed"
        account, lobby, members, valid, verified = self.destination()
        identity = (self.game.pid, self.game.created, account, lobby, valid)
        current = {"account": account, "lobby": lobby, "generation": self.generation}
        if (not verified or not self.state.get("send_enabled") or identity != self.identity
                or command.get("context") != current):
            return "failed"
        # Bind the original destination. A game move after this check is not atomic.
        if (not self.locator.still(current["account"], current["lobby"]) or self.steam.account() != current["account"]
                or not self.game.alive()):
            return "failed"
        if self.compatibility:
            self.compatibility.check()
        self.last_send = time.monotonic()
        try:
            return "accepted" if self.steam.send(current["lobby"], command["text"]) else "failed"
        except Exception:
            return "unknown"  # Never retry this command.


def run_worker(commands, events, stop, read_only=False, render_avatars=True):
    def emit(event):
        try:
            events.put(event, timeout=0.2)
        except queue.Full:
            # Stop rather than silently drop history or preserve a stale ready state.
            stop.set()
            raise RuntimeError("event_queue_overflow")

    steam_held = False   # this process has initialized Steam: Steam counts it as Bongo Cat until it exits (D-019)
    while not stop.is_set():
        steam = avatars = game = None
        try:
            emit(unavailable("checking"))
            game = running_game()
            compatibility = verify_compatibility(game.root, stop)
            steam = Steam(game.root)
            steam.start()
            client = steam_client()
            compatibility.check()
            live = LiveConnection(game, steam, read_only, compatibility=compatibility)
            last_state, last_emit, receive_context = None, 0, None
            receive_senders = set()
            reactions = ReactionAssets()
            while not stop.is_set():
                # No memory discovery: the lobby is located from Steam on every snapshot (lobby.LobbyLocator).
                try:
                    state, members, changed = live.snapshot()
                except RuntimeError as exc:
                    if str(exc) != "steam_unavailable":
                        raise
                    await_logon(live, steam, client, commands, emit, stop)
                    receive_context = None   # drop the first callback batch after reconnecting
                    continue
                context = {k: state[k] for k in ("account", "lobby", "generation")}
                if state != last_state or time.monotonic()-last_emit >= 0.5:
                    emit(state)
                    last_state, last_emit = state, time.monotonic()
                # Drain callbacks after transitions without attributing old payloads to a new segment.
                allowed = set(state["members"])
                # Drop nonmembers before copying a body. Also drain
                # the first batch after verification so pending-period callbacks
                # cannot be relabelled as messages received after synchronization.
                for message in steam.pump(context, members & allowed & receive_senders,
                                          accept=receive_context == context):
                    if message["type"] == "reaction":
                        reactions.add(message)
                    else:
                        emit(message)  # Preserve the callback's original observed timestamp.
                for reaction in reactions.ready(state, steam, avatars):
                    # Flavor can be dropped under load; never stop chat for it.
                    try:
                        events.put_nowait(reaction)
                    except queue.Full:
                        pass
                receive_context, receive_senders = context, allowed
                # Asset decoding is heavy (GIL). Publish verified chat readiness before starting that work.
                if state["lobby_verified"] and render_avatars and not avatars:
                    from .avatars import Avatars
                    avatars = Avatars(game.root)
                    live.avatars = avatars
                logged_off = False
                for _ in range(32):
                    try:
                        command = commands.get_nowait()
                    except queue.Empty:
                        break
                    if command.get("type") == "send":
                        try:
                            status = live.send(command)
                        except RuntimeError as exc:
                            if str(exc) != "steam_unavailable":
                                raise
                            status, logged_off = "failed", True   # logged off between the snapshot and this send
                        emit({"type": "result", "id": command["id"], "status": status})
                    elif command.get("type") == "refresh":
                        live.profile_time = 0
                if logged_off:
                    await_logon(live, steam, client, commands, emit, stop)
                    receive_context = None
                    continue
                stop.wait(0.15)
        except Exception as exc:
            if not stop.is_set():
                # Only fixed diagnostic codes; never addresses, account IDs or text.
                code = str(exc)
                if not code.isascii() or not code.replace("_", "").isalnum() or len(code) > 80:
                    code = "connection_unavailable"
                state = unavailable(code)
                if isinstance(exc, UnsupportedGameBuild):
                    state.update(game_build=exc.build, build_fingerprint=exc.fingerprint)
                emit(state)
        finally:
            if avatars:
                avatars.close()
            if steam:
                steam_held = steam_held or steam.initialized
                steam.close()  # No LeaveLobby, joins or lobby setting mutations.
        if stop.is_set():
            break
        if steam_held and not (game is not None and game.alive()):
            # Bongo Cat is gone while Steam still counts this process as the game; only exiting releases it (D-019).
            # Ask the sidecar to replace this process (D-051) and end: Steam is never initialized here again.
            try:
                emit(dict(RETIRE))
            except RuntimeError:
                pass   # the queue is full and stop is set: end anyway
            stop.wait(RETIRE_WAIT)
            break
        stop.wait(RETRY_DELAY)
