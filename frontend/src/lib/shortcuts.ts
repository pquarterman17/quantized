// The keyboard + mouse cheat-sheet shown by the Shortcuts help dialog (#20,
// MATLAB "Help"). Pure data so the dialog stays a dumb renderer and the list is
// unit-testable (keys non-empty, no duplicate keys within a group). Keep the
// glyphs in sync with the actual handlers in App.tsx / the interactive surfaces.
//
// GUI_INTERACTION #17: "keep in sync manually" is no longer the whole story.
// This sheet and the command registry's own `Action.shortcut` field are two
// lists describing overlapping key combos, and they HAD drifted -- undo/redo,
// paste and Preferences were real registry commands missing from the sheet, a
// gap hidden by the two sources using different spacing ("Cmd Z" here vs
// "CmdZ" there). `shortcutDisplay.test.ts` now normalizes spacing and asserts
// every registry shortcut appears here, so the drift cannot silently return.
// Entries with NO registry command (mouse gestures, single-key plot tools
// handled directly in useGlobalShortcuts) are sheet-only by design.

import { formatShortcut } from "./shortcutFormat";

export interface Shortcut {
  /** Key combo or gesture, rendered in <kbd>. */
  keys: string;
  /** What it does. */
  desc: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Global",
    items: [
      { keys: "⌘ K", desc: "Open the command palette" },
      { keys: "⌘ O", desc: "Import data files" },
      { keys: "⌘ S", desc: "Save workspace (in place once a file is chosen: its project file, or in Chromium the file you picked)" },
      { keys: "⌘ ⇧ S", desc: "Save workspace as… (always asks where)" },
      { keys: "⌘ N", desc: "New workbook (desktop window only: browsers reserve ⌘N, so use the palette there)" },
      { keys: "⌘ J", desc: "Copy the figure to the clipboard" },
      { keys: "F2", desc: "Rename the active dataset" },
      { keys: "⌘ Z", desc: "Undo the last change" },
      { keys: "⌘ ⇧ Z", desc: "Redo" },
      { keys: "⌘ X", desc: "Cut the selected worksheet cells" },
      { keys: "⌘ C", desc: "Copy the selected worksheet cells" },
      { keys: "⌘ V", desc: "Paste data from the clipboard" },
      { keys: "⌘ ,", desc: "Open Preferences" },
      { keys: "⌘ [", desc: "Toggle the Library panel" },
      { keys: "⌘ B", desc: "Toggle the Library panel" },
      { keys: "F6", desc: "Window layout (preview): focus the next window; ⇧ F6 the previous one" },
      { keys: "⌘ ]", desc: "Toggle the Inspector panel" },
      { keys: "⌘ ⇧ L", desc: "Toggle light / dark theme" },
      { keys: "?", desc: "Show this shortcuts sheet" },
      { keys: "Delete", desc: "Delete the selection: worksheet cells, a plot object, or the selected dataset(s)" },
      { keys: "Esc", desc: "Close a dialog / menu / palette" },
    ],
  },
  {
    title: "Library",
    items: [
      { keys: "Click", desc: "Select a dataset (Tree view); plot it (other views)" },
      { keys: "↑ / ↓", desc: "Previous / next dataset (wraps)" },
      { keys: "⌘ Click", desc: "Add / remove from the selection" },
      { keys: "⇧ Click", desc: "Select a range from the last clicked row" },
      { keys: "⌘ A", desc: "Select every visible dataset (Tree view)" },
      { keys: "Double-click", desc: "Open (plot) a dataset; on the open dataset's name, rename it (or F2)" },
      { keys: "⌃ Q", desc: "Worksheet: Set Column Values for the focused column (Ctrl only, never ⌘)" },
      { keys: "Right-click", desc: "Row menu (plot · duplicate · merge · remove…)" },
    ],
  },
  {
    title: "Plot",
    items: [
      { keys: "A", desc: "Autoscale / reset the view" },
      { keys: "⌘ R", desc: "Autoscale / reset the view (Origin's rescale; never reloads the page)" },
      { keys: "⌥ ←", desc: "Back to the previous zoom / pan view" },
      { keys: "⌥ →", desc: "Forward to the next zoom / pan view" },
      { keys: "Z", desc: "Box-zoom tool" },
      { keys: "H", desc: "Pan tool" },
      { keys: "D", desc: "Data-cursor tool" },
      { keys: "M", desc: "Measure tool" },
      { keys: "I", desc: "Integrate tool (area under curve)" },
      { keys: "W", desc: "Peak / FWHM tool" },
      { keys: "Tab", desc: "Focus the plot: ← → step points, ↑ ↓ switch series" },
      { keys: "+ / −", desc: "Plot focused: zoom about the cursor; ⇧ + arrows pan; Home / 0 reset" },
      { keys: "Drag", desc: "Use the active tool over a region" },
      { keys: "Double-click", desc: "Reset / auto-scale the view" },
      { keys: "Right-click", desc: "Plot menu (log · grid · legend · copy · save…)" },
      { keys: "Right-click legend", desc: "Series menu (rename · hide · move to Y2…)" },
    ],
  },
  {
    title: "Analyze",
    items: [
      { keys: "F", desc: "Curve-fit workshop" },
      { keys: "Y", desc: "Hysteresis workshop" },
      { keys: "P", desc: "Find peaks" },
    ],
  },
  {
    title: "Window",
    items: [
      { keys: "⌘ ⇧ N", desc: "New graph window" },
      { keys: "⌘ ⇧ D", desc: "Duplicate window" },
      { keys: "⌘ ⇧ W", desc: "Close window" },
      { keys: "⌘ ⌥ D", desc: "Window layout (preview): Plot | Data side by side" },
      { keys: "⌃ Tab", desc: "Focus next window" },
      { keys: "⌃ ⇧ Tab", desc: "Focus previous window" },
      { keys: "Click", desc: "Focus a background window" },
      { keys: "← ↑ → ↓", desc: "Move a floating panel whose title bar has focus" },
      { keys: "⇧ ← ↑ → ↓", desc: "Resize a floating panel whose title bar has focus" },
    ],
  },
];

// `formatShortcut` / `isMacPlatform` live in the leaf lib/shortcutFormat.ts
// (bundle diet slice 12): the menubar and the palette need them at startup,
// the cheat-sheet above only when Help / Preferences open. Re-exported so
// existing importers are unchanged.
export { formatShortcut, isMacPlatform } from "./shortcutFormat";

/** The whole cheat-sheet, platform-translated. */
export function shortcutGroupsFor(isMac: boolean): ShortcutGroup[] {
  if (isMac) return SHORTCUT_GROUPS;
  return SHORTCUT_GROUPS.map((g) => ({
    ...g,
    items: g.items.map((s) => ({ ...s, keys: formatShortcut(s.keys, isMac) })),
  }));
}
