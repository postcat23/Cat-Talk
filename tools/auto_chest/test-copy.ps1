# 상자 자동 오픈 패처 1단계 검증(D-019): 게임 DLL '사본'에서만 돈다. 실게임 폴더에는 쓰지 않는다.
# 사용: powershell -File tools/auto_chest/test-copy.ps1 -Copy <Assembly-CSharp.dll 사본> -Work <빈 작업 폴더>
# 선행: tools/auto_chest/build.ps1. 결과는 PASS/FAIL 줄로 출력하고 FAIL이 있으면 종료 코드 1.
param([Parameter(Mandatory)][string]$Copy, [Parameter(Mandatory)][string]$Work)
$ErrorActionPreference = 'Continue'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$exe = Join-Path $projectRoot 'artifacts/auto_chest/AutoChestPatcher.exe'
if (!(Test-Path -LiteralPath $exe)) { throw 'Patcher missing: run tools/auto_chest/build.ps1 first' }
if ((Resolve-Path -LiteralPath $Copy).Path -match '\\BongoCat_Data\\Managed\\') { throw 'Use a copy outside the game folder' }
if (Test-Path -LiteralPath $Work) { Remove-Item -Recurse -Force -LiteralPath $Work }
foreach ($d in 'orig','patched','bak','target','bad1','bad2','misc') { New-Item -ItemType Directory -Force (Join-Path $Work $d) | Out-Null }
$orig = Join-Path $Work 'orig/Assembly-CSharp.dll'; Copy-Item -LiteralPath $Copy -Destination $orig
$patched = Join-Path $Work 'patched/Assembly-CSharp.dll'; $target = Join-Path $Work 'target/Assembly-CSharp.dll'
$flag = 'C:\CatTalkTest\CatTalkAutoChest.on'   # 리터럴로만 들어간다. 파일은 만들지 않는다.
$failed = 0
function Sha($p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
function Check($name, $ok, $detail) { if (!$ok) { $script:failed++ }; '{0,-4} {1,-46} {2}' -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $name, $detail }
function Run($name, $expect, [string[]]$argv) { $out = & $exe @argv 2>$null; $code = $LASTEXITCODE; Check $name ($code -eq $expect) "exit=$code (expect $expect) $out" }
$origSha = Sha $orig

Run '1 inspect original -> clean' 0 @('inspect', $orig)
Run '2 backup original (clean)' 0 @('backup', $orig, (Join-Path $Work 'bak'))
Run '3 patch -> separate output' 0 @('patch', $orig, $patched, $flag)
Run '4 inspect patched -> patched' 0 @('inspect', $patched)
Run '5 verify (all methods kept, 1 insert)' 0 @('verify', $orig, $patched, $flag)
Run '6 re-patch -> skipped' 3 @('patch', $patched, (Join-Path $Work 'misc/repatch.dll'), $flag)
Check '6b re-patch wrote nothing' (!(Test-Path (Join-Path $Work 'misc/repatch.dll'))) ''
Copy-Item -LiteralPath $patched -Destination $target
Run '7 restore backup -> target' 0 @('restore', (Join-Path $Work 'bak'), $target)
Check '7b restored == original bytes' ((Sha $target) -eq $origSha) ''
Run '8a backup of patched -> refuse' 2 @('backup', $patched, (Join-Path $Work 'misc/bak'))
Copy-Item (Join-Path $Work 'bak/*') (Join-Path $Work 'bad1')
$bytes = [IO.File]::ReadAllBytes((Join-Path $Work 'bad1/Assembly-CSharp.dll.orig')); $bytes[1000] = $bytes[1000] -bxor 0xFF
[IO.File]::WriteAllBytes((Join-Path $Work 'bad1/Assembly-CSharp.dll.orig'), $bytes)
Copy-Item -LiteralPath $patched -Destination $target -Force
Run '8b restore corrupted backup -> refuse' 2 @('restore', (Join-Path $Work 'bad1'), $target)
Copy-Item -LiteralPath $patched -Destination (Join-Path $Work 'bad2/Assembly-CSharp.dll.orig')
Set-Content -Encoding ascii (Join-Path $Work 'bad2/Assembly-CSharp.dll.orig.sha256') (Sha (Join-Path $Work 'bad2/Assembly-CSharp.dll.orig'))
Run '8c restore patched-as-backup -> refuse' 2 @('restore', (Join-Path $Work 'bad2'), $target)
Check '8d target unchanged after refusals' ((Sha $target) -eq (Sha $patched)) ''
Copy-Item -LiteralPath (Join-Path $projectRoot 'artifacts/auto_chest/Mono.Cecil.dll') -Destination (Join-Path $Work 'misc/Other.dll')
Run '8e unrelated assembly -> incompatible' 2 @('inspect', (Join-Path $Work 'misc/Other.dll'))
$all = [IO.File]::ReadAllBytes($orig); [IO.File]::WriteAllBytes((Join-Path $Work 'misc/Truncated.dll'), $all[0..([int]($all.Length / 2))])
Run '8f truncated assembly -> error' 1 @('inspect', (Join-Path $Work 'misc/Truncated.dll'))
Run '8g relative flag path -> error' 1 @('patch', $orig, (Join-Path $Work 'misc/x.dll'), 'CatTalkAutoChest.on')
Run '8h in-place patch -> error' 1 @('patch', $orig, $orig, $flag)
Check '9 original copy untouched' ((Sha $orig) -eq $origSha) ''
if ($failed) { exit 1 }
