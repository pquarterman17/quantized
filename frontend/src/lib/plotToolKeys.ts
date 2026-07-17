// Map a bare keypress to a plot tool (design interaction layer: H/Z/D/M/I/W).
// Pure so the mapping is unit-testable; App.tsx wires the global keydown to it.
// "Pick peak" (P) opens the Peaks workshop rather than selecting a dock tool, so
// it is handled separately in App — it isn't one of these persistent tools.
// The quick-fit gadget (#33, "qfit") has NO hotkey here: its obvious letter (F)
// is already bound in App.tsx's own switch to the Curve Fit workshop, which
// runs BEFORE this mapping is ever consulted — adding `case "f"` here would be
// dead code. Select it via the toolbar (≈) or the plot's right-click menu.
//
// GUI_INTERACTION_PLAN #7 (plot-toolbar legibility): the toolbar's tooltip
// shows each tool's shortcut, so the mapping is now a single {tool: key} table
// with both directions derived from it (toolForKey for useGlobalShortcuts,
// keyForTool for the toolbar) — one table, no risk of the tooltip drifting
// onto a different letter than the actual handler.

import type { PlotTool } from "./uplotOpts";

const TOOL_KEYS: Partial<Record<PlotTool, string>> = {
  zoom: "Z",
  pan: "H",
  cursor: "D",
  measure: "M",
  integ: "I",
  fwhm: "W",
};

/** Tool for a single-key shortcut, or null if the key isn't a tool hotkey. */
export function toolForKey(key: string): PlotTool | null {
  const upper = key.toUpperCase();
  const entry = (Object.entries(TOOL_KEYS) as [PlotTool, string][]).find(([, k]) => k === upper);
  return entry ? entry[0] : null;
}

/** The single-key shortcut for a tool, or null if it has none (pointer, stats,
 *  select, qfit — all reachable only via the toolbar or the plot's right-click
 *  menu). Used by the toolbar tooltip so its shortcut chip can't drift from
 *  the handler above. */
export function keyForTool(tool: PlotTool): string | null {
  return TOOL_KEYS[tool] ?? null;
}

// Reset View isn't a PlotTool (it's a whole-view action bound in
// useGlobalShortcuts.ts's plain "a"/"A" case and documented in
// lib/shortcuts.ts's Plot group under the same letter) — named here, next to
// the tool-key table it sits beside in the toolbar, so there's exactly one
// place to change if that binding ever moves.
export const RESET_VIEW_KEY = "A";
