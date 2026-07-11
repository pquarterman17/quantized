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

; Second Start Menu entry: "DiraCulator" launches the same shell exe with
; --calc, which src-tauri/src/main.rs (MAIN #23) reads to retitle the window
; "DiraCulator" and open the sidecar's `?view=calc` calculator-only view
; (MAIN #22) instead of the full app. One installed exe, two entry points —
; there is no separate DiraCulator.exe to package or keep in sync.
;
; POSTINSTALL is inserted right after Tauri's own "Create start menu
; shortcut" step (`Call CreateOrUpdateStartMenuShortcut` in the bundled
; installer.nsi's `Section Install`), which just wrote
; "$SMPROGRAMS\${PRODUCTNAME}.lnk". Because this app pins
; `nsis.installMode: "currentUser"` in tauri.conf.json and never sets
; `nsis.startMenuFolder`, that write went straight to the per-user Start
; Menu root — no product subfolder, no elevation — via the SHCTX/
; SetShellVarContext that installer.nsi's `!include MultiUser.nsh` resolves
; once for the whole install (installer.nsi:109-121). We reuse that same
; ambient $SMPROGRAMS root and SHCTX here rather than calling
; SetShellVarContext ourselves, so DiraCulator.lnk lands beside
; Quantized.lnk in the identical location every time.
;
; This write is deliberately unconditional (not skipped when
; $UpdateMode = 1, unlike Tauri's own CreateOrUpdateStartMenuShortcut) so
; the shortcut is guaranteed to appear the first time an existing install is
; upgraded in place to a version that carries it — the common real-world
; path, not a fresh install. The cost is a harmless same-target overwrite of
; the .lnk on every later upgrade too.
;
; ${MAINBINARYNAME} (never a hardcoded "Quantized.exe") is the same define
; every shortcut/registry write in installer.nsi uses for the shell binary,
; so this keeps resolving correctly even if `mainBinaryName` is ever set in
; tauri.conf.json. Icon: the shell exe's own icon (index 0) — no separate
; DiraCulator icon has been generated. SetLnkAppUserModelId (from the
; bundled utils.nsh, included by installer.nsi before this hook file) tags
; the shortcut with the app's AppUserModelID so Windows taskbar/notification
; grouping treats it as the same application, matching Tauri's own
; shortcuts.
!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$SMPROGRAMS\DiraCulator.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--calc" "$INSTDIR\${MAINBINARYNAME}.exe" 0
  !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\DiraCulator.lnk"
!macroend

; Mirror of NSIS_HOOK_POSTINSTALL. POSTUNINSTALL is inserted after Tauri's
; own shortcut-removal block in `Section Uninstall`, which only deletes
; "$SMPROGRAMS\${PRODUCTNAME}.lnk" when $UpdateMode <> 1 — i.e. on a real
; uninstall, never on the old-version uninstall step that an in-place
; upgrade silently runs first (installer.nsi's `Section Uninstall`,
; guarded by the same `${If} $UpdateMode <> 1` this macro re-checks). We
; gate the same way so an upgrade never deletes DiraCulator.lnk out from
; under the (unconditional) POSTINSTALL recreate above, and call
; UnpinShortcut first so a genuine uninstall also clears any Start Menu /
; taskbar pin, matching how Tauri retires its own shortcut.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    !insertmacro UnpinShortcut "$SMPROGRAMS\DiraCulator.lnk"
    Delete "$SMPROGRAMS\DiraCulator.lnk"
  ${EndIf}
!macroend
