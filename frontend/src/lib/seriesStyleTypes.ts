// The per-series STYLE vocabulary of a plot — line style, marker shape, step
// alignment, the default-trace preference and the per-channel `SeriesStyle`
// override itself. Moved verbatim out of lib/types.ts (its .ts module-size
// pin, architecture.test.ts) as one self-contained leaf block when audit
// P2.3 added `SeriesStyle.logOffset`; re-exported from types.ts, so no
// importer changed.

import type { ColormapName } from "./colormap";

/** Per-channel line style (solid/dashed/dotted) — maps to a uPlot dash array. */
export type LineStyle = "solid" | "dashed" | "dotted";

/** The app-wide default-trace preference's four values (`store/prefs.ts`'s
 *  `TRACES`, which sanitizes the persisted blob against exactly this list).
 *  Beside `LineStyle`/`MarkerShape` rather than travelling as a bare `string`:
 *  `markers.markerDecision` and `uplotOpts.buildOpts` branch on it BY VALUE. */
export type DefaultTrace = "Line" | "Line + markers" | "Scatter" | "Step";

/** Stepped-line alignment (GAP_PLOTTYPES — Graph Builder "step" mark), the
 *  same three-way vocabulary as matplotlib's `drawstyle` ("steps-pre"/
 *  "steps-post"/"steps-mid") and uPlot's `paths.stepped({align})`:
 *  "post" (uPlot `align: 1`) holds a point's Y value until the NEXT x, then
 *  jumps — the honest default for a right-continuous profile (an XRD
 *  occupancy/SLD layer's value holds from its own x through the next);
 *  "pre" (uPlot `align: -1`) jumps immediately at each point's OWN x, then
 *  holds; "mid" jumps at the x-midpoint between two points (matplotlib
 *  `steps-mid`; uPlot has no built-in "mid" align, so the interactive Stage
 *  uses a small hand-rolled path builder — see `lib/uplotPaths.ts`). */
export type StepMode = "pre" | "post" | "mid";
export type MarkerShape =
  | "circle"
  | "square"
  | "triangle"
  | "downtriangle"
  | "diamond"
  | "plus"
  | "cross"
  | "star";

/** A per-channel styling override for the plot. Keyed in the store by the
 *  dataset *channel index* (stable across show/hide). Any field left unset
 *  falls back to the default (palette color by display position, 1.5 px,
 *  solid). `color` is either a token name (`"--series-3"`, re-themeable) or a
 *  literal hex (`"#ff8800"`, from the custom picker). */
export interface SeriesStyle {
  color?: string;
  width?: number;
  line?: LineStyle;
  marker?: boolean; // draw markers at each data point
  markerSize?: number; // marker diameter in px (default 5); only when marker
  markerShape?: MarkerShape; // marker glyph (default circle); only when marker
  /** Fill under/between curves (MAIN #13). `"none"`/undefined = no fill
   *  (default). `"under"` fills from the line down to a ZERO y baseline —
   *  uPlot's native `series.fill`/`fillTo` on screen, matplotlib
   *  `fill_between(x, y, 0)` on export. `{vs: <channel>}` fills the band
   *  BETWEEN this series and another plotted channel — uPlot's native
   *  `opts.bands` on screen, `fill_between(x, y, other)` on export. `vs` is
   *  always a dataset *channel index* (the same space `errKeys`/`colorBy`
   *  use); a channel not currently plotted silently drops the band (both
   *  uPlot bands and the export resolver can only fill between two DRAWN
   *  series). Fill colour is always derived from the series' own resolved
   *  stroke colour at a fixed translucency — never a separate stored colour. */
  fill?: "none" | "under" | { vs: number };
  /** Colour-mapped scatter (MAIN #14): colour each plotted point by a THIRD
   *  channel's value instead of a flat series colour. A dataset *channel
   *  index* (any channel, not required to be otherwise plotted) or
   *  null/undefined = off (the normal flat-colour line/marker rendering).
   *  When set, the line AND native points are hidden — a dedicated draw-hook
   *  plugin (`uplotOverlays.colorScatterPlugin`) paints coloured points
   *  keyed to this series' displayed x/y + the channel's values; the export
   *  path draws matplotlib `scatter(c=z, cmap=...)` + a colourbar instead of
   *  `ax.plot`. */
  colorBy?: number | null;
  /** Colormap for `colorBy` (`lib/colormap.ts`'s named maps — viridis/magma/
   *  gray). Only consulted when `colorBy` is set; default `"viridis"`. */
  colormap?: ColormapName;
  /** Stepped-line alignment (GAP_PLOTTYPES Graph Builder "step" mark) — see
   *  `StepMode`'s doc. Undefined = an ordinary straight-line connector (today's
   *  behavior). Composes with `line` (dash pattern) and `marker`/`width`
   *  (there is still no `line: "none"` sentinel here — a zero `width` is
   *  what draws a marker-only series; `step` only changes the SHAPE of a
   *  nonzero-width connector). */
  step?: StepMode;
  /** Decade offset for a log-y comparison (audit P2.3): the series is DRAWN
   *  at y · 10^k (a whole number k, |k| ≤ 30) and its legend says " ×10^k";
   *  the data are untouched. `lib/logOffset.ts` owns the rule. */
  logOffset?: number;
  /** A COMPLETE style (a Graph Builder mark, `plotspec.markSeriesStyle`): the
   *  Preferences default trace fills nothing, so an unset `width` draws a line,
   *  an unset `marker` none and an unset `step` a straight line. Absent (every
   *  older saved style) = the default trace fills what is unset, as before.
   *  Read through `markers.seriesTrace` on the canvas, legend and export. */
  explicit?: boolean;
}
