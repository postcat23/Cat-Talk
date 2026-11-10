# 사이드카 PyInstaller 번들(onedir) 빌드(D-036). 산출물: artifacts/sidecar/cattalk-sidecar/ (artifacts/는 gitignore)
# 전제: Python 3.11(py 런처), tools/prepare-compatibility.ps1로 artifacts/compatibility 빌드 완료.
# 빌드 전용 venv(artifacts/sidecar-build/venv)를 써서 dev가 쓰는 시스템 Python은 건드리지 않는다.
param([switch]$Clean)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$compat = Join-Path $projectRoot 'artifacts/compatibility'
foreach ($name in 'FeatureProbe.exe', 'MemoryScan.exe', 'Mono.Cecil.dll') {
    if (!(Test-Path -LiteralPath (Join-Path $compat $name))) { throw "$name missing: run tools/prepare-compatibility.ps1 first" }
}
$buildRoot = Join-Path $projectRoot 'artifacts/sidecar-build'
$venv = Join-Path $buildRoot 'venv'
if ($Clean -and (Test-Path -LiteralPath $buildRoot)) { Remove-Item -LiteralPath $buildRoot -Recurse -Force }
$python = Join-Path $venv 'Scripts/python.exe'
if (!(Test-Path -LiteralPath $python)) {
    & py -3.11 -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw 'venv creation failed (Python 3.11 via py launcher required)' }
}
& $python -m pip install --disable-pip-version-check -q -r (Join-Path $projectRoot 'sidecar/requirements.txt') -r (Join-Path $PSScriptRoot 'sidecar/requirements-build.txt')
if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }
$dist = Join-Path $projectRoot 'artifacts/sidecar'
& $python -m PyInstaller --noconfirm --clean --log-level WARN --distpath $dist --workpath (Join-Path $buildRoot 'work') (Join-Path $PSScriptRoot 'sidecar/cattalk-sidecar.spec')
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller build failed' }
# 제외 대상이 번들에 들어가면 실패: Qt·PySide6, FMOD(래퍼·엔진 DLL)
$output = Join-Path $dist 'cattalk-sidecar'
$leaks = Get-ChildItem -LiteralPath $output -Recurse | Where-Object { $_.Name -match '^(PySide6|shiboken6|Qt6.*|fmod_toolkit|pyfmodex|fmod.*\.dll)$' }
if ($leaks) { throw ('Excluded components leaked into the bundle: ' + (($leaks | ForEach-Object { $_.FullName }) -join ', ')) }
Write-Output "Sidecar bundle built: $output"
