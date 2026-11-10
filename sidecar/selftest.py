"""사이드카 자가 점검: `cattalk-sidecar.exe --selftest [--game <게임 설치 폴더>]` (D-036).

PyInstaller 번들이 Python 없는 PC에서도 사이드카의 실제 경로를 갖췄는지 본다. 게임 프로세스·Steam에는
붙지 않는다(메모리 읽기·Steam 초기화 없음). 게임 폴더는 읽기만 한다.
- spawn: spawn 자식 프로세스가 뜨는지(번들의 multiprocessing.freeze_support 경로, worker와 같은 방식)
- contract: 호환성 계약(feature-contract.json)을 upstream이 찾는 경로에서 읽는지
- helpers: FeatureProbe.exe·MemoryScan.exe가 upstream이 찾는 경로에 있는지
- compatibility(--game): 실제 게임 폴더로 호환성 판정(해시 + FeatureProbe 메타데이터 판독, 읽기 전용)
- avatar(--game): UnityPy + Pillow로 게임 에셋에서 기본 고양이를 합성하는지(upstream Avatars 그대로)
- fmod: FMOD(fmod_toolkit·pyfmodex·fmod.dll)가 프로세스에 올라왔는지. 번들은 올라오면 실패(런타임 훅으로 제외)
결과는 JSON 한 줄로 stdout에 쓰고, 모두 통과하면 종료 코드 0이다. 이름·ID·대화·이미지 내용은 내보내지 않는다.
"""
import base64
import ctypes
import json
import multiprocessing as mp
from pathlib import Path
import sys
import time

DEFAULT_SKIN = "Cat"   # default_avatar.DEFAULT_SKIN과 같은 값(그 모듈은 worker 글루라 여기서 import하지 않는다)
AVATAR_TIMEOUT = 120   # 에셋 로드 + 합성 1장 상한(초)


def _child(queue):
    queue.put("ok")


def _spawn_ok(timeout=30):
    context = mp.get_context("spawn")
    queue = context.Queue()
    process = context.Process(target=_child, args=(queue,))
    process.start()
    try:
        return queue.get(timeout=timeout) == "ok"
    except Exception:
        return False
    finally:
        process.join(5)
        if process.is_alive():
            process.kill()


def _dll_loaded(name):
    if sys.platform != "win32":
        return False
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetModuleHandleW.restype = ctypes.c_void_p
    kernel32.GetModuleHandleW.argtypes = [ctypes.c_wchar_p]
    return bool(kernel32.GetModuleHandleW(name))


def _helper_dir(module):
    # environment.probe_features·memory.MemoryScan과 같은 식(upstream 무수정이라 여기서 같은 규칙으로 계산한다)
    if getattr(sys, "frozen", False):
        return Path(module.__file__).with_name("compatibility")
    return Path(module.__file__).resolve().parents[2] / "artifacts/compatibility"


def _avatar(root):
    from bongo_chat.avatars import Avatars
    avatars = Avatars(root)
    key, uri = (DEFAULT_SKIN, None), None
    deadline = time.monotonic() + AVATAR_TIMEOUT
    try:
        while time.monotonic() < deadline and avatars.stage != "unavailable":
            uri = avatars.get(*key)
            if uri:
                break
            with avatars.lock:
                if key in avatars.cache:   # 합성 실패는 None으로 캐시된다
                    break
            time.sleep(0.2)
    finally:
        avatars.close()
    png = base64.b64decode(uri.split(",", 1)[1]) if uri else b""
    ok = png.startswith(b"\x89PNG")
    return ok, {"stage": avatars.stage, "error": avatars.error, "png_bytes": len(png)}


def run(argv):
    from bongo_chat import environment, memory
    frozen = bool(getattr(sys, "frozen", False))
    checks, report = {}, {"frozen": frozen}

    checks["spawn"] = _spawn_ok()

    try:
        environment.compatibility_contract()
        checks["contract"] = True
    except RuntimeError:
        checks["contract"] = False

    probe = _helper_dir(environment) / "FeatureProbe.exe"
    scan = _helper_dir(memory) / "MemoryScan.exe"
    checks["helpers"] = probe.is_file() and scan.is_file()

    game = argv[argv.index("--game") + 1] if "--game" in argv[:-1] else None
    if game:
        root = Path(game)
        try:
            report["build"] = environment.verify_compatibility(root).build
            checks["compatibility"] = True
        except environment.UnsupportedGameBuild:
            checks["compatibility"], report["compatibility_error"] = False, "unsupported_game_build"
        except RuntimeError as exc:
            checks["compatibility"], report["compatibility_error"] = False, str(exc)
        checks["avatar"], report["avatar"] = _avatar(root)

    report["fmod"] = {"fmod_toolkit": "fmod_toolkit" in sys.modules, "pyfmodex": "pyfmodex" in sys.modules,
                      "fmod.dll": _dll_loaded("fmod.dll")}
    if frozen:   # 개발 실행(시스템 Python)은 UnityPy가 FMOD를 불러오므로 판정하지 않는다
        checks["fmod_excluded"] = not any(report["fmod"].values())

    report["checks"] = checks
    report["ok"] = all(checks.values())
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return 0 if report["ok"] else 1
