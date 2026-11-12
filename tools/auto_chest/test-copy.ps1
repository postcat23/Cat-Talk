# 패처 검증(D-019 상자 자동 오픈, D-028 투명화, D-033 3단계 차단 멤버 고양이 숨김, D-046 투명화 중 획득 팝업 숨김, D-047 투명화 루트 후크): 게임 DLL '사본'에서만 돈다. 실게임 폴더에는 쓰지 않는다.
# 사용: powershell -File tools/auto_chest/test-copy.ps1 -Copy <Assembly-CSharp.dll 사본> -Managed <게임 Managed 폴더 사본> -Work <빈 작업 폴더>
# -Managed: 참조 해석 검증용 게임 런타임 어셈블리 사본(UnityEngine.*·mscorlib 등). 게임 폴더를 직접 가리키지 않는다.
# 선행: tools/auto_chest/build.ps1, tools/prepare-compatibility.ps1(Cat Talk 연결 호환성 지문 도구 FeatureProbe — 패치 결과가 원본과 같은 지문인지 본다).
# 결과는 PASS/FAIL 줄로 출력하고 FAIL이 있으면 종료 코드 1.
# 이전 패치 세트는 그 시점 패처를 작업 폴더에 빌드해 만든다: v1(자동 오픈만) = $LegacyCommit, v2(+ 투명화) = $V2Commit,
# v3(+ 차단 멤버 고양이 숨김) = $V3Commit.
param([Parameter(Mandatory)][string]$Copy, [Parameter(Mandatory)][string]$Managed, [Parameter(Mandatory)][string]$Work,
  [string]$LegacyCommit = '3b89d14', [string]$V2Commit = '73f8de5', [string]$V3Commit = '69e21e9')
$ErrorActionPreference = 'Continue'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$exe = Join-Path $projectRoot 'artifacts/auto_chest/AutoChestPatcher.exe'
if (!(Test-Path -LiteralPath $exe)) { throw 'Patcher missing: run tools/auto_chest/build.ps1 first' }
if ((Resolve-Path -LiteralPath $Copy).Path -match '\\BongoCat_Data\\Managed\\') { throw 'Use a copy outside the game folder' }
if ((Resolve-Path -LiteralPath $Managed).Path -match '\\BongoCat_Data\\Managed') { throw 'Use a copy of Managed outside the game folder' }
if (Test-Path -LiteralPath $Work) { Remove-Item -Recurse -Force -LiteralPath $Work }
foreach ($d in 'orig','patched','bak','target','bad1','bad2','misc','legacy','legacy2','legacy3','v1','v2','v2old','v3up','v3old','v4up','mut','stripped','stripped2') { New-Item -ItemType Directory -Force (Join-Path $Work $d) | Out-Null }
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
Run '5 verify (all methods kept, five hook sets)' 0 @('verify', $orig, $patched, $flag, $mg)
$v5 = $last | ConvertFrom-Json
Check '5b verify reports hidden sequence ok' ($v5.hiddenSequenceOk -eq $true) ''
Check '5c verify reports item popup gate ok' ($v5.itemPopupSequenceOk -eq $true) ''
Check '5d verify reports root hook ok' ($v5.rootSequenceOk -eq $true) ''
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

# ---- 패치 세트 버전과 이전 세트에서 올리기(D-028, D-033 3단계) ----
$cecil = Join-Path $projectRoot 'artifacts/auto_chest/Mono.Cecil.dll'
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
function BuildAt($commit, $dir, $name) {
  $src = Join-Path $Work "$dir/AutoChestPatcher.cs"; $out = Join-Path $Work "$dir/$name"
  cmd /c "git -C `"$projectRoot`" show ${commit}:tools/auto_chest/AutoChestPatcher.cs > `"$src`""
  & $compiler /nologo /optimize+ /target:exe /out:"$out" /reference:"$cecil" /reference:System.Web.Extensions.dll $src | Out-Null
  Copy-Item -LiteralPath $cecil -Destination (Join-Path $Work $dir)
  $out
}
$legacy = BuildAt $LegacyCommit 'legacy' 'Legacy.exe'
$legacy2 = BuildAt $V2Commit 'legacy2' 'LegacyV2.exe'
$legacy3 = BuildAt $V3Commit 'legacy3' 'LegacyV3.exe'
$mutate = Join-Path $Work 'mut/TestMutate.exe'
& $compiler /nologo /target:exe /out:"$mutate" /reference:"$cecil" (Join-Path $PSScriptRoot 'TestMutate.cs') | Out-Null
Copy-Item -LiteralPath $cecil -Destination (Join-Path $Work 'mut')

$i0 = Inspect $orig; $i4 = Inspect $patched
Check '10a original version 0' ($i0.patchVersion -eq 0 -and $i0.upToDate -eq $false) ''
Check '10b patched version 5, up to date' ($i4.patchVersion -eq 5 -and $i4.upToDate -eq $true) ''
Check '10c flags and hidden list, same folder' ($i4.flag -eq $flag -and $i4.transparentFlag -eq 'C:\CatTalkTest\CatTalkTransparent.on' -and $i4.hiddenFile -eq 'C:\CatTalkTest\CatTalkHidden.ids') "$($i4.transparentFlag) $($i4.hiddenFile)"
Check '10d original has no hidden list' ($null -eq $i0.hiddenFile) ''

$v1 = Join-Path $Work 'v1/Assembly-CSharp.dll'; $v4a = Join-Path $Work 'v2/Assembly-CSharp.dll'
& $legacy patch $orig $v1 $flag | Out-Null   # 이전 패처는 Managed 인자가 없는 3인자 CLI
Check '11a legacy patcher made v1' ($LASTEXITCODE -eq 0) ''
$iv1 = Inspect $v1
Check '11b v1 reads patched, version 1, outdated' ($iv1.state -eq 'patched' -and $iv1.patchVersion -eq 1 -and $iv1.upToDate -eq $false) "$($iv1.flag)"
Run '11c verify v1 -> refuse' 2 @('verify', $orig, $v1, $flag, $mg)
Run '11d upgrade with other flag -> refuse' 2 @('patch', $v1, (Join-Path $Work 'misc/up.dll'), 'C:\Moved\CatTalkAutoChest.on', $mg)
Check '11e refused upgrade wrote nothing' (!(Test-Path (Join-Path $Work 'misc/up.dll'))) ''
Run '11f upgrade v1 -> v5' 0 @('patch', $v1, $v4a, $flag, $mg)
Run '11g verify upgraded v5 against original' 0 @('verify', $orig, $v4a, $flag, $mg)
Run '11h re-patch upgraded -> skipped' 3 @('patch', $v4a, (Join-Path $Work 'misc/re2.dll'), $flag, $mg)
Check '11i upgraded is version 5' ((Inspect $v4a).patchVersion -eq 5) ''
Check '11m upgraded == direct patch bytes' ((Sha $v4a) -eq (Sha $patched)) ''
Copy-Item -LiteralPath $v4a -Destination $target -Force
Run '11j restore over upgraded' 0 @('restore', (Join-Path $Work 'bak'), $target)
Check '11k restored == original bytes' ((Sha $target) -eq $origSha) ''
Run '11l backup of v1 -> refuse' 2 @('backup', $v1, (Join-Path $Work 'misc/bak1'))

# v2(상자 + 투명화) 설치본 → v5: 기존 설치가 '재적용 필요'로 보이고, 올린 결과가 원본에서 바로 만든 v5와 같아야 한다
$v2old = Join-Path $Work 'v2old/Assembly-CSharp.dll'; $v4b = Join-Path $Work 'v3up/Assembly-CSharp.dll'
& $legacy2 patch $orig $v2old $flag $mg | Out-Null
Check '17a v2 patcher made v2' ($LASTEXITCODE -eq 0) ''
$iv2 = Inspect $v2old
Check '17b v2 reads patched, version 2, outdated' ($iv2.state -eq 'patched' -and $iv2.patchVersion -eq 2 -and $iv2.upToDate -eq $false -and $null -eq $iv2.hiddenFile) "$($iv2.patchVersion)"
Run '17c verify v2 -> refuse' 2 @('verify', $orig, $v2old, $flag, $mg)
Run '17d upgrade v2 with other flag -> refuse' 2 @('patch', $v2old, (Join-Path $Work 'misc/up2.dll'), 'C:\Moved\CatTalkAutoChest.on', $mg)
Check '17e refused upgrade wrote nothing' (!(Test-Path (Join-Path $Work 'misc/up2.dll'))) ''
Run '17f upgrade v2 -> v5' 0 @('patch', $v2old, $v4b, $flag, $mg)
Check '17g upgrade reported' (($last | ConvertFrom-Json).upgraded -eq $true) ''
Run '17h verify upgraded v5 against original' 0 @('verify', $orig, $v4b, $flag, $mg)
Check '17i upgraded == direct patch bytes' ((Sha $v4b) -eq (Sha $patched)) ''
Copy-Item -LiteralPath $v4b -Destination $target -Force
Run '17j restore over upgraded' 0 @('restore', (Join-Path $Work 'bak'), $target)
Check '17k restored == original bytes' ((Sha $target) -eq $origSha) ''
Run '17l backup of v2 -> refuse' 2 @('backup', $v2old, (Join-Path $Work 'misc/bak2'))

# v3(상자 + 투명화 + 차단 멤버 숨김) 설치본 → v5(D-046·D-047): 1.0.0 사용자가 지나는 길. 획득 팝업 게이트(2)와 루트 후크(Start 12 + Smooth 17
# + 메뉴 닫기 메서드 26)만 더하고, 결과가 원본에서 바로 만든 v5와 같아야 한다
$v3old = Join-Path $Work 'v3old/Assembly-CSharp.dll'; $v4c = Join-Path $Work 'v4up/Assembly-CSharp.dll'
& $legacy3 patch $orig $v3old $flag $mg | Out-Null
Check '19a v3 patcher made v3' ($LASTEXITCODE -eq 0) ''
$iv3 = Inspect $v3old
Check '19b v3 reads patched, version 3, outdated' ($iv3.state -eq 'patched' -and $iv3.patchVersion -eq 3 -and $iv3.upToDate -eq $false -and $iv3.hiddenFile -eq 'C:\CatTalkTest\CatTalkHidden.ids') "$($iv3.patchVersion)"
Run '19c verify v3 -> refuse' 2 @('verify', $orig, $v3old, $flag, $mg)
Run '19d upgrade v3 with other flag -> refuse' 2 @('patch', $v3old, (Join-Path $Work 'misc/up3.dll'), 'C:\Moved\CatTalkAutoChest.on', $mg)
Check '19e refused upgrade wrote nothing' (!(Test-Path (Join-Path $Work 'misc/up3.dll'))) ''
Run '19f upgrade v3 -> v5' 0 @('patch', $v3old, $v4c, $flag, $mg)
$up3 = $last | ConvertFrom-Json
Check '19g upgrade reported, only popup gate + root hook added' ($up3.upgraded -eq $true -and $up3.inserted -eq 57) "$last"
Run '19h verify upgraded v5 against original' 0 @('verify', $orig, $v4c, $flag, $mg)
Check '19i upgraded == direct patch bytes' ((Sha $v4c) -eq (Sha $patched)) ''
Copy-Item -LiteralPath $v4c -Destination $target -Force
Run '19j restore over upgraded' 0 @('restore', (Join-Path $Work 'bak'), $target)
Check '19k restored == original bytes' ((Sha $target) -eq $origSha) ''
Run '19l backup of v3 -> refuse' 2 @('backup', $v3old, (Join-Path $Work 'misc/bak3'))

foreach ($m in 'no-hover-type','no-smooth','no-layer','no-update','no-overui','no-donut','no-speech','no-alpha','extra-anchor',
    'no-member-type','no-setter','no-member-start','no-toggle','no-spawn-update','no-autohide','getter-shape','no-popup','popup-shape','root-smooth-targets','no-toggle-setactive') {
  $bad = Join-Path $Work "mut/$m.dll"; & $mutate $orig $bad $m
  Run "12 clean, $m -> inspect refuse" 2 @('inspect', $bad)
  Run "12 clean, $m -> patch refuse" 2 @('patch', $bad, (Join-Path $Work "misc/$m.dll"), $flag, $mg)
  Check "12 clean, $m wrote nothing" (!(Test-Path (Join-Path $Work "misc/$m.dll"))) ''
}
foreach ($m in 'partial-smooth','partial-layer','partial-start','partial-update','partial-overui','partial-filter','partial-donut','partial-speech','partial-field',
    'partial-hidden-start','partial-hidden-toggle','partial-hidden-update','partial-hidden-field','partial-hidden-method','setter-hook','partial-popup','partial-root-field','partial-root-close') {
  $bad = Join-Path $Work "mut/$m.dll"; & $mutate $patched $bad $m
  Run "13 $m -> inspect refuse" 2 @('inspect', $bad)
  Run "13 $m -> verify refuse" 2 @('verify', $orig, $bad, $flag, $mg)
  Run "13 $m -> patch refuse" 2 @('patch', $bad, (Join-Path $Work "misc/$m.dll"), $flag, $mg)
  Run "13 $m -> backup refuse" 2 @('backup', $bad, (Join-Path $Work "misc/bak-$m"))
}
foreach ($m in 'wrong-alpha','wrong-layer','wrong-poll','wrong-filter-layer','wrong-donut-target','edit-outside-block','edit-other-method',
    'wrong-hidden-path','wrong-hidden-poll','wrong-hidden-hide','wrong-hidden-unhide','wrong-hidden-delim','wrong-hidden-force',
    'wrong-hidden-visible','wrong-start-target','edit-setter-outside','wrong-popup-target','popup-skip-gate',
    'wrong-root-alpha','wrong-root-target','wrong-close-menu','root-skip') {
  $bad = Join-Path $Work "mut/$m.dll"; & $mutate $patched $bad $m
  Run "14 $m -> inspect still reads v5" 0 @('inspect', $bad)
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
# 숨김 훅만 쓰는 File.ReadAllText가 런타임 mscorlib에 없으면(스트리핑) 패치·verify 모두 거부한다
$stripped2 = Join-Path $Work 'stripped2'
Copy-Item (Join-Path $mg '*.dll') $stripped2
& $mutate (Join-Path $mg 'mscorlib.dll') (Join-Path $stripped2 'mscorlib.dll') 'strip-readalltext'
Check '15i stripped mscorlib written' ((Sha (Join-Path $stripped2 'mscorlib.dll')) -ne (Sha (Join-Path $mg 'mscorlib.dll'))) ''
Run '15j patch, runtime lacks File.ReadAllText -> refuse' 2 @('patch', $orig, (Join-Path $Work 'misc/stripped2.dll'), $flag, $stripped2)
Check '15k refusal reason = unresolved_reference' ($last -match 'unresolved_reference') $last
Check '15l refused patch left no output' (!(Test-Path (Join-Path $Work 'misc/stripped2.dll'))) ''
Run '15m verify v5 against that runtime -> refuse' 2 @('verify', $orig, $patched, $flag, $stripped2)

# ---- Cat Talk 연결 호환성 지문(D-033 3단계 사고 재발 방지) ----
# Cat Talk는 연결 전에 업스트림 FeatureProbe로 게임 코드 지문을 계산해 지원 목록과 비교한다. 패치는 그 지문을 하나도 바꾸면 안 된다
# (2026-11-10: 숨김 setter 입구 훅이 privacy 지문을 바꿔 연결이 멈췄다). 업스트림 도구는 실행만 한다.
$probe = Join-Path $projectRoot 'artifacts/compatibility/FeatureProbe.exe'
$contract = Join-Path $projectRoot 'src/bongo_chat/feature-contract.json'
$probeRun = 0
function Features($dll) {
  $script:probeRun++
  $d = Join-Path $Work "probe/$script:probeRun"; New-Item -ItemType Directory -Force $d | Out-Null
  Copy-Item -LiteralPath $dll -Destination (Join-Path $d 'Assembly-CSharp.dll')
  Copy-Item -LiteralPath (Join-Path $mg 'Heathen.Steamworks.dll') -Destination $d
  $out = & $probe $d $contract 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  "$out"
}
$fOrig = Features $orig
Check '18a probe reads the original' ($null -ne $fOrig -and $fOrig -match '"privacy":"[0-9a-f]{64}"') ''
Check '18b v5 keeps every connection fingerprint' ((Features $patched) -eq $fOrig) ''
Check '18c v1/v2/v3 -> v5 keep it too' ((Features $v4a) -eq $fOrig -and (Features $v4b) -eq $fOrig -and (Features $v4c) -eq $fOrig) ''
Check '18d setter hook (2026-11-10 trial shape) changes it' ((Features (Join-Path $Work 'mut/setter-hook.dll')) -ne $fOrig) ''
Check '18e setter edit outside our hooks changes it' ((Features (Join-Path $Work 'mut/edit-setter-outside.dll')) -ne $fOrig) ''

# ---- 설치 도구 버전(D-029): 앱이 기대값과 비교한다. 이전 패처는 version을 모른다 ----
Run '16a version -> ok' 0 @('version')
$ver = $last | ConvertFrom-Json
Check '16b version = cli 2, patchVersion 5' ($ver.cli -eq 2 -and $ver.patchVersion -eq 5) "$last"
Run '16c version with extra args -> error' 1 @('version', 'x')
$legacyVer = & $legacy version 2>$null; $legacyCode = $LASTEXITCODE
Check '16d legacy patcher has no version -> error' ($legacyCode -eq 1) "exit=$legacyCode $legacyVer"
$v2Ver = & $legacy2 version 2>$null | ConvertFrom-Json
Check '16e v2 patcher reports patchVersion 2' ($v2Ver.cli -eq 2 -and $v2Ver.patchVersion -eq 2) ''
$v3Ver = & $legacy3 version 2>$null | ConvertFrom-Json
Check '16f v3 patcher reports patchVersion 3' ($v3Ver.cli -eq 2 -and $v3Ver.patchVersion -eq 3) ''
Check '9 original copy untouched' ((Sha $orig) -eq $origSha) ''
if ($failed) { exit 1 }
