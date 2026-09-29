// Host-platform shortcut display: the two helpers the menubar, the Appearance
// menu and the ⌘K palette need on first paint. Split out of lib/shortcuts.ts
// (bundle diet slice 12, plans/BUNDLE_HEADROOM.md) so the ~2 kB cheat-sheet
// table there — rendered only by the Help, Shortcuts and Preferences dialogs,
// all lazy — no longer rides in the entry chunk behind them. Moved verbatim.

/** Translate ONE key-combo string for the host platform: macOS keeps ⌘;
 *  everything else shows Ctrl. `⌃` (the literal Control key — item 5's
 *  window-cycling shortcuts are Ctrl ONLY, never Cmd, so they don't collide
 *  with the macOS app switcher) reads the same as `⌘` once translated: both
 *  mean "Ctrl" outside macOS.
 *
 *  GUI_INTERACTION #17: this used to be inlined inside `shortcutGroupsFor`,
 *  which meant ONLY the Shortcuts dialog localized. The menubar and the ⌘K
 *  palette rendered `Action.shortcut` raw, so a Windows user saw "⌘O" in the
 *  File menu and "Ctrl+O" in Help ▸ Keyboard shortcuts — the same app giving
 *  two answers for one key. Exported so every surface runs the same
 *  translation. */
export function formatShortcut(keys: string, isMac: boolean): string {
  return isMac ? keys : keys.replace(/⌘|⌃/g, "Ctrl");
}

/** Is the host a Mac? Single definition — `ShortcutsDialog` and
 *  `PreferencesDialog` each carried their own copy of this regex over the
 *  DEPRECATED `navigator.platform`. Prefers the modern
 *  `navigator.userAgentData.platform` and falls back to the old field. */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaPlatform = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform;
  if (typeof uaPlatform === "string" && uaPlatform.length > 0) return /mac/i.test(uaPlatform);
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}
