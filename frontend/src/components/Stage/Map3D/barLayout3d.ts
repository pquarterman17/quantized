// Where each 3-D bar stands: ABSOLUTE widths and GROUPED (side by side) bars.
// Mirrors `calc/figure_map3d_bar_layout.py`, pinned together by
// `tests/fixtures/wire/plot3d_kinds.json`. With neither option the bars are laid
// out as before (`layoutRequested` false: `barData` never calls this).
//
//   * `bar_abs`: `bar_abs_w` / `bar_abs_d` are the width (x) and depth (y) in
//     DATA units. Not a number above 0: refused. Wider than the spacing (the
//     median step between distinct positions): clamped to it, with a note.
//   * `bar_grouped`: the bars that share a position stand side by side along x,
//     one slot per category that has a bar (category order), each 1/slots of the
//     footprint wide. Two rows with one position and category: refused.
// Pure.

import type { MapFigureSpec } from "../../../lib/api/mapFigure";

export const layoutRequested = (b: MapFigureSpec): boolean => b.bar_abs === true || b.bar_grouped === true;

export interface BarLayout {
  x: Float64Array;
  dx: number;
  dy: number;
  /** The footnote / caption sentence when a size was clamped, else "". */
  note: string;
}

const CLAMP: Record<string, string> = {
  w: "Bar width clamped to the position spacing so bars do not overlap.",
  d: "Bar depth clamped to the position spacing so bars do not overlap.",
  wd: "Bar width and depth clamped to the position spacing so bars do not overlap.",
};

/** The bars' x anchors, width and depth after the layout options, or the refusal. `sx` / `sy`: the median steps. */
export function applyBarLayout(
  b: MapFigureSpec, x: Float64Array, y: Float64Array, dx: number, dy: number, sx: number, sy: number, codes: ArrayLike<number> | null,
): BarLayout | { error: string } {
  let note = "";
  let xs = x;
  if (b.bar_abs) {
    const sizes: number[] = [];
    for (const [key, v] of [["bar_abs_w", b.bar_abs_w], ["bar_abs_d", b.bar_abs_d]] as const) {
      if (typeof v !== "number" || !(Number.isFinite(v) && v > 0)) return { error: `${key} must be a number above 0 (a size in data units)` };
      sizes.push(v);
    }
    note = CLAMP[`${sizes[0] > sx ? "w" : ""}${sizes[1] > sy ? "d" : ""}`] ?? "";
    dx = Math.min(sizes[0], sx);
    dy = Math.min(sizes[1], sy);
  }
  if (b.bar_grouped) {
    if (!codes) return { error: "grouped bars need a categorical bar colour column: send bar_group" };
    const used = [...new Set(Array.from(codes))].sort((p, q) => p - q);
    const seen = new Set<string>();
    x.forEach((v, i) => seen.add(`${v}|${y[i]}|${codes[i]}`));
    if (seen.size < x.length) {
      return { error: `grouped bars need one row per position and category; ${(x.length - seen.size).toLocaleString("en-US")} rows repeat a position and category (aggregate the rows first, or turn grouping off)` };
    }
    xs = Float64Array.from(x, (v, i) => v + ((used.indexOf(codes[i]) + 0.5) / used.length - 0.5) * dx);
    dx /= used.length;
  }
  return { x: xs, dx, dy, note };
}
