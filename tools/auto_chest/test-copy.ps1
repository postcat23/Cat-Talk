# 패처 1단계 검증(D-019 상자 자동 오픈, D-028 투명화): 게임 DLL '사본'에서만 돈다. 실게임 폴더에는 쓰지 않는다.
# 사용: powershell -File tools/auto_chest/test-copy.ps1 -Copy <Assembly-CSharp.dll 사본> -Managed <게임 Managed 폴더 사본> -Work <빈 작업 폴더>
# -Managed: 참조 해석 검증용 게임 런타임 어셈블리 사본(UnityEngine.*·mscorlib 등). 게임 폴더를 직접 가리키지 않는다.
# 선행: tools/auto_chest/build.ps1. 결과는 PASS/FAIL 줄로 출력하고 FAIL이 있으면 종료 코드 1.
# 패치 세트 v1(자동 오픈만)은 $LegacyCommit의 패처를 작업 폴더에 빌드해 만든다.
param([Parameter(Mandatory)][string]$Copy, [Parameter(Mandatory)][string]$Managed, [Parameter(Mandatory)][string]$Work, [string]$LegacyCommit = '3b89d14')
$ErrorActionPreference = 'Continue'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$exe = Join-Path $projectRoot 'artifacts/auto_chest/AutoChestPatcher.exe'
if (!(Test-Path -LiteralPath $exe)) { throw 'Patcher missing: run tools/auto_chest/build.ps1 first' }
if ((Resolve-Path -LiteralPath $Copy).Path -match '\\BongoCat_Data\\Managed\\') { throw 'Use a copy outside the game folder' }
if ((Resolve-Path -LiteralPath $Managed).Path -match '\\BongoCat_Data\\Managed') { throw 'Use a copy of Managed outside the game folder' }
if (Test-Path -LiteralPath $Work) { Remove-Item -Recurse -Force -LiteralPath $Work }
foreach ($d in 'orig','patched','bak','target','bad1','bad2','misc','legacy','v1','v2','mut','stripped') { New-Item -ItemType Directory -Force (Join-Path $Work $d) | Out-Null }
$orig = Join-Path $Work 'orig/Assembly-CSharp.dll'; Copy-Item -LiteralPath $Copy -Destination $orig
$patched = Join-Path $Work 'patched/Assembly-CSharp.dll'; $target = Join-Path $Work 'target/Assembly-CSharp.dll'
$flag = 'C:\CatTalkTest\CatTalkAutoChest.on'   # 리터럴로만 들어간다. 파일은 만들지 않는다.
$mg = (Resolve-Path -LiteralPath $Managed).Path
$failed = 0
function Sha($p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
function Check($name, $ok, $detail) { if (!$ok) { $script:failed++ }; '{0,-4} {1,-46} {2}' -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $name, $detail }
function Run($name, $expect, [string[]]$argv) { $out = & $exe @argv 2>$null; $code = $LASTEXITCODE; Check $name ($code -eq $expect) "exit=$code (expect $expect) $out"; $script:last = $out }
function Inspect($p) { & $exe inspect $p 2>$null | ConvertFrom-Json }
$origSha = Sha $orig

Run '1 inspect original -> clean' 0 @('inspect', $orig)
Run '2 backup original (clean)' 0 @('backup', $orig, (Join-Path $Work 'bak'))
Run '3 patch -> separate output' 0 @('patch', $orig, $patched, $flag, $mg)
Run '4 inspect patched -> patched' 0 @('inspect', $patched)
Run '5 verify (all methods kept, both hooks)' 0 @('verify', $orig, $patched, $flag, $mg)
Run '6 re-patch -> skipped' 3 @('patch', $patched, (Join-Path $Work 'misc/repatch.dll'), $flag, $mg)
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
Run '8g relative flag path -> error' 1 @('patch', $orig, (Join-Path $Work 'misc/x.dll'), 'CatTalkAutoChest.on', $mg)
Run '8h in-place patch -> error' 1 @('patch', $orig, $orig, $flag, $mg)

# ---- 패치 세트 버전과 투명화 훅(D-028) ----
$cecil = Join-Path $projectRoot 'artifacts/auto_chest/Mono.Cecil.dll'
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$legacySrc = Join-Path $Work 'legacy/AutoChestPatcher.cs'; $legacy = Join-Path $Work 'legacy/Legacy.exe'
cmd /c "git -C `"$projectRoot`" show ${LegacyCommit}:tools/auto_chest/AutoChestPatcher.cs > `"$legacySrc`""
& $compiler /nologo /optimize+ /target:exe /out:"$legacy" /reference:"$cecil" /reference:System.Web.Extensions.dll $legacySrc | Out-Null
Copy-Item -LiteralPath $cecil -Destination (Join-Path $Work 'legacy')
$mutate = Join-Path $Work 'mut/TestMutate.exe'
& $compiler /nologo /target:exe /out:"$mutate" /reference:"$cecil" (Join-Path $PSScriptRoot 'TestMutate.cs') | Out-Null
Copy-Item -LiteralPath $cecil -Destination (Join-Path $Work 'mut')

$i0 = Inspect $orig; $i2 = Inspect $patched
Check '10a original version 0' ($i0.patchVersion -eq 0 -and $i0.upToDate -eq $false) ''
Check '10b patched version 2, up to date' ($i2.patchVersion -eq 2 -and $i2.upToDate -eq $true) ''
Check '10c two independent flags, same folder' ($i2.flag -eq $flag -and $i2.transparentFlag -eq 'C:\CatTalkTest\CatTalkTransparent.on') $i2.transparentFlag

$v1 = Join-Path $Work 'v1/Assembly-CSharp.dll'; $v2 = Join-Path $Work 'v2/Assembly-CSharp.dll'
& $legacy patch $orig $v1 $flag | Out-Null   # 이전 패처는 Managed 인자가 없는 3인자 CLI
Check '11a legacy patcher made v1' ($LASTEXITCODE -eq 0) ''
$iv1 = Inspect $v1
Check '11b v1 reads patched, version 1, outdated' ($iv1.state -eq 'patched' -and $iv1.patchVersion -eq 1 -and $iv1.upToDate -eq $false) "$($iv1.flag)"
Run '11c verify v1 -> refuse' 2 @('verify', $orig, $v1, $flag, $mg)
Run '11d upgrade with other flag -> refuse' 2 @('patch', $v1, (Join-Path $Work 'misc/up.dll'), 'C:\Moved\CatTalkAutoChest.on', $mg)
Check '11e refused upgrade wrote nothing' (!(Test-Path (Join-Path $Work 'misc/up.dll'))) ''
Run '11f upgrade v1 -> v2' 0 @('patch', $v1, $v2, $flag, $mg)
Run '11g verify upgraded v2 against original' 0 @('verify', $orig, $v2, $flag, $mg)
Run '11h re-patch upgraded -> skipped' 3 @('patch', $v2, (Join-Path $Work 'misc/re2.dll'), $flag, $mg)
Check '11i upgraded is version 2' ((Inspect $v2).patchVersion -eq 2) ''
Check '11m upgraded == direct patch bytes' ((Sha $v2) -eq (Sha $patched)) ''
Copy-Item -LiteralPath $v2 -Destination $target -Force
Run '11j restore over upgraded' 0 @('restore', (Join-Path $Work 'bak'), $target)
Check '11k restored == original bytes' ((Sha $target) -eq $origSha) ''
Run '11l backup of v1 -> refuse' 2 @('backup', $v1, (Join-Path $Work 'misc/bak1'))

foreach ($m in 'no-hover-type','no-smooth','no-layer','no-update','no-alpha','extra-anchor') {
  $bad = Join-Path $Work "mut/$m.dll"; & $mutate $orig $bad $m
  Run "12 clean, $m -> inspect refuse" 2 @('inspect', $bad)
  Run "12 clean, $m -> patch refuse" 2 @('patch', $bad, (Join-Path $Work "misc/$m.dll"), $flag, $mg)
  Check "12 clean, $m wrote nothing" (!(Test-Path (Join-Path $Work "misc/$m.dll"))) ''
}
foreach ($m in 'partial-smooth','partial-layer','partial-start','partial-update','partial-field') {
  $bad = Join-Path $Work "mut/$m.dll"; & $mutate $patched $bad $m
  Run "13 $m -> inspect refuse" 2 @('inspect', $bad)
  Run "13 $m -> verify refuse" 2 @('verify', $orig, $bad, $flag, $mg)
  Run "13 $m -> patch refuse" 2 @('patch', $bad, (Join-Path $Work "misc/$m.dll"), $flag, $mg)
  Run "13 $m -> backup refuse" 2 @('backup', $bad, (Join-Path $Work "misc/bak-$m"))
}
foreach ($m in 'wrong-alpha','wrong-layer','wrong-poll','edit-outside-block','edit-other-method') {
  $bad = Join-Path $Work "mut/$m.dll"; & $mutate $patched $bad $m
  Run "14 $m -> inspect still reads v2" 0 @('inspect', $bad)
  Run "14 $m -> verify refuse" 2 @('verify', $orig, $bad, $flag, $mg)
}

# ---- 런타임 참조 해석(D-028 2a 실패 재발 방지): 스트리핑으로 빠진 API를 부르는 결과물은 거부 ----
$stripped = Join-Path $Work 'stripped'
Copy-Item (Join-Path $mg '*.dll') $stripped
& $mutate (Join-Path $mg 'UnityEngine.UIModule.dll') (Join-Path $stripped 'UnityEngine.UIModule.dll') 'strip-set-alpha'
Run '15a patch, runtime lacks CanvasGroup.set_alpha -> refuse' 2 @('patch', $orig, (Join-Path $Work 'misc/stripped.dll'), $flag, $stripped)
Check '15b refusal reason = unresolved_reference' ($last -match 'unresolved_reference') $last
Check '15c refused patch left no output' (!(Test-Path (Join-Path $Work 'misc/stripped.dll'))) ''
Run '15d verify against stripped runtime -> refuse' 2 @('verify', $orig, $patched, $flag, $stripped)
$bad = Join-Path $Work 'mut/call-stripped.dll'; & $mutate $patched $bad 'call-stripped'
Run '15e verify, calls set_blocksRaycasts -> refuse' 2 @('verify', $orig, $bad, $flag, $mg)
Check '15f refusal reason = unresolved_reference' ($last -match 'unresolved_reference') $last
Run '15g patch without runtime folder -> error' 1 @('patch', $orig, (Join-Path $Work 'misc/nomg.dll'), $flag, (Join-Path $Work 'misc'))
Check '15h no output without runtime folder' (!(Test-Path (Join-Path $Work 'misc/nomg.dll'))) ''
Check '9 original copy untouched' ((Sha $orig) -eq $origSha) ''
if ($failed) { exit 1 }
