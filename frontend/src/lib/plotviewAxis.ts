// Axis-scale / tick-mode vocabulary for a PlotView, moved verbatim out of
// lib/plotview.ts (module-size ratchet) and re-exported from there, so no
// importer changed. Pure.

import type { AxisScale, TickMode } from "./types";

const AXIS_SCALES: readonly AxisScale[] = ["linear", "log", "reciprocal"];

/** Narrow an arbitrary value to a valid `AxisScale`. */
export function isAxisScale(v: unknown): v is AxisScale {
  return typeof v === "string" && (AXIS_SCALES as readonly string[]).includes(v);
}

/** The back-compat bridge from the pre-MAIN-#12 boolean log flags to the
 *  3-way scale enum: `true` -> `"log"`, `false` -> `"linear"`. Used wherever
 *  an older persisted shape (a `.dwk` view, an Origin-decoded figure's own
 *  `x_log`/`y_log`, which has no reciprocal concept) still only carries a
 *  boolean. */
export function scaleFromLog(log: boolean): AxisScale {
  return log ? "log" : "linear";
}

/** The command-palette / context-menu "cycle" step (MAIN #12 #5): each
 *  invocation advances linear -> log -> reciprocal -> linear. Pure so it's
 *  unit-testable without the store. */
export function cycleAxisScale(current: AxisScale): AxisScale {
  const i = AXIS_SCALES.indexOf(current);
  return AXIS_SCALES[(i + 1) % AXIS_SCALES.length];
}

/** The command-palette "cycle tick format" step (MAIN #20): each invocation
 *  advances auto -> fixed -> sci -> eng -> auto. Same pure/unit-testable
 *  shape as `cycleAxisScale`. */
export function cycleTickMode(current: TickMode): TickMode {
  const modes: readonly TickMode[] = ["auto", "fixed", "sci", "eng"];
  const i = modes.indexOf(current);
  return modes[(i + 1) % modes.length];
}

/** Back-compat axis-scale resolver (MAIN #12): a NEW `scale` field (post-#12
 *  `.dwk`) wins when present and valid; else an OLD boolean `log` field
 *  (pre-#12 `.dwk`) maps `true` -> `"log"`, `false` -> `"linear"`; else `fb`. */
export function axisScaleOrDefault(scale: unknown, log: unknown, fb: AxisScale): AxisScale {
  if (isAxisScale(scale)) return scale;
  if (typeof log === "boolean") return scaleFromLog(log);
  return fb;
}

/** Same bridge for the secondary (y2) axis, whose scale is nullable — `null`
 *  means "inherit the primary Y axis's scale" (both the old `y2Log: boolean |
 *  null` and the new `y2Scale: AxisScale | null` share that convention). */
export function y2ScaleOrDefault(scale: unknown, log: unknown): AxisScale | null {
  if (isAxisScale(scale)) return scale;
  if (typeof log === "boolean") return scaleFromLog(log);
  return null;
}
