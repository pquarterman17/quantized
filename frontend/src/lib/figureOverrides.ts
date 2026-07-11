// Figure property overrides (#11) — the ONE config object behind the property
// panels. Mirrors calc/figure._apply_overrides key-for-key: every panel field
// lands as a render_figure override, no side channels. `compact` strips
// untouched values so requests stay lean and old backends keep working. Pure.

import type { LegendPos } from "./plotview";

export interface FigureOverrides {
  font_size?: number;
  font_name?: string;
  title_size?: number;
  legend?: { show?: boolean; loc?: string; frame?: boolean; anchor?: [number, number] };
  ticks?: { dir?: "in" | "out"; len?: number; minor?: boolean };
  spines?: { top?: boolean; right?: boolean };
  x_lim?: [number | null, number | null];
  y_lim?: [number | null, number | null];
  margins?: { left?: number; right?: number; top?: number; bottom?: number };
  grid?: boolean;
  /** `size` (MAIN #18 — export parity for the pointer tool's font-size
   *  resize): a per-annotation override, falling back to `font_size` (or
   *  the style preset's own font size) on the backend when absent — see
   *  `calc.figure_overrides._apply_overrides`. */
  annotations?: { x: number; y: number; text: string; size?: number }[];
  /** Manual axis breaks (gap #21, export-side): elided `[lo, hi]` x-ranges,
   *  rendered as twinned panels with diagonal break glyphs
   *  (`calc.figure._render_impl`). `lib/facet.suggestBreaks` proposes
   *  candidates from a gap scan of the x column. */
  x_breaks?: [number, number][];
}

export const LEGEND_LOCS = [
  "best",
  "upper right",
  "upper left",
  "lower left",
  "lower right",
  "center left",
  "center right",
  "upper center",
  "lower center",
  "outside right",
  "outside top",
] as const;

/** The screen's corner-preset legend position (`ne`/`nw`/`se`/`sw`) as a
 *  matplotlib `loc` string — MAIN #18's export-parity mapping for the
 *  non-free-position case (a free `legendXY` uses `loc: "custom"` +
 *  `anchor` instead, matching `calc.figure_overrides`' existing #14
 *  drag-to-place handling verbatim). */
export function legendPosToLoc(pos: LegendPos): string {
  const loc: Record<LegendPos, string> = {
    ne: "upper right",
    nw: "upper left",
    se: "lower right",
    sw: "lower left",
  };
  return loc[pos];
}

const emptyObject = (v: unknown): boolean =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v).every((x) => x === undefined);

/** Drop undefined leaves and empty groups; returns null when NOTHING is set
 *  (so the request omits the key entirely and presets rule untouched). */
export function compactOverrides(ov: FigureOverrides): FigureOverrides | null {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ov)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      // limits: keep only when at least one bound is set; annotations/breaks: non-empty
      if ((k === "annotations" || k === "x_breaks") && v.length === 0) continue;
      if ((k === "x_lim" || k === "y_lim") && v.every((b) => b === null)) continue;
      out[k] = v;
    } else if (typeof v === "object" && v !== null) {
      const grp = Object.fromEntries(
        Object.entries(v).filter(([, x]) => x !== undefined),
      );
      if (!emptyObject(grp) && Object.keys(grp).length) out[k] = grp;
    } else {
      out[k] = v;
    }
  }
  return Object.keys(out).length ? (out as FigureOverrides) : null;
}
