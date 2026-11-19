"""Bongo Cat lobby identity from Steam only — no game memory (Cat Talk 1.0.8, fork of upstream worker).

The game publishes its current lobby in four places. Every value is only a candidate: a lobby is accepted only when
Steam lists this account as a member of it and it carries Bongo Cat (Heathen) lobby data. Steam membership is also what
leaves first when the game leaves a lobby (measured), so a stale candidate can never become a send destination.

  presence  own rich presence steam_player_group / connect = lobby account id in hex (game Steam.SteamRichPresence:
            set on lobby enter, ClearRichPresence on leave). Steam ID = CSteamID(id, instance 0x60000, universe 1, type 8),
            the same rebuild as Heathen LobbyData.Get(uint).
  registry  PlayerPrefs LAST_LOBBY = Base59 of the lobby Steam ID (game LastLobbyJoin: written on join, deleted on leave
            except while a rejoin target). Local, independent of Steam presence.
  callback  lobby ids carried by LobbyDataUpdate/LobbyChatUpdate/LobbyChatMsg (505/506/507). Passive; also reports lobbies
            the game only queried (e.g. before a rejoin), so membership decides.
  friends   GetFriendGamePlayed(self).m_steamIDLobby. Missing while another Steam game runs (upstream D-024) or in a
            private lobby (measured).

Order = measured robustness (2026-11-19 Phase 1, 0.25 s ticks): presence and registry followed the game within one tick
on every lobby enter/leave, alone, private/friends/public lobby, with another Steam game running and with Steam
status offline/invisible. callback can stay silent for over 30 s in an idle solo lobby. friends lags 0.25-0.5 s.
"""
import os
import re
import time
import winreg

APP_ID = 3419430
SOURCES = ("presence", "registry", "callback", "friends")
REGISTRY_KEY = r"Software\Irox Games\BongoCat"
REGISTRY_PREFIX = "LAST_LOBBY_h"
BASE59 = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
# Lobby data written by the game/Heathen on every Bongo Cat lobby (any one is enough: one renamed key must not drop T0).
LOBBY_TAGS = (b"LOBBY_NAME", b"z_heathenMode", b"PRIVATE_LOBBY", b"HIDE_LOBBY_CODE")
CALLBACK_WINDOW = 60.0   # seconds a callback-observed lobby stays a candidate
CALLBACK_CANDIDATES = 3


def lobby_from_account(account_id):
    return str((1 << 56) | (8 << 52) | (0x60000 << 32) | account_id) if 0 < account_id <= 0xFFFFFFFF else "0"


def is_lobby_id(value):
    return (value >> 56) == 1 and ((value >> 52) & 0xF) == 8 and (value & 0xFFFFFFFF) != 0


def parse_presence(value):
    """steam_player_group/connect value -> lobby Steam ID string ('0' if absent or not a lobby)."""
    value = (value or "").strip()
    if re.fullmatch(r"[0-9A-Fa-f]{1,8}", value):
        return lobby_from_account(int(value, 16))
    if re.fullmatch(r"[0-9]{17,20}", value) and is_lobby_id(int(value)):   # tolerate a full Steam ID in a future build
        return value
    return "0"


def decode_base59(text):
    value = 0
    for ch in text:
        index = BASE59.find(ch)
        if index < 0:
            raise ValueError("invalid_base59")
        value = value * 59 + index
    return value


class RegistryHint:
    """PlayerPrefs LAST_LOBBY. The value name carries Unity's hash suffix, so it is found by prefix once and cached."""

    def __init__(self):
        self.name, self.rescan_at = None, 0.0

    def _find(self, key):
        index = 0
        while True:
            try:
                name, _, _ = winreg.EnumValue(key, index)
            except OSError:
                return None
            if name.startswith(REGISTRY_PREFIX):
                return name
            index += 1

    def lobby(self):
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REGISTRY_KEY) as key:
                raw = None
                if self.name:
                    try:
                        raw, _ = winreg.QueryValueEx(key, self.name)
                    except FileNotFoundError:
                        raw = None   # deleted on leave: no lobby
                elif time.monotonic() >= self.rescan_at:
                    self.name = self._find(key)
                    self.rescan_at = time.monotonic() + 5
                    if self.name:
                        raw, _ = winreg.QueryValueEx(key, self.name)
        except OSError:
            return "0"
        if not isinstance(raw, bytes):
            return "0"
        try:
            value = decode_base59(raw.rstrip(b"\0").decode("ascii"))
        except (UnicodeDecodeError, ValueError):
            return "0"
        return str(value) if is_lobby_id(value) else "0"


class LobbyLocator:
    def __init__(self, steam):
        self.steam = steam
        self.registry = RegistryHint()
        # Diagnostic override (order/subset), e.g. CATTALK_LOBBY_SOURCES=registry,callback. Unknown names are ignored.
        override = [s.strip() for s in os.environ.get("CATTALK_LOBBY_SOURCES", "").split(",") if s.strip() in SOURCES]
        self.sources = tuple(override) or SOURCES
        self.source = ""

    def candidates(self, account):
        for source in self.sources:
            try:
                if source == "presence":
                    yield source, parse_presence(self.steam.own_presence(b"steam_player_group")
                                                 or self.steam.own_presence(b"connect"))
                elif source == "registry":
                    yield source, self.registry.lobby()
                elif source == "callback":
                    for lobby in self.steam.observed_lobbies(CALLBACK_WINDOW)[:CALLBACK_CANDIDATES]:
                        yield source, lobby
                elif source == "friends":
                    app, lobby = self.steam.reported_game(account)
                    yield source, lobby if app == APP_ID else "0"
            except Exception:
                continue   # one broken source must not hide the others

    def locate(self, account):
        """(lobby, source, members) for the first candidate Steam confirms; ('0', '', set()) when none."""
        tried = set()
        for source, lobby in self.candidates(account):
            if lobby == "0" or lobby in tried:
                continue
            tried.add(lobby)
            members = self.steam.members(lobby)
            if account in members and self.steam.lobby_tagged(lobby):
                self.source = source
                return lobby, source, members
        self.source = ""
        return "0", "", set()

    def still(self, account, lobby):
        """Cheap re-confirmation right before a send: this account is still a member of that lobby."""
        return lobby != "0" and account in self.steam.members(lobby)
