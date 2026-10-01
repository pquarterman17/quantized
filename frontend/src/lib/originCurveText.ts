// Origin curve style and legend-text helpers (bundle headroom slice 18,
// `plans/BUNDLE_HEADROOM.md`), moved verbatim out of `./originFigures`. Only
// the lazy Origin-apply modules call them (`./originFigureSelection` and
// `./originOverlayFigure`), so they ship with that load. Do not import this
// from an eagerly-reachable module, and do not re-export it from
// `./originFigures`: either folds it back into the eager bundle.

import type { Dataset, MarkerShape, OriginCurve, SeriesStyle } from "./types";

const MARKER_SHAPES: ReadonlySet<string> = new Set([
  "circle", "square", "triangle", "downtriangle", "diamond", "plus", "cross", "star",
]);

/** Translate a decoded Origin curve's style fields into a plot SeriesStyle.
 *  "scatter" → markers, no connecting line (width 0); "line" → a solid line at
 *  the default width (set explicitly so the figure looks like Origin even if
 *  the user's default trace is Scatter); a decoded `color` (#RRGGBB) and
 *  `symbol` (marker shape) apply on top — including when line/scatter itself
 *  wasn't recovered (e.g. Origin's line+symbol plots still get their color and
 *  marker glyph). Returns null when nothing was decoded, so callers leave that
 *  series to the default trace/palette rather than forcing a look. */
export function originCurveSeriesStyle(
  curve: Pick<OriginCurve, "style" | "color" | "symbol" | "lineWidth" | "symbolSize"> | undefined,
): SeriesStyle | null {
  if (!curve) return null;
  const out: SeriesStyle = {};
  if (curve.style === "scatter") {
    out.marker = true;
    out.width = 0;
  } else if (curve.style === "line" || curve.style === "line_symbol") {
    out.width = 1.5;
    if (curve.style === "line_symbol") out.marker = true;
  }
  if (curve.color && /^#[0-9a-fA-F]{6}$/.test(curve.color)) out.color = curve.color;
  if (curve.symbol && MARKER_SHAPES.has(curve.symbol)) {
    out.marker = true;
    out.markerShape = curve.symbol as MarkerShape;
  }
  // Decoded 2026-07-06 (u16@21/25 of the shared curve record, 1/500 pt,
  // 92/92 oracle-exact). A "scatter" curve keeps width 0: Origin stores the
  // latent line width even on symbol-only plots, and applying it would draw
  // a connecting line Origin doesn't show.
  if (typeof curve.lineWidth === "number" && curve.lineWidth > 0 && curve.style !== "scatter") {
    out.width = curve.lineWidth;
  }
  if (typeof curve.symbolSize === "number" && curve.symbolSize > 0 && out.marker) {
    out.markerSize = curve.symbolSize;
  }
  return Object.keys(out).length > 0 ? out : null;
}
// A leading swatch marker Origin's own legend text carries per curve
// (`\l(n)`) — our legend already draws its own colour/marker swatch, so this
// code (plus any whitespace right after it) is always dropped, never shown.
const LEGEND_SWATCH_RE = /\\l\(\d+\)\s*/g;
// The plain auto-template placeholder — "the display name of the nth plot in
// this layer". Deliberately digit-only: a modifier form like `%(7,@LG)` (seen
// live in Hc2 data.opju's Graph40) does NOT match, so it falls through to the
// literal-passthrough branch below instead of being mis-resolved by a guess
// at what the modifier means.
const LEGEND_CODE_RE = /%\((\d+)\)/g;

/** The display name Origin's `%(n)` auto legend substitutes for a bound
 *  curve: the Y column's COMMENT when one is set, falling back to the column
 *  long name, then the short column letter. Validated against the live-COM
 *  PNG oracle on PNR.opj Graph1 (decode-plan #41): its rendered legend reads
 *  "Nuclear SLD" / "700 mT" / "1.5 mT from 700mT" — all column Comments
 *  (`metadata.column_comments`), while the long names are just "rho"/"rhoM".
 *  Columns without a comment keep resolving exactly as before. */
export function curveDisplayName(ds: Dataset, yLetter: string, yIdx: number): string {
  const meta = (ds.data.metadata ?? {}) as Record<string, unknown>;
  const comments = meta.column_comments as Record<string, unknown> | undefined;
  const comment = comments && typeof comments === "object" ? String(comments[yLetter] ?? "") : "";
  return comment || ds.data.labels[yIdx] || yLetter;
}

/** Resolve an Origin legend template string (one `legend_labels` entry) to
 *  display text: strip the `\l(n)` swatch marker Origin prepends (our legend
 *  draws its own swatch), then substitute every `%(n)` placeholder with the
 *  nth bound curve's display name (`curveNames[n - 1]`, 1-based to match
 *  Origin's own numbering). A curve name that isn't available (index out of
 *  range, or that curve never resolved to a bound channel) — or any other
 *  code this grammar doesn't recognize (an `@`-modifier, a future variant) —
 *  is left as the original literal text: a wrong guess is worse than showing
 *  the raw code. Hand-typed legend text (no `%(n)`/`\l(n)` at all) passes
 *  through unchanged. Pure — no store/dataset access, so it's unit-testable
 *  on plain strings. */
export function resolveLegendTemplate(
  template: string,
  curveNames: readonly (string | undefined)[],
): string {
  const stripped = template.replace(LEGEND_SWATCH_RE, "");
  return stripped.replace(LEGEND_CODE_RE, (raw, n: string) => curveNames[Number(n) - 1] || raw);
}
