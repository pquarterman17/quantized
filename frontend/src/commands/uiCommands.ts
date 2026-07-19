// View/Edit/Help-menu command registry entries (theme, density, accent,
// panel toggles, stage tab, command palette, paste, keyboard shortcuts,
// text formatting help) — split out of appCommands.ts (that module's own
// store-size ratchet, zero headroom). appCommands.ts stays the thin
// aggregator; this module owns every command whose `group` is "View",
// "Edit", or "Help" — the small app-chrome groups that don't warrant their
// own module. Behavior is unchanged — this is a verbatim move.

import type { StoreGet } from "../lib/exportActive";
import { openHelp } from "../store/help";
import { PALETTE_LABEL, PALETTE_SHORTCUT, type Action } from "../store/commands";

/** Build the View/Edit/Help-group curated palette actions against the live
 *  store handle (`useApp.getState`) — store setters are stable, so callers
 *  build once. */
export function buildUiCommands(s: StoreGet): Action[] {
  return [
    {
      id: "theme",
      group: "View",
      label: "Toggle theme",
      run: () => s().setTheme(s().theme === "dark" ? "light" : "dark"),
    },
    {
      id: "density",
      group: "View",
      label: "Cycle density",
      run: () => {
        const order = ["compact", "regular", "comfy"] as const;
        s().setDensity(order[(order.indexOf(s().density) + 1) % order.length]);
      },
    },
    {
      id: "accent",
      group: "View",
      label: "Cycle accent color",
      run: () => {
        const order = ["violet", "teal", "ocean", "amber", "rose"] as const;
        s().setAccent(order[(order.indexOf(s().accent) + 1) % order.length]);
      },
    },
    {
      id: "left",
      group: "View",
      label: "Toggle library panel",
      shortcut: "⌘[",
      run: () => s().toggleLeft(),
    },
    {
      id: "right",
      group: "View",
      label: "Toggle inspector panel",
      shortcut: "⌘]",
      run: () => s().toggleRight(),
    },
    {
      id: "column-switcher",
      group: "View",
      label: "Column switcher (flip through channels)…",
      run: () => s().setColumnSwitcherOpen(true),
    },
    {
      id: "worksheet",
      group: "View",
      label: "Show worksheet",
      run: () => s().setStageTab("worksheet"),
    },
    // GUI_INTERACTION #10: restores every open-or-ever-opened floating
    // ToolWindow (curve fit, peaks, baseline, …) to its own default
    // position/size, uncollapsed — the recovery path for a window dragged
    // off-screen or left collapsed/tiny after a monitor change.
    {
      id: "reset-tool-windows",
      group: "View",
      label: "Reset window positions",
      run: () => s().resetToolWindowPositions(),
    },
    {
      id: "plot",
      group: "View",
      label: "Show plot",
      run: () => s().setStageTab("plot"),
    },
    // ── Edit ──
    {
      id: "palette",
      group: "Edit",
      label: PALETTE_LABEL,
      shortcut: PALETTE_SHORTCUT,
      run: () => s().setCmdk(true),
    },
    {
      id: "paste-data",
      group: "Edit",
      label: "Paste data",
      shortcut: "⌘V",
      keywords: "clipboard import tsv csv table",
      run: () => void s().pasteDataFromClipboard(),
    },
    {
      id: "help",
      group: "Help",
      label: "Help topics…",
      keywords: "documentation guide how to search tools help",
      // Standalone store (store/help) — imported directly like toasts, not a
      // useApp flag (see store/help for why).
      run: () => openHelp("search"),
    },
    {
      id: "shortcuts",
      group: "Help",
      label: "Keyboard shortcuts",
      shortcut: "?",
      run: () => s().setShortcutsOpen(true),
    },
    // GOTO #11: the rich-text label micro-syntax reference (Help menu + ⌘K).
    { id: "text-format-help", group: "Help", label: "Text formatting", run: () => s().setTextFormatHelpOpen(true) },
  ];
}
