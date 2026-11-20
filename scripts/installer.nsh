; Cat Talk installer hooks (package.json build.nsis.include). 1.0.9, D-057.
;
; Stop orphaned Cat Talk workers before anything is extracted: an abnormal exit of Cat Talk 1.0.8 or earlier could leave
; its worker (cattalk-sidecar.exe) running, holding that file open so installing over it fails. Only processes that match
; the orphaned-worker signature are stopped (scripts/installer/reap-orphan-workers.ps1): the install's
; resources\sidecar-bin\cattalk-sidecar.exe + the worker argument --multiprocessing-fork + parent gone. Nothing else.
;
; customInit runs in .onInit after the install directory is known (initMultiUser), on every install including
; auto-updates, before electron-builder's own app check (_CHECK_APP_RUNNING, install section). That check runs on
; auto-updates too (it compares the installer's own process name, not its parent's) and, when PowerShell is available,
; stops every process under the install directory. This hook is the earlier step, limited to orphaned workers.
; A failure here never blocks the install; the result is discarded (.onInit has no UI or log yet).

!macro customInit
  Push $0
  Push $1
  InitPluginsDir
  File "/oname=$PLUGINSDIR\cattalk-reap-orphan-workers.ps1" "${PROJECT_DIR}\scripts\installer\reap-orphan-workers.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cattalk-reap-orphan-workers.ps1" -InstallDir "$INSTDIR"'
  Pop $0 ; exit code, or "error" / "timeout"
  Pop $1 ; output line
  Pop $1
  Pop $0
!macroend
