// Figure property overrides (#11) — the ONE config object behind the property
// panels. Mirrors calc/figure._apply_overrides key-for-key: every panel field
// lands as a render_figure override, no side channels. `compact` strips
// untouched values so requests stay lean and old backends keep working. Pure.

import type { LegendPos } from "./plotview";
import { compactOverrides } from "./figureOverridesSanitize";

export interface FigureOverrides {
  font_size?: number;
  font_name?: string;
  title_size?: number;
  legend?: { show?: boolean; loc?: string; frame?: boolean; anchor?: [number, number]; title?: string };
  ticks?: { dir?: "in" | "out"; len?: number; minor?: boolean };
  spines?: { top?: boolean; right?: boolean };
  x_lim?: [number | null, number | null];
  /** x drawn high-to-low (`PlotView.xReversed`): matplotlib invert_xaxis. */
  x_reversed?: boolean;
  y_lim?: [number | null, number | null];
  /** Fixed secondary (right) Y-axis range — the twinx counterpart of
   *  `y_lim`, applied by `calc.figure_y2.render_with_secondary_axis`
   *  (not `calc.figure_overrides._apply_overrides`, which only ever
   *  targets a single axes). Only meaningful when the request also sets
   *  `y2_keys` — `lib/exportFigureCommand.ts`'s `runExportFigureCommand`
   *  (via `gateY2Overrides`) strips a stale value here once it learns no
   *  channel is actually plotted on the secondary axis, so a request never
   *  carries a leftover range with no y2 axis to apply it to
   *  (GUI_INTERACTION #12 slice 4a). */
  y2_lim?: [number | null, number | null];
  margins?: { left?: number; right?: number; top?: number; bottom?: number };
  grid?: boolean;
  /** `size` (MAIN #18 — export parity for the pointer tool's font-size
   *  resize): a per-annotation override, falling back to `font_size` (or
   *  the style preset's own font size) on the backend when absent. `anchor`
   *  (MAIN #21): `"page"` renders `x`/`y` as FIGURE-fraction placement
   *  (`xycoords="figure fraction"`, y FLIPPED — canvas y grows downward,
   *  matplotlib figure fraction grows upward) instead of axes-data
   *  coordinates; absent = the pre-#21 data-coordinate behaviour. See
   *  `calc.figure_overrides._apply_overrides`. */
  annotations?: {
    x: number;
    y: number;
    text: string;
    size?: number;
    anchor?: "page";
    /** MAIN #27 "text box": a bbox behind the text —
     *  `calc.figure_overrides._apply_overrides`'s `ann.get("frame")` branch. */
    frame?: { fill?: string; stroke?: string; opacity?: number; pad?: number };
  }[];
  /** Manual axis breaks (gap #21, export-side): elided `[lo, hi]` x-ranges,
   *  rendered as twinned panels with diagonal break glyphs
   *  (`calc.figure._render_impl`). `lib/facet.suggestBreaks` proposes
   *  candidates from a gap scan of the x column. */
  x_breaks?: [number, number][];
  /** MAIN #27 drawn shapes (arrow/line/rect/ellipse) —
   *  `calc.figure_shapes._apply_shapes`. Mirrors `Shape` minus the `id`
   *  (the wire shape needs no identity, unlike the screen's editable list). */
  shapes?: {
    kind: "arrow" | "line" | "rect" | "ellipse";
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    anchor?: "page";
    stroke?: string;
    fill?: string;
    opacity?: number;
    width?: number;
    dash?: boolean;
  }[];
  /** Export-fidelity gap (2026-08-11): fixed X/Y reference lines (Hc/Tc
   *  markers, a zero line, a critical edge…) — `lib/uplotOverlays.ts`'s
   *  refLinePlugin. Mirrors `RefLine` minus `id` (the wire needs no
   *  identity, unlike the screen's editable list — same reasoning as
   *  `shapes` above). Always the PRIMARY axes — `RefLine` has no
   *  secondary-axis concept, unlike `RegionShade` below. See
   *  `calc.figure_decor._apply_ref_lines`. */
  ref_lines?: { axis: "x" | "y"; value: number }[];
  /** Export-fidelity gap (2026-08-11): filled rectangular region bands
   *  (Origin `Rect*` film-stack shading, decode-plan #41) —
   *  `lib/uplotOverlays.ts`'s regionShadePlugin. Mirrors `RegionShade`
   *  minus `id`. `axis: 1` renders on the SECONDARY (y2) scale when the
   *  request has one (`y2_keys` set and non-empty); falls back to the
   *  primary scale otherwise — matches the screen's own `hasY2` fallback.
   *  See `calc.figure_decor._apply_region_shades`/`_split_region_shades_by_axis`. */
  region_shades?: { x1: number; x2: number; y1: number; y2: number; fill: string; axis?: 0 | 1 }[];
  /** The magnifier inset (`PlotView.inset`, sent while `insetMode` is on):
   *  an inset axes at `at` (main-frame fractions, top-origin) showing the
   *  source region `x` × `y` with the plot's own series and scales, plus the
   *  source outline and, with `lines`, its connectors —
   *  `calc.figure_inset.apply_inset`. No `x`: the export seeds the screen's
   *  central third; no `y`: autoscaled over that x window. On a dual-Y
   *  figure the y2 series draw on a twin inset axis ranged by `y2` (as last
   *  drawn; absent = autoscaled), as the screen's inset does. */
  inset?: { x?: [number, number]; y?: [number, number]; y2?: [number, number]; at: [number, number, number, number]; lines?: boolean };
}

// `sanitizeFigureOverrides` and `compactOverrides` (with the helpers only
// they use) live in lib/figureOverridesSanitize.ts (bundle diet slice 12):
// the eager figure-document parser needs only those, the merge / legend /
// y2-gate helpers below serve the lazy Figure Builder and exporters.
// Re-exported so existing importers are unchanged.
export { compactOverrides, sanitizeFigureOverrides } from "./figureOverridesSanitize";

/** Overlay publication settings without replacing a partially specified nested group. */
export function mergeFigureOverrides(
  canonical: FigureOverrides | undefined,
  publication: FigureOverrides | null | undefined,
): FigureOverrides | undefined {
  if (!publication) return canonical;
  const merged: FigureOverrides = { ...canonical, ...publication };
  if (canonical?.legend || publication.legend) merged.legend = { ...canonical?.legend, ...publication.legend };
  if (canonical?.ticks || publication.ticks) merged.ticks = { ...canonical?.ticks, ...publication.ticks };
  if (canonical?.spines || publication.spines) merged.spines = { ...canonical?.spines, ...publication.spines };
  if (canonical?.margins || publication.margins) merged.margins = { ...canonical?.margins, ...publication.margins };
  return compactOverrides(merged) ?? undefined;
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
  "auto",
] as const;

/** The screen's corner-preset legend position (`ne`/`nw`/`se`/`sw`) as a
 *  matplotlib `loc` string — MAIN #18's export-parity mapping for the
 *  non-free-position case (a free `legendXY` uses `loc: "custom"` +
 *  `anchor` instead, matching `calc.figure_overrides`' existing #14
 *  drag-to-place handling verbatim). */
export function legendPosToLoc(pos: LegendPos): string {
  const loc: Record<LegendPos, string> = {
    // calc.figure_overrides: "best" for up to eight series, then "outside
    // right" — the screen's auto rule (lib/legendAutoPlace).
    auto: "auto",
    ne: "upper right",
    nw: "upper left",
    se: "lower right",
    sw: "lower left",
  };
  return loc[pos];
}

/** Second-pass gate for the two override fields `liveViewOverrides` cannot
 *  compute correctly on its own, because it only sees raw store state
 *  before the caller has derived which channels are ACTUALLY plotted on
 *  the secondary axis (GUI_INTERACTION #12 slice 4a):
 *    - `y2_lim` must not reach the request when nothing is plotted on y2
 *      (a stale range from a since-untagged y2 channel would otherwise
 *      leak through — the request would have no y2 axis to apply it to).
 *    - `ticks.minor` must ALSO turn on for a log-scaled secondary axis,
 *      not just a log primary xScale/yScale — folded into the SAME single
 *      boolean `_apply_overrides` already reads (see its caller,
 *      `runExportFigureCommand`, for the exact OR condition).
 *  `liveViewOverrides` itself stays a pure function of raw state (and its
 *  own unit tests keep exercising it directly with no knowledge of the
 *  plotted split) — this runs ONLY at the `runExportFigureCommand` call
 *  site, once `y2Plotted`/`minorTicks` are known. */
export function gateY2Overrides(
  ov: FigureOverrides | undefined,
  opts: { y2Plotted: boolean; minorTicks: boolean },
): FigureOverrides | undefined {
  if (!ov && !opts.minorTicks) return ov;
  const { y2_lim, ticks, ...rest } = ov ?? {};
  return (
    compactOverrides({
      ...rest,
      ...(opts.y2Plotted ? { y2_lim } : {}),
      ticks: opts.minorTicks ? { ...ticks, minor: true } : ticks,
    }) ?? undefined
  );
}
