// The keyboard + mouse cheat-sheet shown by the Shortcuts help dialog (#20,
// MATLAB "Help"). Pure data so the dialog stays a dumb renderer and the list is
// unit-testable (keys non-empty, no duplicate keys within a group). Keep the
// glyphs in sync with the actual handlers in App.tsx / the interactive surfaces.

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
      { keys: "⌘ [", desc: "Toggle the Library panel" },
      { keys: "⌘ ]", desc: "Toggle the Inspector panel" },
      { keys: "⌘ ⇧ L", desc: "Toggle light / dark theme" },
      { keys: "?", desc: "Show this shortcuts sheet" },
      { keys: "Delete", desc: "Remove the selected dataset(s)" },
      { keys: "Esc", desc: "Close a dialog / menu / palette" },
    ],
  },
  {
    title: "Library",
    items: [
      { keys: "Click", desc: "Plot a dataset (make it active)" },
      { keys: "↑ / ↓", desc: "Previous / next dataset (wraps)" },
      { keys: "⌘ Click", desc: "Add / remove from the selection" },
      { keys: "⇧ Click", desc: "Select a range from the anchor" },
      { keys: "Double-click", desc: "Rename a dataset" },
      { keys: "Right-click", desc: "Row menu (plot · duplicate · merge · remove…)" },
    ],
  },
  {
    title: "Plot",
    items: [
      { keys: "A", desc: "Autoscale / reset the view" },
      { keys: "Z", desc: "Box-zoom tool" },
      { keys: "H", desc: "Pan tool" },
      { keys: "D", desc: "Data-cursor tool" },
      { keys: "M", desc: "Measure tool" },
      { keys: "I", desc: "Integrate tool (area under curve)" },
      { keys: "W", desc: "Peak / FWHM tool" },
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
];

/** macOS uses ⌘; everything else shows Ctrl. Pure so the dialog can localize. */
export function shortcutGroupsFor(isMac: boolean): ShortcutGroup[] {
  if (isMac) return SHORTCUT_GROUPS;
  return SHORTCUT_GROUPS.map((g) => ({
    ...g,
    items: g.items.map((s) => ({ ...s, keys: s.keys.replace(/⌘/g, "Ctrl") })),
  }));
}
