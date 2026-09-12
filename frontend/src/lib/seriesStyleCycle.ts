// The NON-COLOUR half of the series cycle — PRIMARY_SOFTWARE_AUDIT_PLAN P3.3
// ("contrast and non-color encodings"). Plot three series, touch nothing, and
// until this existed they differed ONLY by hue: `uplotOpts` applied a dash only
// when a per-series `style.line` had been set by hand, and a marker glyph only
// when `style.marker` was on. A colour-blind reader, or anyone printing
// greyscale, got no help at all.
//
// OPT-IN, and modelled on the palette mechanism (`lib/palettes.ts`): a single
// `qz.prefs` boolean (`autoSeriesStyles`) that `store/prefs.syncPrefs` pushes
// into this module on load and on every change, exactly as it pushes the palette
// into `applyPalette` and the number format into `format.setFormatOpts`. One
// flag, one resolver — so the canvas, the legend swatch and the publication
// export cannot disagree about what series 3 looks like.
//
// WHY the flag is module-level rather than threaded through args: parity. The
// resolver has TWO consumers that are reached by completely different paths —
// `uplotOpts.buildOpts` (every canvas: Stage, multi-panel cell, inset,
// snapshot, background window) and `exportStyles.buildExportStyles` (every
// publication producer: figureSpec, spatialPageExport, legacyFigure,
// useGraphTemplates, plotSpecFigure). Threading a boolean to all of them is a
// dozen chances for one call site to be missed, which is precisely the
// screen-vs-export divergence that got the faceted-styling work reverted
// (plans/BUGS_AND_ISSUES.md FEATURE-001). With one module-level flag there is
// nothing to forget.
//
// OFF is byte-identical to the previous behaviour: `resolveSeriesStyle` returns
// the CALLER'S OWN reference untouched (an explicit identity, not a shallow
// copy that happens to compare equal).

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

/** Dash cycle for LINES, by series display position. Three entries because
 *  `LineStyle` has exactly three members and the wire type
 *  (`ExportSeriesStyle.line` -> `calc.figure._LINESTYLE`) carries the same
 *  three — a fourth pattern would have to be added on both sides plus the
 *  Inspector's picker, so the cycle deliberately uses the vocabulary that
 *  already round-trips. `solid` FIRST so series 1 looks exactly as it does
 *  today; hue still separates positions that share a dash (3 dashes x 8
 *  palette colours = 24 distinct combinations before anything repeats). */
export const AUTO_DASH_CYCLE: readonly LineStyle[] = ["solid", "dashed", "dotted"];

/** Marker-glyph cycle for series that DRAW markers (scatter / line+symbol /
 *  an explicit `marker: true`), by series display position. `circle` first for
 *  the same reason `solid` is — series 1 is unchanged. Closed glyphs lead and
 *  the open ones (+ x *) trail, since open glyphs read worst at small sizes.
 *  All eight are `MarkerShape` members, so every one of them survives the trip
 *  through `ExportSeriesStyle.marker_shape` -> `calc.figure._MARKER`. */
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

let _auto = false;

/** Apply the "vary dash/marker automatically" preference (called by the store
 *  on load and after every pref change — see `store/prefs.syncPrefs`). */
export function setAutoSeriesStyles(on: boolean): void {
  _auto = on;
}

/** Whether the auto cycle is currently on (for UI/diagnostics + tests). */
export function autoSeriesStylesEnabled(): boolean {
  return _auto;
}

/**
 * The effective style for the series at display position `index`.
 *
 * With the preference OFF this is the identity function — the same reference
 * comes back out, so a caller's opts/spec is bit-for-bit what it was before
 * this module existed.
 *
 * With it ON, a series that has NO explicit `line` gets one from
 * `AUTO_DASH_CYCLE`, and one with no explicit `markerShape` gets one from
 * `AUTO_MARKER_CYCLE`. An explicit value ALWAYS wins — including an explicit
 * `"solid"`/`"circle"`, which is a deliberate "no encoding here" choice, not an
 * absence.
 *
 * `markerShape` is filled in even when `marker` is false: it is inert until
 * something turns markers on (both `uplotOpts` and `buildExportStyles` gate the
 * glyph behind `marker`), and resolving it unconditionally keeps this function
 * independent of the ambient default-trace preference — which the export path
 * cannot see, so making the cycle depend on it would build a divergence in.
 * The cycle never turns markers ON; it only decides which glyph a series that
 * already draws them uses.
 */
export function resolveSeriesStyle(
  style: SeriesStyle | undefined,
  index: number,
): SeriesStyle | undefined {
  if (!_auto) return style;
  if (style?.line && style.markerShape) return style; // nothing left to assign
  const i = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0;
  return {
    ...style,
    line: style?.line ?? AUTO_DASH_CYCLE[i % AUTO_DASH_CYCLE.length],
    markerShape: style?.markerShape ?? AUTO_MARKER_CYCLE[i % AUTO_MARKER_CYCLE.length],
  };
}
