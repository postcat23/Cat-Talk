# 상자 자동 오픈 패처 빌드(D-019). tools/prepare-compatibility.ps1이 받아 해시 검증한 Mono.Cecil을 재사용한다.
# 산출물: artifacts/auto_chest/AutoChestPatcher.exe (+ Mono.Cecil.dll, 라이선스). artifacts/는 gitignore.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$cecil = Join-Path $projectRoot 'artifacts/compatibility/Mono.Cecil.dll'
$cecilHash = 'c41bdb9ffd3c5f6e17d2382c1012d73703e035e3f1100245fdd4e08c8dc6eb5b'   # prepare-compatibility.ps1과 같은 값
if (!(Test-Path -LiteralPath $cecil)) { throw 'Mono.Cecil missing: run tools/prepare-compatibility.ps1 first' }
if ((Get-FileHash -LiteralPath $cecil -Algorithm SHA256).Hash.ToLowerInvariant() -ne $cecilHash) { throw 'Unexpected Mono.Cecil library' }
$output = Join-Path $projectRoot 'artifacts/auto_chest'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler /nologo /optimize+ /target:exe /out:"$output/AutoChestPatcher.exe" /reference:"$cecil" /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'AutoChestPatcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Auto chest patcher build failed' }
Copy-Item -LiteralPath $cecil -Destination $output -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'tools/compatibility/Mono.Cecil.LICENSE.txt') -Destination $output -Force
Write-Output 'Auto chest patcher built.'
