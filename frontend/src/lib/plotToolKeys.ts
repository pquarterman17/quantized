// Map a bare keypress to a plot tool (design interaction layer: H/Z/D + M).
// Pure so the mapping is unit-testable; App.tsx wires the global keydown to it.
// "Pick peak" (P) opens the Peaks workshop rather than selecting a dock tool, so
// it is handled separately in App — it isn't one of these persistent tools.

import type { PlotTool } from "./uplotOpts";

/** Tool for a single-key shortcut, or null if the key isn't a tool hotkey. */
export function toolForKey(key: string): PlotTool | null {
  switch (key.toLowerCase()) {
    case "z":
      return "zoom"; // box zoom
    case "h":
      return "pan";
    case "d":
      return "cursor"; // data cursor
    case "m":
      return "measure";
    default:
      return null;
  }
}
