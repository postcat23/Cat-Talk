# 서드파티 고지 (Third-Party Notices)

Cat-Talk 자체 코드에는 루트 [LICENSE](LICENSE)(PolyForm Noncommercial License 1.0.0)가 적용됩니다. "Cat Talk" 이름·앱 아이콘·로고는 그 라이선스에서도 빠지며 모든 권리를 유보합니다([NOTICE](NOTICE)).
아래 구성요소는 각자의 원래 라이선스를 그대로 따르며, LICENSE의 조건은 이 구성요소에 적용되지 않습니다.
라이선스 원문은 [LICENSES/](LICENSES/)에 원본 그대로 두었습니다.

- 기준: 2026-11-10, Cat-Talk 0.0.1, upstream bongo-cat-chat `981dd43`(v0.1.0.dev21), 사이드카 번들 PyInstaller 6.22.3 + Python 3.11.5
- 버전 출처: npm은 `package-lock.json`, 사이드카 번들은 빌드 venv(`scripts/build-sidecar.ps1`)에 설치된 패키지
- 이 목록은 각 패키지가 선언하고 동봉한 라이선스를 옮긴 것입니다. 패키지 안 네이티브 하위 구성요소까지 모두 확인한 법률 검토는 아닙니다.

## 1. bongo-cat-chat (upstream)

- 출처: <https://github.com/misosiruda/bongo-cat-chat> — 커밋 `981dd438ca52aeb6a892fd99b3c46bce5b090b63`(태그 `v0.1.0.dev21`)
- 라이선스: MIT — Copyright (c) 2026 Bongo Cat Chat contributors — 원문 [LICENSES/bongo-cat-chat.txt](LICENSES/bongo-cat-chat.txt)

### 1-1. 원본 그대로인 파일

upstream `981dd43`과 git blob 해시가 같은(바이트 단위로 동일한) 파일입니다(2026-11-10 대조). Cat-Talk는 이 파일들을 수정하지 않습니다.

**`src/bongo_chat/` — 36개**

`__init__.py` · `__main__.py` · `auto_merge.py` · `avatars.py` · `bootstrap.py` · `desktop.py` · `environment.py` · `exit_codes.py` · `feature-contract.json` · `localization.py` · `memory.py` · `merge_bootstrap.py` · `merge_bridge.py` · `merge_connection.py` · `merge_install.py` · `notifications.py` · `presence.py` · `privacy.py` · `profiles.py` · `protocol.py` · `reactions.py` · `service.py` · `steam.py` · `store.py` · `ui/app-icon.ico` · `ui/app-icon.png` · `ui/app.js` · `ui/favicon.ico` · `ui/index.html` · `ui/messenger.css` · `ui/translations.json` · `update-config.json` · `update_diagnostic.py` · `updates.py` · `windows_notifications.py` · `worker.py`

이 중 `ui/app-icon.ico`·`ui/app-icon.png`·`ui/favicon.ico`는 upstream의 MIT 자산이라, NOTICE의 Cat Talk 브랜딩 유보 대상이 아닙니다.
설치본에는 이 중 사이드카가 쓰는 12개 모듈이 사이드카 번들(3절) 안에 바이트코드로 들어가고, `feature-contract.json`은 번들 안과 `resources/src/bongo_chat/`(설치 사전 점검용)에 원본 파일로 들어갑니다.

**`tools/` — 37개**

`audit_distribution.py` · `collect_license_notices.py` · `compatibility/FeatureProbe.cs` · `compatibility/MemoryScan.cs` · `compatibility/Mono.Cecil.LICENSE.txt` · `download_nsis.py` · `export_icons.py` · `launch.py` · `launch_bootstrap.py` · `merge_bridge/Bridge.cs` · `merge_bridge/BridgeFixture.cs` · `merge_bridge/Prepare.cs` · `merge_bridge/bootstrap.py` · `merge_bridge/bootstrap_fixture.py` · `merge_bridge/build.ps1` · `merge_bridge/client.py` · `merge_bridge/create-session.ps1` · `merge_bridge/install.py` · `merge_bridge/local-contract.json` · `merge_bridge/mono_load_fixture.py` · `merge_bridge/prepare-assets.ps1` · `merge_bridge/test-bridge.ps1` · `merge_bridge/verify-files.py` · `prepare-compatibility.ps1` · `prepare-nsis.ps1` · `prepare_live_test.py` · `prepare_source_notices.py` · `probe_merge_readonly.py` · `probe_notifications.py` · `probe_readonly.py` · `probe_startup.py` · `probe_windows_toast.ps1` · `release.py` · `request-release.ps1` · `run_authorized_test.py` · `verify_review_bundle.py` · `windows_version.py`

**`scripts/sidecar/` — 1개**

`rthook_disable_unity_audio.py` — upstream `packaging/hooks/disable_unity_audio.py`의 바이트 동일 사본. 사이드카 번들의 런타임 훅으로 쓴다(3절 FMOD 참고).

Cat-Talk가 추가한 다음 파일은 위 목록에서 제외했습니다: `src/bongo_chat/_UPSTREAM.md`, `tools/_UPSTREAM.md`, `tools/auto_chest/`(5개, Cat-Talk 고유 패처).

### 1-2. upstream 소스로 빌드해 설치본에 넣는 파일

| 설치본 파일 | 빌드 소스 |
|---|---|
| `artifacts/compatibility/FeatureProbe.exe`, 사이드카 번들 안 `sidecar-bin/_internal/bongo_chat/compatibility/FeatureProbe.exe` | `tools/compatibility/FeatureProbe.cs` |
| `artifacts/compatibility/MemoryScan.exe`, 사이드카 번들 안 `sidecar-bin/_internal/bongo_chat/compatibility/MemoryScan.exe` | `tools/compatibility/MemoryScan.cs` |

### 1-3. upstream 코드를 옮겨 온 부분 (Cat-Talk 파일 안)

아래 파일에는 upstream 코드를 옮겨 와 고친 부분이 섞여 있습니다. 옮겨 온 부분은 MIT를 따르고, 나머지 Cat-Talk가 작성한 부분은 LICENSE를 따릅니다.

| 파일 | upstream 출처 | 옮겨 온 내용 |
|---|---|---|
| `sidecar/server.py` | `src/bongo_chat/desktop.py` | 브리지의 이벤트 수신·명령 처리·설정 검증 등(같은 줄 93줄, 40군데) |
| `sidecar/volatile_store.py` | `src/bongo_chat/store.py` | 메서드 시그니처와 설정 조회 구현 일부(같은 줄 7줄) |

`renderer/`는 upstream `ui/app.js`의 화면 동작을 참고해 React로 새로 작성했습니다. 줄 단위 대조에서 옮겨 온 코드가 확인되지 않아(파일마다 같은 줄 5줄 미만) Cat-Talk 코드로 분류했습니다.

> 확인 방법: '원본 그대로'는 git blob 해시 비교로, '옮겨 온 코드'는 공백을 정리한 20자 이상 줄이 upstream 파일에 그대로 있는지로 찾았습니다.

## 2. 설치본에 들어가는 구성요소

### 2-1. Electron 런타임

| 구성요소 | 버전 | 라이선스 | 저작권자 | 원문 |
|---|---|---|---|---|
| Electron | 45.2.1 | MIT | Electron contributors; GitHub Inc. | [Electron.txt](LICENSES/Electron.txt) |

Chromium과 그 하위 구성요소(ffmpeg, ICU, SwiftShader, Vulkan 로더 등)의 고지는 electron-builder가 설치 폴더 최상위에 자동으로 넣는 `LICENSES.chromium.html`에 있습니다.

### 2-2. npm 패키지

main 프로세스(`app.asar`)와 렌더러 번들에 들어가는 패키지입니다. `package-lock.json`의 production 의존성 전체(하위 의존성 포함)와, 렌더러 번들에 코드가 들어가는 빌드 도구(vite)입니다.

| 패키지 | 버전 | 라이선스 | 저작권자 | 원문 |
|---|---|---|---|---|
| argparse | 2.0.1 | Python-2.0 | Python Software Foundation 등(원문 참조) | [argparse.txt](LICENSES/npm/argparse.txt) |
| builder-util-runtime | 9.7.0 | MIT | Loopline Systems | [builder-util-runtime.txt](LICENSES/npm/builder-util-runtime.txt) |
| debug | 4.4.3 | MIT | TJ Holowaychuk; Josh Junon | [debug.txt](LICENSES/npm/debug.txt) |
| electron-updater | 6.8.11 | MIT | Loopline Systems | [electron-updater.txt](LICENSES/npm/electron-updater.txt) |
| fs-extra | 10.1.0 | MIT | JP Richardson | [fs-extra.txt](LICENSES/npm/fs-extra.txt) |
| graceful-fs | 4.2.11 | ISC | Isaac Z. Schlueter, Ben Noordhuis, and Contributors | [graceful-fs.txt](LICENSES/npm/graceful-fs.txt) |
| js-yaml | 4.3.2 | MIT | Vitaly Puzrin | [js-yaml.txt](LICENSES/npm/js-yaml.txt) |
| jsonfile | 6.2.1 | MIT | JP Richardson | [jsonfile.txt](LICENSES/npm/jsonfile.txt) |
| koffi | 3.3.7 | MIT | Niels Martignène | [koffi.txt](LICENSES/npm/koffi.txt) |
| @koromix/koffi-win32-x64 | 3.3.7 | MIT | Niels Martignène | koffi의 Windows 바이너리 패키지. 패키지에 라이선스 파일이 없어 [koffi.txt](LICENSES/npm/koffi.txt)를 따름(package.json 선언 MIT) |
| lazy-val | 1.0.5 | MIT | Vladimir Krivosheev | 패키지에 라이선스 파일 없음(package.json 선언 MIT) |
| lodash.escaperegexp | 4.1.2 | MIT | jQuery Foundation and other contributors | [lodash.escaperegexp.txt](LICENSES/npm/lodash.escaperegexp.txt) |
| lodash.isequal | 4.5.0 | MIT | JS Foundation and other contributors | [lodash.isequal.txt](LICENSES/npm/lodash.isequal.txt) |
| ms | 2.1.3 | MIT | Vercel, Inc. | [ms.txt](LICENSES/npm/ms.txt) |
| react | 19.3.1 | MIT | Meta Platforms, Inc. and affiliates | [react.txt](LICENSES/npm/react.txt) |
| react-dom | 19.3.1 | MIT | Meta Platforms, Inc. and affiliates | [react-dom.txt](LICENSES/npm/react-dom.txt) |
| sax | 1.6.1 | BlueOak-1.0.0 | Isaac Z. Schlueter(package.json) | [sax.txt](LICENSES/npm/sax.txt) |
| scheduler | 0.28.0 | MIT | Meta Platforms, Inc. and affiliates | [scheduler.txt](LICENSES/npm/scheduler.txt) |
| semver | 7.7.4 | ISC | Isaac Z. Schlueter and Contributors | [semver.txt](LICENSES/npm/semver.txt) |
| tiny-typed-emitter | 2.1.0 | MIT | Zurab Benashvili | [tiny-typed-emitter.txt](LICENSES/npm/tiny-typed-emitter.txt) |
| universalify | 2.0.1 | MIT | Ryan Zimmerman | [universalify.txt](LICENSES/npm/universalify.txt) |
| vite (빌드 도구) | 8.3.5 | MIT | VoidZero Inc. and Vite contributors | [vite.txt](LICENSES/npm/vite.txt) — 렌더러 번들에 들어가는 모듈 프리로드 폴리필. 원문은 Vite `LICENSE.md`의 'Vite core license' 부분(1~24행) |

### 2-3. 그 밖의 구성요소

| 구성요소 | 버전 | 라이선스 | 저작권자 | 설치본 위치 | 원문 |
|---|---|---|---|---|---|
| Mono.Cecil | 0.11.6 | MIT | Jb Evain; Novell, Inc. | `artifacts/compatibility`·`artifacts/auto_chest`·`sidecar-bin/_internal/bongo_chat/compatibility`(Mono.Cecil.dll, nupkg) | [Mono.Cecil.txt](LICENSES/Mono.Cecil.txt) |
| Pretendard | — | OFL-1.1 | Kil Hyung-jin(예약 글꼴 이름 Pretendard) | 렌더러 글꼴 woff2 3종 | [Pretendard-OFL-1.1.txt](LICENSES/Pretendard-OFL-1.1.txt) |
| NSIS | 3.0.4.1(electron-builder 배포본) | zlib/libpng 등(원문 참조) | NSIS Contributors 등 | 설치·제거 프로그램 | [NSIS-COPYING.txt](LICENSES/NSIS-COPYING.txt) |
| Elevate | 1.0.0.2894 | MIT | Johannes Passing(실행 파일 버전 정보, Copyright (C) 2007) | `resources/elevate.exe` | [elevate.txt](LICENSES/elevate.txt) — 원문의 저작권 줄은 템플릿(`<year> <copyright holders>`) 그대로 |

## 3. 사이드카 번들 (설치본 `resources/sidecar-bin`)

사이드카는 PyInstaller로 묶은 실행 파일(`cattalk-sidecar.exe`, onedir)로 설치본에 들어갑니다. 번들에 Python 런타임과 아래 패키지가 함께 들어가므로 설치 PC에 Python이 없어도 됩니다. 개발 실행은 시스템 Python 3.11에 `sidecar/requirements.txt`로 설치한 같은 패키지를 씁니다.
`requirements.txt`가 버전을 고정한 것은 UnityPy와 pillow뿐이라, 나머지 버전은 빌드 시점에 따라 달라질 수 있습니다(아래는 2026-11-10 빌드 기준).

### 3-1. Python 런타임과 번들 도구

| 구성요소 | 버전 | 라이선스 | 저작권자 | 원문 |
|---|---|---|---|---|
| Python(인터프리터·표준 라이브러리) | 3.11.5 | PSF-2.0 | Python Software Foundation | [Python-3.11.txt](LICENSES/Python-3.11.txt) — Windows 배포본 `LICENSE.txt` |
| OpenSSL(libcrypto-3·libssl-3) | 3.0.9 | Apache-2.0 | The OpenSSL Project Authors | Python-3.11.txt 안의 Apache License 2.0 |
| libffi(libffi-8) | — | MIT | Anthony Green, Red Hat, Inc and others | Python-3.11.txt |
| bzip2(_bz2) | 1.0.8 | bzip2 라이선스 | Julian R Seward | Python-3.11.txt |
| SQLite(sqlite3.dll) | 3.42.0 | 퍼블릭 도메인 | — | — |
| Microsoft Visual C++ 런타임·UCRT(VCRUNTIME140·MSVCP140·ucrtbase·api-ms-win-*) | 14.36·14.50·10.0.22621 | Microsoft 재배포 조건 | Microsoft Corporation | Python-3.11.txt의 'Additional Conditions for this Windows binary build' |
| PyInstaller(부트로더·런타임 모듈) | 6.22.3 | GPL-2.0-or-later WITH Bootloader-exception | PyInstaller Development Team 등 | [PyInstaller.txt](LICENSES/PyInstaller.txt) — 부트로더 예외에 따라 번들 앱은 GPL 제한 없이 배포할 수 있다 |

그 밖에 Python 확장 모듈에 정적으로 들어간 zlib(1.2.13)·expat(2.5.0)·libmpdec(2.5.1)·liblzma 등은 CPython 라이선스 문서(<https://docs.python.org/3.11/license.html>)를 따릅니다.

### 3-2. Python 패키지

| 패키지 | 버전 | 라이선스 | 저작권자 | 원문 |
|---|---|---|---|---|
| psutil | 7.2.2 | BSD-3-Clause | Jay Loden, Dave Daeschler, Giampaolo Rodola | [psutil.txt](LICENSES/pip/psutil.txt) |
| UnityPy | 1.25.4 | MIT | K0lb3 | [UnityPy.txt](LICENSES/pip/UnityPy.txt) |
| pillow | 12.3.0 | MIT-CMU | Secret Labs AB; Fredrik Lundh and contributors; Jeffrey 'Alex' Clark and contributors | [pillow.txt](LICENSES/pip/pillow.txt) — 함께 묶인 라이브러리 고지 포함(brotli, freetype, harfbuzz, lcms2, libavif, libjpeg-turbo, libpng, libwebp, openjpeg, tiff, xz, zlib-ng) |
| lz4 | 4.4.5 | BSD-3-Clause | Steeve Morin | [lz4.txt](LICENSES/pip/lz4.txt) |
| brotli | 1.2.1 | MIT | the Brotli Authors | [brotli.txt](LICENSES/pip/brotli.txt) |
| texture2ddecoder | 1.0.6 | MIT | K0lb3 | [texture2ddecoder.txt](LICENSES/pip/texture2ddecoder.txt) |
| etcpak | 0.9.15 | MIT | K0lb3 | [etcpak.txt](LICENSES/pip/etcpak.txt) |
| archspec | 0.2.7 | Apache-2.0 OR MIT | Lawrence Livermore National Security, LLC and other Archspec Project Developers | [Apache](LICENSES/pip/archspec-LICENSE-APACHE.txt) · [MIT](LICENSES/pip/archspec-LICENSE-MIT.txt) · [NOTICE](LICENSES/pip/archspec-NOTICE.txt) |
| astc-encoder-py | 0.1.12 | MIT | Rudolf Kolbe | [astc-encoder-py.txt](LICENSES/pip/astc-encoder-py.txt) |
| fsspec | 2026.9.0 | BSD-3-Clause | Martin Durant | [fsspec.txt](LICENSES/pip/fsspec.txt) |
| attrs | 26.1.0 | MIT | Hynek Schlawack and the attrs contributors | [attrs.txt](LICENSES/pip/attrs.txt) |
| tpk_ar | 0.2.4 | MIT | K0lb3 | [tpk_ar.txt](LICENSES/pip/tpk_ar.txt) |

**번들에서 제외한 UnityPy 의존성**: 개발 실행 환경에는 함께 설치되지만 설치본에는 들어가지 않습니다.

| 패키지 | 버전 | 라이선스 | 저작권자 | 원문 |
|---|---|---|---|---|
| fmod_toolkit | 0.1.3 | MIT(파이썬 래퍼만 — 아래 FMOD 참고) | K0lb3 | [fmod_toolkit.txt](LICENSES/pip/fmod_toolkit.txt) |
| pyfmodex | 0.7.2 | MIT | Lukáš Tyrychtr | [pyfmodex.txt](LICENSES/pip/pyfmodex.txt) |

> **FMOD:** `fmod_toolkit` 0.1.3 wheel에는 FMOD Engine 바이너리(`fmod_toolkit/libfmod/Windows/x64/fmod.dll`, Firelight Technologies)가 들어 있습니다. 이 DLL에는 래퍼의 MIT가 아니라 FMOD 이용 조건(<https://www.fmod.com/legal>)이 적용됩니다.
> UnityPy 1.25.4는 Sprite만 읽어도 `export/__init__` → `AudioClipConverter` → `fmod_toolkit`을 불러옵니다. 그래서 **개발 실행(pip 설치 환경)에서는 아바타를 읽을 때 `fmod.dll`이 로드됩니다**(오디오 기능은 호출하지 않음).
> 설치본의 사이드카 번들은 런타임 훅(`scripts/sidecar/rthook_disable_unity_audio.py`, upstream 사본)으로 `AudioClipConverter`를 빈 모듈로 바꾸고 `fmod_toolkit`·`pyfmodex`를 넣지 않습니다. 번들에는 FMOD 파일이 없으며, 번들 자가 점검(`--selftest`)으로 아바타를 합성한 뒤에도 FMOD가 로드되지 않는 것을 확인했습니다.
