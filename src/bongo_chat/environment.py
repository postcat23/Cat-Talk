"""Discover the running installation, never launch or change the game.

Cat Talk 1.0.8 (fork): compatibility is judged per feature, not as one five-fingerprint combination. The contract is
Cat Talk-owned (sidecar/compat/contract.json, schema 2) and maps each feature to a tier and a gate:
  T0  Steam core (lobby via Steam, participants, names, warn/wanted/playlist, blocks) - no game-code fingerprint;
      needs only the Steam API exports (steam.REQUIRED_EXPORTS). Always on.
  T1  game chat protocol: chat fingerprint unknown -> gate 'chat_send' paused (receiving continues).
  T2  profile meaning: profiles fingerprint unknown -> gate 'avatars' paused (names + default cat).
  T3  game patch (auto chest/transparent/hidden cats): judged by the patcher in Electron, app release only.
  memory  lobby/privacy fingerprints of the Mono memory layer: kept as data, gate nothing (chat does not read memory).
A broken or missing contract/probe pauses every T1/T2 gate but never blocks T0."""
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import os
import subprocess
import sys
import time

import psutil

CONTRACT_NAME = "contract.json"
FEATURES = ("chat", "reactions", "profiles", "lobby", "privacy")
TIERS = {"T1", "T2", "memory"}
GATES = ("chat_send", "avatars")
UNAVAILABLE = "unavailable"


def contract_path():
    """CATTALK_CONTRACT (set by Electron main to the effective contract: bundle + verified remote manifest, 1.0.8 ②) or the bundled default."""
    override = os.environ.get("CATTALK_CONTRACT")
    if override:
        return Path(override)
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) / "compat" / CONTRACT_NAME
    return Path(__file__).resolve().parents[2] / "sidecar" / "compat" / CONTRACT_NAME


SUPPORT_PATH = contract_path()
BUILD_FILES = (
    "BongoCat_Data/Managed/Assembly-CSharp.dll",
    "BongoCat_Data/Plugins/x86_64/steam_api64.dll",
    "MonoBleedingEdge/EmbedRuntime/mono-2.0-bdwgc.dll",
    "BongoCat_Data/Managed/Heathen.Steamworks.dll",
)


class UnsupportedGameBuild(RuntimeError):
    def __init__(self, build, fingerprint):
        super().__init__("unsupported_game_build")
        self.build, self.fingerprint = build, fingerprint


def installed_build(root):
    """Public build number for diagnostics only; never an authorization source."""
    try:
        with (root.parent.parent / "appmanifest_3419430.acf").open("rb") as stream:
            raw = stream.read(65537)
        if len(raw) > 65536:
            return ""
        text = raw.decode("utf-8-sig")
        app = re.findall(r'"appid"\s+"([0-9]+)"', text)
        build = re.findall(r'"buildid"\s+"([0-9]{1,12})"', text)
        return build[0] if app == ["3419430"] and len(build) == 1 else ""
    except (OSError, UnicodeError):
        return ""


def _digests(values, limit):
    return (isinstance(values, list) and len(values) <= limit
            and all(isinstance(v, str) and re.fullmatch(r"[0-9a-f]{64}", v) for v in values))


def compatibility_contract(path=None):
    """Load and validate the schema 2 contract. Raises RuntimeError('unsupported_feature_contract')."""
    try:
        catalog = json.loads(Path(path or SUPPORT_PATH).read_text(encoding="utf-8"))
        policy, native, patch = catalog["policy"], catalog["native"], catalog["patch"]
        valid = (catalog["schema"] == 2 and catalog["assemblies"] == ["Assembly-CSharp.dll", "Heathen.Steamworks.dll"]
                 and isinstance(catalog["features"], dict) and set(catalog["features"]) == set(FEATURES)
                 and isinstance(policy, dict) and set(policy) == set(FEATURES))
        valid = valid and all(
            isinstance(row, dict) and row.get("tier") in TIERS and row.get("gate") in (*GATES, None)
            and row.get("recovery") in ("data", "app") and _digests(row.get("fingerprints"), 64)
            and (row["gate"] is None or row["tier"] in ("T1", "T2"))
            for row in policy.values())
        valid = valid and native.get(BUILD_FILES[1], {}).get("check") == "exports" and _digests(
            native.get(BUILD_FILES[2], {}).get("sha256"), 16)
        # T3 can only be narrowed by data (remote 'restrict'): a deny list of clean Assembly-CSharp hashes.
        valid = valid and patch.get("tier") == "T3" and patch.get("remote") == "restrict" and _digests(
            patch.get("deny_sha256"), 256)
        if not valid:
            raise ValueError
        return catalog
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        raise RuntimeError("unsupported_feature_contract") from exc


def file_stamps(root):
    """Detect an update during verification or an active connection; no IDs/logs."""
    result = []
    for name in BUILD_FILES:
        stat = (root / name).stat()
        result.append((stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns))
    return tuple(result)


@dataclass(frozen=True)
class Compatibility:
    root: Path
    stamps: tuple
    build: str
    known: tuple = ()      # features whose fingerprint the contract lists (any tier)
    unknown: tuple = ()    # features whose fingerprint is not listed or could not be computed
    degraded: tuple = ()   # paused gates (T1 'chat_send', T2 'avatars'); T0 is never in here

    def allows(self, gate):
        return gate not in self.degraded

    def check(self):
        try:
            if self.stamps == file_stamps(self.root):
                return
        except OSError:
            pass
        raise RuntimeError("game_files_changed")


def probe_features(root, stop=None, path=None):
    """{feature: 64-hex digest or 'unavailable'}; FeatureProbe isolates features, so one broken root hides only itself."""
    helper = (Path(__file__).with_name("compatibility") if getattr(sys, "frozen", False)
              else Path(__file__).resolve().parents[2] / "artifacts/compatibility") / "FeatureProbe.exe"
    if not helper.is_file():
        raise RuntimeError("compatibility_tool_missing")
    # Invoke only the shipped metadata reader, with arguments (never shell text).
    # It does not execute the game, load it through reflection, or write to it.
    process = subprocess.Popen([str(helper), str(root / "BongoCat_Data/Managed"), str(path or SUPPORT_PATH)],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    started = time.monotonic()
    try:
        while True:
            if stop and stop.is_set():
                raise RuntimeError("compatibility_cancelled")
            if time.monotonic() - started > 20:
                raise RuntimeError("compatibility_timeout")
            try:
                output, _ = process.communicate(timeout=0.1)
                break
            except subprocess.TimeoutExpired:
                continue
        if process.returncode != 0 or len(output) > 4096:
            raise ValueError("feature_probe_failed")
        features = json.loads(output)
        if (not isinstance(features, dict) or set(features) != set(FEATURES)
                or not all(isinstance(v, str) and (v == UNAVAILABLE or re.fullmatch(r"[0-9a-f]{64}", v))
                           for v in features.values())):
            raise ValueError("feature_probe_failed")
        return features
    finally:
        if process.poll() is None:
            process.kill()  # Our helper only, never the game/Steam.
        process.communicate()


@dataclass(frozen=True)
class GameProcess:
    pid: int
    created: float
    root: Path

    def alive(self):
        try:
            process = psutil.Process(self.pid)
            return process.create_time() == self.created and Path(process.exe()).resolve() == self.root / "BongoCat.exe"
        except (psutil.Error, OSError):
            return False


def running_game():
    games = []
    # Reading executable paths for every Windows process can take seconds.
    # Resolve the path and lifetime only for matching game processes.
    for process in psutil.process_iter(["name"]):
        if (process.info["name"] or "").lower() != "bongocat.exe":
            continue
        try:
            with process.oneshot():
                executable = process.exe()
                if not executable:
                    continue
                path = Path(executable).resolve()
                created = process.create_time()
            games.append(GameProcess(process.pid, created, path.parent))
        except (psutil.Error, OSError):
            continue
    if len(games) != 1:
        raise RuntimeError("game_missing_or_ambiguous")
    return games[0]


def evaluate(catalog, digests):
    """Per-feature judgement -> (known, unknown, degraded). Pure: no files, no processes (unit-testable)."""
    known, unknown = [], []
    for feature in FEATURES:
        listed = catalog and digests.get(feature) in set(catalog["policy"][feature]["fingerprints"])
        (known if listed else unknown).append(feature)
    if not catalog:
        return tuple(known), tuple(unknown), GATES   # no contract: every T1/T2 gate pauses, T0 keeps running
    degraded = sorted({catalog["policy"][f]["gate"] for f in unknown if catalog["policy"][f]["gate"]})
    return tuple(known), tuple(unknown), tuple(degraded)


def verify_compatibility(root, stop=None):
    """Never refuses a build for unknown fingerprints (1.0.8): it reports which gates to pause instead.
    Only cancellation propagates; a missing/slow probe or a broken contract degrades T1/T2 and leaves T0 running."""
    try:
        catalog = compatibility_contract()
    except RuntimeError:
        catalog = None
    try:
        before = file_stamps(root)
    except OSError:
        before = None
    digests = {}
    if catalog and before is not None:
        try:
            digests = probe_features(root, stop)
        except RuntimeError as exc:
            if str(exc) == "compatibility_cancelled":
                raise
        except (ValueError, OSError, subprocess.SubprocessError):
            pass
    known, unknown, degraded = evaluate(catalog, digests)
    result = Compatibility(root, before, installed_build(root), known, unknown, degraded)
    result.check()
    return result


def verify_build(root):
    """Legacy diagnostic entry point; a build number never authorizes support."""
    return verify_compatibility(root).build
