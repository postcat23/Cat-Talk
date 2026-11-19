"""Separate native process. Its IPC has no network listener or auto-send source.

Cat Talk 1.0.8 (fork): the lobby comes from Steam (lobby.LobbyLocator), not from game memory. The game's own lobby
announcements are candidates and Steam membership is the authority, so chat no longer depends on the game's managed
code layout (the lobby/privacy fingerprints that stopped 1.0.6 on build 26754239)."""
import queue
import time
from uuid import uuid4

from .environment import UnsupportedGameBuild, running_game, verify_compatibility
from .lobby import LobbyLocator
from .steam import Steam
from .reactions import ReactionAssets


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
                 "send_enabled": verified and not self.read_only,
                 "avatar_stage": getattr(self.avatars, "stage", "disabled"),
                 "avatar_error": getattr(self.avatars, "error", ""),
                 "state": "ready" if verified else "no_lobby",
                 "name": self.steam.room_name(lobby) if valid else "",
                 "lobby_source": self.locator.source if valid else "",   # diagnostics only (presence/registry/callback/friends)
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

    while not stop.is_set():
        steam = avatars = None
        try:
            emit(unavailable("checking"))
            game = running_game()
            compatibility = verify_compatibility(game.root, stop)
            steam = Steam(game.root)
            steam.start()
            compatibility.check()
            live = LiveConnection(game, steam, read_only, compatibility=compatibility)
            last_state, last_emit, receive_context = None, 0, None
            receive_senders = set()
            reactions = ReactionAssets()
            while not stop.is_set():
                # No memory discovery: the lobby is located from Steam on every snapshot (lobby.LobbyLocator).
                state, members, changed = live.snapshot()
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
                for _ in range(32):
                    try:
                        command = commands.get_nowait()
                    except queue.Empty:
                        break
                    if command.get("type") == "send":
                        status = live.send(command)
                        emit({"type": "result", "id": command["id"], "status": status})
                    elif command.get("type") == "refresh":
                        live.profile_time = 0
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
                steam.close()  # No LeaveLobby, joins or lobby setting mutations.
        stop.wait(3)
