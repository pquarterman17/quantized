// Resolve Origin figure snapshots (`figures.extract_figures`, plan item 18)
// against the datasets created by the same import, and describe how to
// display one in the Library. Pure/store-agnostic so the matching heuristic
// is unit-testable without mounting the store — `store/useApp.ts` owns the
// actual apply-to-plot-state action.
//
// EAGER HALF (bundle headroom slice 1, `plans/BUNDLE_HEADROOM.md`). Only what
// first paint needs lives here: the Library row label/family grouping, import-
// time entry construction, and the legend-text helpers `lib/originOverlay.ts`
// reaches during overlay materialization. Everything an APPLY needs —
// legend/annotation/region resolution (`./originFigureSelection`) and the
// spatial multi-panel solver (`./originSpatialPanels`) — moved to modules the
// store loads on demand via `store/originApplyLibs.ts`, taking their
// `originPanels`/`panelLayout`/`errorbars` transitive weight off first paint.
// Keep it that way: a static import of either module from an eagerly-reachable
// file silently folds them back into the entry chunk.

import type {
  Dataset,
  MarkerShape,
  OriginCurve,
  OriginFigure,
  SeriesStyle,
} from "./types";

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
/** One figure attached to an import "family" (one file's worth of books).
 *  `datasetId` is the best-effort resolved target, or null if the figure's
 *  loose `source_hint` didn't match any book created by this import — the
 *  Library shows it disabled with the hint in its tooltip rather than
 *  guessing wrong (never silently attaches to the wrong book). */
export interface OriginFigureEntry {
  id: string;
  stem: string;
  figure: OriginFigure;
  datasetId: string | null;
  /** Dataset ids created by the SAME import as this figure. Cross-book overlay
   *  resolution is scoped to these so a figure never pulls a same-named book
   *  (Origin's default `Book1`/`Book2`/… repeat across separate projects) from
   *  a different import. */
  siblingIds: string[];
}

/** Best-effort match of a figure's loose `source_hint` against the datasets
 *  created by the same import. Origin's graph windows only carry a partial
 *  worksheet reference (`docs/origin_re/opj_figures.md`), so this is a
 *  heuristic, not an exact curve->column resolution: an unambiguous single
 *  candidate always resolves; otherwise the hint is matched against the
 *  book's short/long Origin names, falling back to a substring check against
 *  the dataset's display name. */
export function resolveFigureDataset(figure: OriginFigure, candidates: Dataset[]): string | null {
  if (candidates.length === 1) return candidates[0].id; // one target - unambiguous
  if (candidates.length === 0) return null;
  // Decoded curve bindings name their book exactly — an exact match beats
  // every hint heuristic. (Curves may span books; the first match wins since
  // one figure entry activates one dataset.)
  for (const curve of figure.curves ?? []) {
    const hit = candidates.find(
      (c) => String((c.data.metadata ?? {}).origin_book ?? "") === curve.book,
    );
    if (hit) return hit.id;
  }
  const hint = (figure.source_hint ?? "").trim().toLowerCase();
  if (!hint) return null;
  for (const c of candidates) {
    const meta = (c.data.metadata ?? {}) as Record<string, unknown>;
    const short = String(meta.origin_book ?? "").trim().toLowerCase();
    const long = String(meta.origin_book_long ?? "").trim().toLowerCase();
    if (short && (hint === short || hint.includes(short) || short.includes(hint))) return c.id;
    if (long && (hint === long || hint.includes(long) || long.includes(hint))) return c.id;
    if (c.name.toLowerCase().includes(hint)) return c.id;
  }
  return null;
}
/** Build the Library entries for one import's figures, tagged with the
 *  import's file stem and matched against the dataset ids that same import
 *  just created (`useApp.importFiles`). */
export function buildOriginFigureEntries(
  stem: string,
  figures: OriginFigure[],
  candidates: Dataset[],
): OriginFigureEntry[] {
  const siblingIds = candidates.map((d) => d.id);
  // Key the id on the first sibling dataset id (import-unique -- dataset ids are
  // allocated monotonically) so two imports of a same-named file don't collide
  // on `fig-<stem>-<i>` and silently apply / React-reconcile the wrong entry.
  const importKey = siblingIds[0] ?? stem;
  return figures.map((figure, i) => ({
    id: `fig-${importKey}-${i}`,
    stem,
    figure,
    datasetId: resolveFigureDataset(figure, candidates),
    siblingIds,
  }));
}

/** Every layer-entry sharing `entry`'s graph window: same import (stem),
 *  same graph-window name — scoping to the import stops two imports of a
 *  same-named file from inflating the family (Origin's default window names
 *  like "Graph1" repeat across separate projects). Sorted by layer number
 *  ascending (undecoded/absent `layer` sorts as layer 1). A nameless figure
 *  or one with no same-window siblings returns just itself (family of 1) —
 *  callers treat `length < 2` as "no grouping applies". Shared by
 *  `doubleYPartner` (the 2-layer Y/Y2 idiom) and the spatial multi-panel
 *  apply (`resolveFigurePanels` below), which handles 2-or-more. */
export function figureLayerFamily(
  entry: OriginFigureEntry,
  all: OriginFigureEntry[],
): OriginFigureEntry[] {
  const name = entry.figure.name;
  if (!name) return [entry];
  const key = entry.siblingIds[0];
  return all
    .filter((e) => e.stem === entry.stem && e.figure.name === name && e.siblingIds[0] === key)
    .sort((a, b) => (a.figure.layer ?? 1) - (b.figure.layer ?? 1));
}
/** Library row label: prefer a surviving annotation (reads like a plot title
 *  or peak label) over the raw Origin graph-window name (e.g. "Graph3"). */
export function figureLabel(entry: OriginFigureEntry): string {
  const f = entry.figure;
  const base = f.annotations[0] || f.name || "Figure";
  // Multi-layer .opj windows emit one figure per layer under the same window
  // name — suffix layers ≥2 so "Graph4" and "Graph4 · layer 2" read apart.
  return (f.layer ?? 1) >= 2 ? `${base} · layer ${f.layer}` : base;
}
