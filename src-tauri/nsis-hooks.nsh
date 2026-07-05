; Quantized custom NSIS installer hooks (wired via tauri.conf.json
; bundle.windows.nsis.installerHooks).
;
; Force-kill the bundled qz-server sidecar (and any child processes) before the
; installer overwrites or removes its files. Quantized ships the Python backend
; as a PyInstaller "qz-server.exe" beside the shell exe; an in-place upgrade
; (or an uninstall) while that sidecar is still running — the current version's,
; or an orphan left by a crash / a uvicorn grandchild the shell's kill() didn't
; reach — fails with:
;
;   Error opening file for writing:
;   ...\Quantized\qz-server\_internal\PIL\_imaging.cp313-win_amd64.pyd
;
; because the live process holds those bundled binaries open. taskkill /T also
; takes down any children; the short sleep lets Windows release the file handles
; before the copy step runs. taskkill returning "not found" (nothing to kill) is
; harmless — the return code is popped and ignored.

!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /T /IM qz-server.exe'
  Pop $0
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /T /IM qz-server.exe'
  Pop $0
  Sleep 1000
!macroend
