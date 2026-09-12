// The NON-COLOUR half of the series cycle — PRIMARY_SOFTWARE_AUDIT_PLAN P3.3
// ("contrast and non-color encodings"). Plot three series, touch nothing, and
// until this existed they differed ONLY by hue: `uplotOpts` applied a dash only
// when a per-series `style.line` had been set by hand, and a marker glyph only
// when `style.marker` was on. A colour-blind reader, or anyone printing
// greyscale, got no help at all.
//
// OPT-IN TWICE OVER, and that is the whole design. A render path cycles only if
// BOTH are true:
//
//   1. the `autoSeriesStyles` preference is on (`store/prefs.ts`), and
//   2. that call site passed a `SeriesCycle` — the display positions of the
//      series it draws.
//
// (2) is what this module exists to enforce. The first cut made the flag a
// module-level singleton that every `buildOpts`/`buildExportStyles` caller
// silently inherited, and five render paths then cycled on screen with no
// export that could reproduce them (faceted panels, `group_col` panels, the
// waterfall, the reflectometry panel, and stacked panels — see the table in
// `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md` P3.3). That is exactly the
// screen-vs-export divergence that got the faceted-styling work reverted
// (plans/BUGS_AND_ISSUES.md FEATURE-001). With the positions as the switch, a
// NEW render path is uncycled until somebody wires its export and passes one;
// forgetting fails safe.
//
// THE POSITIONS ARE ALSO THE FIX FOR THE HIDDEN-SERIES SKEW. The canvas keeps a
// hidden series in `payload.series` and merely sets `show: false`
// (`usePlotPayload.ts` -> `uplotOpts.ts`), so a channel's display position is
// its index in the UNFILTERED plotted list. The export drops hidden channels
// outright (`figureSpec.ts`), so the same channel sits one or more slots
// earlier there. Two independently-derived indices meant channel B drew dashed
// on screen and solid in the PDF. The export therefore passes the canvas'
// positions, not its own indices — one display-order space, both renderers.
//
// OFF is byte-identical to the previous behaviour: with no cycle,
// `resolveSeriesStyle` returns the CALLER'S OWN reference untouched (an
// explicit identity, not a shallow copy that happens to compare equal).

import type { LineStyle, MarkerShape, SeriesStyle } from "./types";

/** Dash patterns (canvas setLineDash arrays) per line style; solid = no dash.
 *  Moved here from `uplotOpts.ts` — the dash vocabulary and the cycle that
 *  assigns it belong together, and the export parity test needs to compare the
 *  canvas dash against `ExportSeriesStyle.line` without importing the plot
 *  builder. `Stage/LegendSample.tsx` keeps its own SVG `stroke-dasharray`
 *  spelling of the same three styles (a different unit system, not a copy). */
export const DASH: Record<LineStyle, number[] | undefined> = {
  solid: undefined,
  dashed: [8, 4],
  dotted: [2, 4],
};

/**
 * One render path's opt-in to the cycle: the DISPLAY POSITION of each series
 * that path draws, indexed by the path's own series index.
 *
 * `null` (and an index with no entry) means "do not cycle" — which is why
 * every `buildOpts`/`buildExportStyles` caller that has not wired an export
 * gets today's rendering for free, and why a fit/baseline overlay appended past
 * the plotted channels (the export draws no overlays at all) stays undashed.
 */
export type SeriesCycle = readonly number[] | null;

/** Dash cycle for LINES, by series display position. Three entries because
 *  `LineStyle` has exactly three members and the wire type
 *  (`ExportSeriesStyle.line` -> `calc.figure._LINESTYLE`) carries the same
 *  three — a fourth pattern would have to be added on both sides plus the
 *  Inspector's picker, so the cycle deliberately uses the vocabulary that
 *  already round-trips. `solid` FIRST so series 1 looks exactly as it does
 *  today; hue still separates positions that share a dash (3 dashes x 8
 *  palette colours = 24 distinct combinations before anything repeats). */
export const AUTO_DASH_CYCLE: readonly LineStyle[] = ["solid", "dashed", "dotted"];

/** Marker-glyph cycle for series that DRAW markers, by series display
 *  position. `circle` first for the same reason `solid` is — series 1 is
 *  unchanged. Closed glyphs lead and the open ones (+ x *) trail, since open
 *  glyphs read worst at small sizes. All eight are `MarkerShape` members, so
 *  every one survives the trip through `ExportSeriesStyle.marker_shape` ->
 *  `calc.figure._MARKER`.
 *
 *  "Draws markers" means an EXPLICIT `style.marker`, never the ambient
 *  `Scatter` / `Line + markers` default trace: `exportStyles.ts` emits a
 *  marker only for an explicit `style.marker`, so cycling glyphs onto the
 *  default trace would put eight shapes on screen that the export renders as
 *  eight circles. `markers.seriesPoints` holds that line. */
export const AUTO_MARKER_CYCLE: readonly MarkerShape[] = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "downtriangle",
  "plus",
  "cross",
  "star",
];

/** The single-panel overlay is the ONLY live view whose publication export
 *  renders the plotted series one-for-one — same set, same display order, same
 *  per-series styles. Grouped views send `group_col`, which the renderer splits
 *  into synthetic per-level series that `series_styles` cannot address
 *  (`routes/export_figures.py:114-117`); faceted views send `facets`, for which
 *  `series_styles` is explicitly unused (`:125-127`); and `stackMode` is a
 *  screen-only split (one panel per channel, plus the break/facet/spatial
 *  arrangements, all of which `PlotStage` gates behind it) that the
 *  single-figure export does not reproduce at all. Both the Stage canvas and
 *  `figureSpec` ask THIS function, so the two cannot drift into disagreement
 *  about which views cycle. */
export function overlayExportsSeriesStyles(v: {
  groupKey: number | null | undefined;
  facetKey: number | null;
  stackMode: boolean;
}): boolean {
  return (v.groupKey === null || v.groupKey === undefined) && v.facetKey === null && !v.stackMode;
}

/** The display positions of `count` series in their own natural order — the
 *  opt-in every canvas passes, since a canvas indexes its series by display
 *  position already. Returns `null` when `on` is false so the call site reads
 *  as one expression. */
export function displayPositions(on: boolean, count: number): SeriesCycle {
  return on ? Array.from({ length: count }, (_, i) => i) : null;
}

/**
 * The effective style for the series at this render path's index `index`.
 *
 * With no cycle this is the identity function — the same reference comes back
 * out, so a caller's opts/spec is bit-for-bit what it was before this module
 * existed.
 *
 * With one, a series that has NO explicit `line` gets one from
 * `AUTO_DASH_CYCLE` at its display position, and one with no explicit
 * `markerShape` gets one from `AUTO_MARKER_CYCLE`. An explicit value ALWAYS
 * wins — including an explicit `"solid"`/`"circle"`, which is a deliberate "no
 * encoding here" choice, not an absence.
 *
 * `markerShape` is filled in even when `marker` is false: it is inert until
 * something turns markers on (both `markers.seriesPoints` and
 * `buildExportStyles` gate the glyph behind an explicit `marker`), and
 * resolving it unconditionally keeps this function independent of the ambient
 * default-trace preference — which the export path cannot see, so making the
 * cycle depend on it would build a divergence in. The cycle never turns markers
 * ON; it only decides which glyph a series that already draws them uses.
 */
export function resolveSeriesStyle(
  style: SeriesStyle | undefined,
  index: number,
  cycle: SeriesCycle,
): SeriesStyle | undefined {
  const i = cycle?.[index];
  if (i === undefined) return style;
  return {
    ...style,
    line: style?.line ?? AUTO_DASH_CYCLE[i % AUTO_DASH_CYCLE.length],
    markerShape: style?.markerShape ?? AUTO_MARKER_CYCLE[i % AUTO_MARKER_CYCLE.length],
  };
}

/** The valid `MarkerShape` values as a lookup, derived from the cycle above so
 *  the two cannot disagree about which glyphs exist. BOTH sanitizers validate
 *  against it — `plotspec2.ts` for the view style and `publicationStyles.ts`
 *  for the wire style — which is why it lives here rather than in `markers.ts`:
 *  that module carries the canvas path builders, and the persistence layer is
 *  deliberately kept clear of them (see `publicationStyles.ts`'s header). */
export const MARKER_SHAPE_VALUES: ReadonlySet<string> = new Set(AUTO_MARKER_CYCLE);

// ── The COLOUR half of the same cycle ───────────────────────────────────────
// Moved out of `lib/uplotOpts.ts`, which is on a shrink-only module pin and had
// to gain the `seriesCycle` argument. It belongs beside the dash/glyph cycle
// anyway: hue by display position here, dash and glyph by display position
// above, both indexed by the ONE position space the canvas and the export now
// share — and putting it here stops `lib/exportStyles.ts` importing the whole
// uPlot options builder just to resolve a colour. `uplotOpts.ts` re-exports all
// three names, so every existing importer is untouched.

/** Exported for `useAnnotationEdit`'s Frame "Solid" preset (MAIN #27), which
 *  needs a concrete resolved surface color to draw behind text — a canvas
 *  `fillStyle` can't take a live `var(--x)` reference the way DOM CSS can. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export const SERIES_VARS = [
  "--series-1",
  "--series-2",
  "--series-3",
  "--series-4",
  "--series-5",
  "--series-6",
  "--series-7",
  "--series-8",
];

/** Effective stroke for display-series `i`: an explicit override (token name or
 *  literal hex) wins, else the palette color by position. A `"--token"` color is
 *  resolved through `cssVar` so it stays re-themeable; a literal passes through.
 *
 *  `i` is a DISPLAY POSITION, not a channel index and not the caller's own array
 *  index — `lib/exportStyles.ts` has to pass the canvas' position rather than
 *  its own, because its list is hidden-filtered and the canvas' is not. See
 *  `lib/seriesStyleCycle.ts`'s header. */
export function seriesColor(i: number, style?: SeriesStyle): string {
  const c = style?.color;
  if (c) return c.startsWith("--") ? cssVar(c) || c : c;
  return cssVar(SERIES_VARS[i % SERIES_VARS.length]) || "#8b5cf6";
}
