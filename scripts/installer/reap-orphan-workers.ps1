# Cat Talk installer step (1.0.9, D-057). Run from scripts/installer.nsh before any file is extracted.
#
# Cat Talk 1.0.8 and earlier could leave its worker process running after an abnormal exit (an orphan). The orphan holds
# <install>\resources\sidecar-bin\cattalk-sidecar.exe open, so installing over it fails, and keeps Steam's
# 'Bongo Cat running' registration. Stop ONLY processes that match the orphaned-worker signature - the same rule as
# sidecar/worker_guard.py is_orphan_worker:
#   1. image path is exactly <InstallDir>\resources\sidecar-bin\cattalk-sidecar.exe
#   2. command line has the worker argument --multiprocessing-fork (the sidecar itself does not)
#   3. parent is gone: no process with the parent pid, or it is a different program, or it started after the worker
#      (the pid was reused)
# Nothing else is stopped. Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page).
param([Parameter(Mandatory = $true)][string]$InstallDir)

$ErrorActionPreference = 'Stop'
try {
    $exe = [System.IO.Path]::GetFullPath((Join-Path $InstallDir 'resources\sidecar-bin\cattalk-sidecar.exe'))
    $same = { param($path) $path -and [string]::Equals([System.IO.Path]::GetFullPath($path), $exe, [System.StringComparison]::OrdinalIgnoreCase) }
    $targets = @()
    foreach ($p in @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'cattalk-sidecar.exe'")) {
        if (-not (& $same $p.ExecutablePath)) { continue }
        if (-not $p.CommandLine -or $p.CommandLine -notmatch '(^|\s|")--multiprocessing-fork("|\s|$)') { continue }
        $parent = @(Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId = {0}" -f [int]$p.ParentProcessId))
        $orphan = ($parent.Count -eq 0) -or (-not (& $same $parent[0].ExecutablePath)) -or ($parent[0].CreationDate -gt $p.CreationDate)
        if ($orphan) { $targets += $p }
    }
    $stopped = 0
    foreach ($t in $targets) {
        $id = [int]$t.ProcessId
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $id -Timeout 5 -ErrorAction SilentlyContinue
        if (-not (Get-Process -Id $id -ErrorAction SilentlyContinue)) { $stopped += 1 }
    }
    Write-Output ("cattalk-orphan-workers matched={0} stopped={1}" -f $targets.Count, $stopped)
    if ($stopped -lt $targets.Count) { exit 2 }
    exit 0
} catch {
    Write-Output "cattalk-orphan-workers error"
    exit 1
}
