# -*- mode: python ; coding: utf-8 -*-
# Cat-Talk 사이드카 PyInstaller spec — onedir, 창 없음(D-036). scripts/build-sidecar.ps1이 실행한다.
#
# - 진입점 sidecar/server.py. upstream src/bongo_chat은 수정하지 않고, 정적 분석이 따라가는 모듈만 들어간다
#   (사이드카 경로 12개). collect_submodules는 쓰지 않는다 — 쓰면 안 쓰는 updates·merge_* 등이 딸려 온다.
# - 호환성 계약·도구는 upstream 번들과 같은 bongo_chat/ 아래에 둔다. environment.py·memory.py가 frozen일 때
#   Path(__file__).with_name(...)으로 찾는 경로다.
# - FMOD 제외: UnityPy 1.25.4는 Sprite만 읽어도 export/__init__ → AudioClipConverter → fmod_toolkit을 import한다.
#   런타임 훅(upstream packaging/hooks/disable_unity_audio.py 사본)이 AudioClipConverter를 빈 모듈로 먼저 등록하므로
#   fmod_toolkit·pyfmodex·AudioClipConverter는 번들에 넣지 않는다(fmod.dll 미포함).
# - Qt 전용 upstream 모듈과 PySide6는 사이드카 경로에 없지만 안전망으로 제외 목록에 둔다.
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, copy_metadata

HERE = Path(SPECPATH).resolve()
ROOT = HERE.parents[1]
SRC = ROOT / "src"
COMPAT = ROOT / "artifacts" / "compatibility"

datas = [
    (str(SRC / "bongo_chat" / "feature-contract.json"), "bongo_chat"),
    (str(COMPAT / "FeatureProbe.exe"), "bongo_chat/compatibility"),
    (str(COMPAT / "MemoryScan.exe"), "bongo_chat/compatibility"),
    (str(COMPAT / "Mono.Cecil.dll"), "bongo_chat/compatibility"),
    (str(ROOT / "tools" / "compatibility" / "Mono.Cecil.LICENSE.txt"), "bongo_chat/compatibility"),
]
datas += collect_data_files("UnityPy") + collect_data_files("archspec") + copy_metadata("UnityPy")

excludes = [
    "PySide6", "shiboken6",
    "bongo_chat.localization", "bongo_chat.windows_notifications", "bongo_chat.desktop",
    "bongo_chat.update_diagnostic",
    "fmod_toolkit", "pyfmodex", "UnityPy.export.AudioClipConverter",
]

a = Analysis(
    [str(ROOT / "sidecar" / "server.py")],
    pathex=[str(SRC), str(ROOT / "sidecar")],
    binaries=[],
    datas=datas,
    hiddenimports=[],
    hookspath=[],
    runtime_hooks=[str(HERE / "rthook_disable_unity_audio.py")],
    excludes=excludes,
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="cattalk-sidecar",
    debug=False,
    strip=False,
    upx=False,                        # 압축 실행 파일은 백신 오탐이 잦다
    console=False,                    # pythonw처럼 창 없음. stdin/stdout은 Electron이 파이프로 넘긴다
    disable_windowed_traceback=True,  # 지금 pyw처럼 오류 대화상자를 띄우지 않는다(stderr만)
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="cattalk-sidecar")
