// Map a bare keypress to a plot tool (design interaction layer: H/Z/D/M/I/W).
// Pure so the mapping is unit-testable; App.tsx wires the global keydown to it.
// "Pick peak" (P) opens the Peaks workshop rather than selecting a dock tool, so
// it is handled separately in App — it isn't one of these persistent tools.
// The quick-fit gadget (#33, "qfit") has NO hotkey here: its obvious letter (F)
// is already bound in App.tsx's own switch to the Curve Fit workshop, which
// runs BEFORE this mapping is ever consulted — adding `case "f"` here would be
// dead code. Select it via the toolbar (≈) or the plot's right-click menu.

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
    case "i":
      return "integ"; // integrate (area under curve)
    case "w":
      return "fwhm"; // peak / full-width-half-max
    default:
      return null;
  }
}
