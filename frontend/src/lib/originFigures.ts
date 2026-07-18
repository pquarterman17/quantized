// Resolve Origin figure snapshots (`figures.extract_figures`, plan item 18)
// against the datasets created by the same import, and describe how to
// display one in the Library. Pure/store-agnostic so the matching heuristic
// is unit-testable without mounting the store — `store/useApp.ts` owns the
// actual apply-to-plot-state action.

import { originErrKeys, originHiddenChannels } from "./errorbars";
import type { SpatialPanel } from "./multipanel";
import { computePanelLayout, framesCoincide, pageNormalizedRect } from "./originPanels";
import { pageValidRects } from "./panelLayout";
import type {
  Annotation,
  Dataset,
  MarkerShape,
  OriginCurve,
  OriginFigure,
  RegionShade,
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

/** Fraction of `v` along [lo, hi], in log10 space on a log axis (the same
 *  model the backend used to decode the position — see annotation_marks.py).
 *  NaN when the range is degenerate/invalid, so callers can bail. */
function axisFraction(v: number, lo: number, hi: number, log: boolean): number {
  if (log && lo > 0 && hi > 0 && v > 0) {
    const [a, b] = [Math.log10(lo), Math.log10(hi)];
    return b === a ? NaN : (Math.log10(v) - a) / (b - a);
  }
  return hi === lo ? NaN : (v - lo) / (hi - lo);
}

/** Map a figure's decoded Origin legend-box corner (data coords, box
 *  top-left) to the nearest legend corner preset, or null when no position
 *  decoded / the figure's range is degenerate. The store's `legendPos`
 *  presets are the four corners, so nearest-quadrant is the faithful apply. */
export function originLegendPos(
  fig: Pick<OriginFigure, "legend_pos" | "x_from" | "x_to" | "x_log" | "y_from" | "y_to" | "y_log">,
): "ne" | "nw" | "se" | "sw" | null {
  const p = fig.legend_pos;
  if (!p) return null;
  const fx = axisFraction(p.x, fig.x_from, fig.x_to, fig.x_log);
  const fy = axisFraction(p.y, fig.y_from, fig.y_to, fig.y_log); // 0 = bottom
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
  return `${fy >= 0.5 ? "n" : "s"}${fx >= 0.5 ? "e" : "w"}` as "ne" | "nw" | "se" | "sw";
}

/** Origin's decoded legend-box TOP-LEFT as a fraction of the plot FRAME
 *  (decode #52) — the faithful FRAME-anchored placement Origin actually draws,
 *  which corner-snap (`originLegendPos`) loses. Returns `[fx, fy]` with fx
 *  rightward from the left edge and fy DOWNWARD from the TOP edge (see
 *  `PlotView.legendFrameXY`). This is the exact inverse of the backend decode:
 *  `legend_pos` came from `frac_to_data(fracs, axes)` (annotation_marks.py), so
 *  `axisFraction` recovers the original stored frame fraction — `fx` directly,
 *  and `fy = 1 - axisFraction_y` because `axisFraction` measures UP from the
 *  bottom while the stored fraction (and our convention) measures DOWN from the
 *  top. Returns null when no position decoded, the range is degenerate, OR the
 *  box top-left lands OUTSIDE the frame ([0, 1]²): an out-of-frame decode is
 *  left to the corner-snap `legendPos` fallback rather than clamp-guessed. */
export function originLegendFrameXY(
  fig: Parameters<typeof originLegendPos>[0],
): [number, number] | null {
  const p = fig.legend_pos;
  if (!p) return null;
  const fx = axisFraction(p.x, fig.x_from, fig.x_to, fig.x_log);
  const fyUp = axisFraction(p.y, fig.y_from, fig.y_to, fig.y_log); // 0 = bottom
  if (!Number.isFinite(fx) || !Number.isFinite(fyUp)) return null;
  const fy = 1 - fyUp; // 0 = top (box top-left, matches the stored fraction)
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null; // out of frame → corner-snap
  return [fx, fy];
}

/** The legend state `applyOriginFigure` pins for a figure (decode #52): the
 *  decoded legend-box corner preset (only when the position decoded — never
 *  guessed), the decoded legend title header, AND the faithful FRAME-anchored
 *  box position. `legendTitle` and `legendFrameXY` are ALWAYS present (null
 *  when absent/untrustworthy) so re-applying / switching figures clears a
 *  previous figure's stale title and stale anchor. Spread into the apply
 *  `set({...})` in place of the bare `legendPos` conditional — one call site
 *  per apply branch, so the coupled legend fields never drift apart. */
export function originLegendState(
  fig: Parameters<typeof originLegendPos>[0] & Pick<OriginFigure, "legend_title">,
): {
  legendPos?: "ne" | "nw" | "se" | "sw";
  legendTitle: string | null;
  legendFrameXY: [number, number] | null;
} {
  const pos = originLegendPos(fig);
  return {
    ...(pos ? { legendPos: pos } : {}),
    legendTitle: fig.legend_title ? fig.legend_title : null,
    legendFrameXY: originLegendFrameXY(fig),
  };
}

/** The channel-selection slice of a single-layer apply's plot state — the
 *  `xKey`/`yKeys`/style/label fields when `figureChannelSelection` resolved a
 *  selection, or `{}` (leave the default view) when it didn't. Extracted from
 *  `applyOriginFigure`'s single-layer branch so the store stays under its
 *  size ratchet; pure and independently testable. */
export function figureSelectionState(
  sel: ReturnType<typeof figureChannelSelection>,
): { xKey?: number | null; yKeys?: number[]; seriesStyles?: Record<number, SeriesStyle>; seriesLabels?: Record<number, string> } {
  return sel
    ? { xKey: sel.xKey, yKeys: sel.yKeys, seriesStyles: sel.styles, seriesLabels: sel.labels }
    : {};
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

/** Channel selection for a figure's decoded curves on its resolved dataset:
 *  maps each curve's Origin column letter through the dataset's
 *  `origin_column_names` metadata (value-channel letters, in channel order)
 *  onto `xKey`/`yKeys` indices. Returns null when nothing maps — the apply
 *  action then leaves the default view untouched (curves recall is partial,
 *  so "no selection" must stay graceful, never an empty plot). */
export function figureChannelSelection(
  figure: OriginFigure,
  ds: Dataset,
): {
  xKey: number | null;
  yKeys: number[];
  styles: Record<number, SeriesStyle>;
  /** Per-curve legend captions (`legend_labels`, resolved via
   *  `resolveLegendTemplate` — `%(n)` -> the nth curve's display name,
   *  `\l(n)` swatch stripped), mapped onto the bound channel that curve
   *  plots — see the loop below for the mapping rule. Ready for the store's
   *  `seriesLabels`. */
  labels: Record<number, string>;
  /** This book's Origin Y-error pairings (`errorbars.originErrKeys`) — a
   *  value channel -> the channel holding its ± error. Dataset-level (every
   *  curve on this book shares the same worksheet column designations), so
   *  it's independent of which curves this figure actually binds. Threaded
   *  through so a spatial multi-panel apply can draw error bars instead of a
   *  bare series for a designated error column (fix: the multi-panel path
   *  never applied error pairing, so a "Y-error" column rendered as its own
   *  spurious series — see `resolveFigurePanels`). */
  errKeys: Record<number, number>;
  /** This book's Origin-hidden channels (`errorbars.originHiddenChannels`) —
   *  paired error / secondary-X columns Origin itself never draws as their
   *  own curve. Same dataset-level scope as `errKeys`. */
  hiddenChannels: number[];
} | null {
  const meta = (ds.data.metadata ?? {}) as Record<string, unknown>;
  const book = String(meta.origin_book ?? "");
  const letters = Array.isArray(meta.origin_column_names)
    ? (meta.origin_column_names as unknown[]).map(String)
    : null;
  if (!letters) return null;
  const mine: OriginCurve[] = (figure.curves ?? []).filter((c) => c.book === book);
  if (mine.length === 0) return null;
  const xLetter = String(meta.x_column_name ?? "");
  const yKeys: number[] = [];
  const styles: Record<number, SeriesStyle> = {};
  const labels: Record<number, string> = {};
  const legend = figure.legend_labels ?? [];
  // The nth bound curve's display name (1-based Origin numbering minus one),
  // for resolveLegendTemplate's `%(n)` substitution — same "only curves that
  // actually resolved a channel count" filter as the curveIdx loop below, so
  // a template's index lines up with the curve curveIdx is currently on.
  const curveNames: (string | undefined)[] = mine
    .filter((c) => letters.indexOf(c.y) >= 0)
    .map((c) => curveDisplayName(ds, c.y, letters.indexOf(c.y)));
  let xKey: number | null = null;
  // legend_labels is a dense 1-based list, one entry per curve in the SAME
  // order Origin's "\l(n)" legend numbering plots them — curveIdx tracks that
  // position among THIS book's bound curves. A shorter (or empty) legend list
  // is count-compatible only up to its own length: the matching prefix of
  // curves gets a label, the rest keep their default — never guessed, never
  // a crash on a mismatched count.
  let curveIdx = 0;
  for (const curve of mine) {
    const yIdx = letters.indexOf(curve.y);
    if (yIdx < 0) continue; // e.g. a text/dropped column — skip, never guess
    if (!yKeys.includes(yIdx)) yKeys.push(yIdx);
    const st = originCurveSeriesStyle(curve);
    if (st) styles[yIdx] = st; // line/scatter from the decoded .opju curve record
    if (curve.x && curve.x !== xLetter) {
      const xIdx = letters.indexOf(curve.x);
      if (xIdx >= 0) xKey = xIdx; // plot against a non-default x channel
    }
    if (curveIdx < legend.length && legend[curveIdx]) {
      labels[yIdx] = resolveLegendTemplate(legend[curveIdx], curveNames);
    }
    curveIdx++;
  }
  if (yKeys.length === 0) return null;
  return { xKey, yKeys, styles, labels, errKeys: originErrKeys(ds.data), hiddenChannels: originHiddenChannels(ds.data) };
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

/** The other layer's entry when `entry` is one half of a genuine Origin
 *  "double-Y" pair: EXACTLY 2 layer-entries share the window (rules out
 *  >2-layer composite/panel windows, which reuse the same multi-layer
 *  mechanism for a structurally different layout — see `figures.py`'s
 *  module docstring), both already resolved to the SAME dataset, and both
 *  carrying at least one decoded curve (partial recall must degrade, never
 *  guess). When all of that holds, `useApp.applyOriginFigure` can offer the
 *  combined view — layer-1 curves on y, layer-2 curves on y2 — instead of
 *  just the clicked layer's own curves. Returns null for everything else:
 *  single-layer figures, cross-book pairs, missing curve recall, or a
 *  ≥3-layer family (a spatial multi-panel candidate instead — see
 *  `resolveFigurePanels`). */
export function doubleYPartner(
  entry: OriginFigureEntry,
  all: OriginFigureEntry[],
): OriginFigureEntry | null {
  const family = figureLayerFamily(entry, all);
  if (family.length !== 2) return null;
  const partner = family.find((e) => e.id !== entry.id);
  if (!partner) return null;
  if (!entry.datasetId || !partner.datasetId) return null;
  if (entry.datasetId !== partner.datasetId) return null;
  if ((entry.figure.curves ?? []).length === 0) return null;
  if ((partner.figure.curves ?? []).length === 0) return null;
  return partner;
}

/** Per-layer dataset + channel selection + fixed axis state for a spatial
 *  multi-panel apply (decode-plan #36), WITHOUT grid placement — pair the
 *  result with `originPanels.computePanelLayout` over the same family's
 *  `figure.frame` quads to get each entry's `row`/`col`. One entry per
 *  `family` member, in the SAME order. All-or-nothing: returns `null` when
 *  ANY layer fails to resolve (no dataset, or `figureChannelSelection`
 *  finds nothing to plot) — a partial grid would silently drop a panel, so
 *  the caller falls back to the single-layer apply instead. */
export function resolveFigurePanels(
  family: OriginFigureEntry[],
  datasets: Dataset[],
): Omit<SpatialPanel, "row" | "col">[] | null {
  const out: Omit<SpatialPanel, "row" | "col">[] = [];
  for (const entry of family) {
    if (!entry.datasetId) return null;
    const ds = datasets.find((d) => d.id === entry.datasetId);
    if (!ds) return null;
    const sel = figureChannelSelection(entry.figure, ds);
    if (!sel) return null;
    const fig = entry.figure;
    const legend = originLegendState(fig);
    out.push({
      sourceFigureIds: [entry.id],
      datasetId: entry.datasetId,
      xKey: sel.xKey,
      yKeys: sel.yKeys,
      xLim: [fig.x_from, fig.x_to],
      yLim: [fig.y_from, fig.y_to],
      xLog: fig.x_log,
      yLog: fig.y_log,
      // Item B (decode-plan #36 residual, PNR.opj Graph11): distinguish an
      // EXPLICITLY blank decoded x_title ("" — the owner hand-deleted a
      // redundant per-panel label in Origin) from an UNDECODED one
      // (undefined — the field never resolved at all). `null` tells
      // buildOpts to force blank rather than fall back to a synthesized
      // "channel (unit)" label; undefined still auto-derives, unchanged.
      // yAxisLabel is untouched — item B keeps y axes "as-is".
      xAxisLabel: fig.x_title === undefined ? undefined : fig.x_title || null,
      yAxisLabel: fig.y_title || undefined,
      seriesStyles: sel.styles,
      seriesLabels: sel.labels,
      ...(legend.legendTitle ? { legendTitle: legend.legendTitle } : {}),
      ...(legend.legendFrameXY ? { legendFrameXY: legend.legendFrameXY } : {}),
      errKeys: sel.errKeys,
      hiddenChannels: sel.hiddenChannels,
      xStep: fig.x_step ?? null,
      yStep: fig.y_step ?? null,
      // Each panel's OWN layer's marks, in that layer's own data coords —
      // annotation_marks are already recorded per-layer, so no coordinate
      // transform is needed (fix #5: multi-panel figures used to drop them).
      annotations: originFigureAnnotations([fig], entry.id),
    });
  }
  return out;
}

/** A relative-tolerance range-equality check (both endpoints) — used to tell
 *  a shared x-axis (double-Y) from a distinct one, and a distinct y-range
 *  from a coincidentally-identical one. Tolerance scales off the range's own
 *  span so it stays meaningful whether the axis reads in nm or in Q (nm⁻¹). */
function rangesEqual(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  const tol = 1e-6 * Math.max(1, Math.abs(aTo - aFrom));
  return Math.abs(aFrom - bFrom) <= tol && Math.abs(aTo - bTo) <= tol;
}

/** True when `candidate` looks like a genuine Origin double-Y overlay of
 *  `host` — the SAME idiom `doubleYPartner` detects for an exactly-2-layer
 *  graph window, occurring instead as one pair INSIDE a ≥2-layer spatial
 *  multi-panel family (decode-plan #36 residual — the PNR/S7/Book33 repro:
 *  a 3-layer graph rendered as a bogus 1x3 ordinal stack because two of its
 *  layers decode BYTE-IDENTICAL frame quads, which `computePanelLayout`'s
 *  own "frames overlap rather than tile the page" guard read as an
 *  untrustworthy geometry decode for the WHOLE figure). All of the
 *  following must hold, so a false positive never merges two genuinely
 *  separate panels that happen to share a page rectangle:
 *   - both layers' decoded `frame` quads occupy the same page rectangle
 *     (`originPanels.framesCoincide` — near-total MUTUAL overlap, distinct
 *     from the partial/one-sided overlap that still means "untrusted
 *     geometry");
 *   - both resolved to the SAME dataset and both carry at least one curve
 *     (`doubleYPartner`'s own checks — a genuine double-Y always shares a
 *     book);
 *   - their Y ranges are genuinely DIFFERENT (an overlay reads a different
 *     scale than its host; two real panels that happen to decode with
 *     identical frames but the SAME y-range are not a double-Y pair); and
 *   - their X ranges MATCH (an overlay shares its host's x axis; two
 *     independent panels do not). */
function isFrameCoincidentY2Overlay(host: OriginFigureEntry, candidate: OriginFigureEntry): boolean {
  const hf = host.figure;
  const cf = candidate.figure;
  if (!hf.frame || !cf.frame) return false;
  if (!framesCoincide(hf.frame, cf.frame)) return false;
  if (!host.datasetId || !candidate.datasetId || host.datasetId !== candidate.datasetId) return false;
  if ((hf.curves ?? []).length === 0 || (cf.curves ?? []).length === 0) return false;
  if (rangesEqual(hf.y_from, hf.y_to, cf.y_from, cf.y_to)) return false; // must DIFFER
  return rangesEqual(hf.x_from, hf.x_to, cf.x_from, cf.x_to); // must MATCH
}

/** One detected frame-coincident double-Y pair within a spatial family, as
 *  indices into that same `family` array. `hostIndex` always names the
 *  LOWER layer number (mirrors `applyOriginFigure`'s 2-layer doubleY
 *  convention: axis state comes from the lower layer). */
export interface SpatialY2Pair {
  hostIndex: number;
  y2Index: number;
}

/** Detect every frame-coincident double-Y pair within a ≥2-layer spatial
 *  family (`isFrameCoincidentY2Overlay`, above). Greedy, family order (a
 *  triple-overlay isn't a real Origin shape, so each layer pairs into AT
 *  MOST one merge); members that don't pair are simply absent from the
 *  result — callers treat every family index not named here as its own,
 *  ordinary spatial panel. */
export function figureFrameY2Pairs(family: OriginFigureEntry[]): SpatialY2Pair[] {
  const used = new Set<number>();
  const pairs: SpatialY2Pair[] = [];
  for (let i = 0; i < family.length; i++) {
    if (used.has(i)) continue;
    for (let j = i + 1; j < family.length; j++) {
      if (used.has(j)) continue;
      if (!isFrameCoincidentY2Overlay(family[i], family[j])) continue;
      const iLayer = family[i].figure.layer ?? 1;
      const jLayer = family[j].figure.layer ?? 1;
      const [hostIndex, y2Index] = iLayer <= jLayer ? [i, j] : [j, i];
      pairs.push({ hostIndex, y2Index });
      used.add(i);
      used.add(j);
      break;
    }
  }
  return pairs;
}

/** Combine a resolved host panel with its frame-coincident y2 overlay panel
 *  into ONE panel: the host's own selection stays primary; the y2 panel's
 *  channels/range/log/step move to the secondary axis, mirroring
 *  `applyOriginFigure`'s 2-layer double-Y apply (`yKeys` becomes the union
 *  so the y2 channels still render; `y2Keys` tags which of them are
 *  secondary). The y2 side's own annotation marks — built untagged by
 *  `resolveFigurePanels` (a lone panel has no secondary axis to tag onto) —
 *  are re-tagged `axis: 1` here. `y2AxisLabel` prefers the y2 layer's
 *  decoded `y2_title` (Origin's own secondary-axis title text — "decoded
 *  but not yet wired" per `types.ts`; this is that wiring) over its
 *  `y_title` (the field the existing 2-layer apply reads, which is often
 *  blank on a real y2 layer — the PNR/S7/Book33 repro's layer 3 is exactly
 *  this: `y_title: ""`, `y2_title: "Magnetic SLD …"` — so preferring
 *  `y2_title` costs nothing when it's unset). */
function mergePanelWithY2(
  host: Omit<SpatialPanel, "row" | "col">,
  y2: Omit<SpatialPanel, "row" | "col">,
  y2Figure: OriginFigure,
): Omit<SpatialPanel, "row" | "col"> {
  const legendTitle = host.legendTitle ?? y2.legendTitle;
  const legendFrameXY = host.legendFrameXY ?? y2.legendFrameXY;
  return {
    ...host,
    sourceFigureIds: [...(host.sourceFigureIds ?? []), ...(y2.sourceFigureIds ?? [])],
    yKeys: [...host.yKeys, ...y2.yKeys.filter((k) => !host.yKeys.includes(k))],
    seriesStyles: { ...host.seriesStyles, ...y2.seriesStyles },
    seriesLabels: { ...host.seriesLabels, ...y2.seriesLabels },
    ...(legendTitle ? { legendTitle } : {}),
    ...(legendFrameXY ? { legendFrameXY } : {}),
    y2Keys: y2.yKeys,
    y2Lim: y2.yLim,
    y2Log: y2.yLog,
    y2Step: y2.yStep,
    y2AxisLabel: y2Figure.y2_title || y2Figure.y_title || "",
    annotations: [
      ...(host.annotations ?? []),
      ...(y2.annotations ?? []).map((a) => ({ ...a, axis: 1 as const })),
    ],
  };
}

/** Full spatial multi-panel resolution for `applyOriginFigure` (decode-plan
 *  #36, residual fix — PNR/S7/Book33 repro): resolves every family member
 *  (`resolveFigurePanels`, all-or-nothing — unchanged), then collapses any
 *  frame-coincident double-Y pair (`figureFrameY2Pairs`) into ONE merged
 *  panel (`mergePanelWithY2`) BEFORE handing frames to
 *  `originPanels.computePanelLayout` — so a y2 overlay's frame never even
 *  reaches the clusterer as a second cell (the bug: two layers occupying the
 *  SAME page rectangle tripped `computePanelLayout`'s own "frames overlap
 *  rather than tile the page" bail-out for the WHOLE figure, collapsing a
 *  real 2-panel layout to a 1xN ordinal stack). `computePanelLayout` remains
 *  a strict tiled-grid classifier; genuine overlap among the remaining
 *  frames is accepted only through independently validated page rectangles.
 *  Returns
 *  `null` when `resolveFigurePanels` does. `layout` distinguishes trusted
 *  tiled geometry, trusted full-page overlap/inset geometry, and the ordinal
 *  fail-closed fallback; `spatial` retains the legacy tiled-only signal. */
export function resolveSpatialPanels(
  family: OriginFigureEntry[],
  datasets: Dataset[],
): { panels: SpatialPanel[]; spatial: boolean; layout: "tiled" | "page" | "ordinal" } | null {
  const resolved = resolveFigurePanels(family, datasets);
  if (!resolved) return null;
  const pairs = figureFrameY2Pairs(family);
  const y2ByHost = new Map(pairs.map((p) => [p.hostIndex, p.y2Index]));
  const consumed = new Set(pairs.map((p) => p.y2Index));
  const reducedIndices = family.map((_, i) => i).filter((i) => !consumed.has(i));
  const reducedPanels = reducedIndices.map((i) => {
    const y2Index = y2ByHost.get(i);
    return y2Index == null
      ? resolved[i]
      : mergePanelWithY2(resolved[i], resolved[y2Index], family[y2Index].figure);
  });
  const page = family[0].figure.page ?? null;
  const layout = computePanelLayout(
    reducedIndices.map((i) => family[i].figure.frame ?? null),
    page,
  );
  // The full-PAGE aspect + per-panel page-normalized rect for the "page" fit
  // (#54 Stage 2) — distinct from `frameRect`/`layoutAspect`, which discard the
  // page's margins by normalizing to the frames' bounding box (PR #47).
  const pageAspect = page && page.width > 0 && page.height > 0 ? page.width / page.height : undefined;
  const panels: SpatialPanel[] = reducedPanels.map((p, pos) => {
    const pageRect = pageNormalizedRect(family[reducedIndices[pos]]?.figure.frame, page);
    return {
      ...p,
      row: layout.placements[pos]?.row ?? pos,
      col: layout.placements[pos]?.col ?? 0,
      frameRect: layout.placements[pos]?.rect,
      layoutAspect: layout.aspectRatio,
      ...(pageRect ? { pageRect } : {}),
      ...(pageAspect != null ? { pageAspect } : {}),
    };
  });
  // Overlap is invalid for the tiled-frame clusterer but valid (and required)
  // for Origin insets/free-positioned layers. If every layer has a trusted
  // full-page rectangle, preserve that composition in page mode instead of
  // mislabelling it as undecoded and flattening it to an ordinal stack.
  const layoutKind = layout.spatial
    ? "tiled"
    : pageAspect != null && pageValidRects(panels) != null
      ? "page"
      : "ordinal";
  return { panels, spatial: layout.spatial, layout: layoutKind };
}

/** The store `annotations` an applied figure pins on the plot: every decoded
 *  positioned text mark (`annotation_marks`, data coords) of the given
 *  figure layer(s), mapped to the plot Annotation shape with ids generated
 *  from `key` (the figure entry id, so re-applying regenerates the same
 *  ids). `applyOriginFigure` REPLACES the store's annotations with this —
 *  never accumulates — so switching or re-applying figures can't stack
 *  stale marks. Figures without marks yield [], which clears the plot. */
export function originFigureAnnotations(
  figures: OriginFigure[],
  key: string,
  /** Per-figure Y-scale tag (parallel to `figures`), for the double-Y apply:
   *  `axes[i] === 1` routes figures[i]'s marks to the plot's y2 scale (see
   *  `Annotation.axis` / `uplotOverlays.annotationPlugin`). Omitted/undefined
   *  entries stay on the primary axis — the single-layer/spatial-panel apply
   *  never passes this, so their marks are always untagged (primary). */
  axes?: (0 | 1)[],
): Annotation[] {
  const out: Annotation[] = [];
  figures.forEach((f, fi) => {
    const axisTag = axes?.[fi];
    (f.annotation_marks ?? []).forEach((m, mi) => {
      out.push({
        id: `figann-${key}-${fi}-${mi}`,
        x: m.x,
        y: m.y,
        text: m.text,
        ...(axisTag === 1 ? { axis: 1 as const } : {}),
      });
    });
  });
  return out;
}

/** The store `regionShades` an applied figure pins on the plot: every decoded
 *  `Rect*` region band (`region_shades`, data coords — decode-plan #41) of
 *  the given figure layer(s), mapped to the plot RegionShade shape with ids
 *  generated from `key` (the figure entry id). Mirrors
 *  `originFigureAnnotations` exactly: `applyOriginFigure` REPLACES the
 *  store's shades with this — figures without shades yield [], clearing the
 *  plot. A shade whose fill never decoded, or with a non-finite extent, is
 *  skipped (never guessed). */
export function originRegionShades(
  figures: OriginFigure[],
  key: string,
  /** Per-figure Y-scale tag (parallel to `figures`), for the double-Y apply —
   *  same convention as `originFigureAnnotations`. */
  axes?: (0 | 1)[],
): RegionShade[] {
  const out: RegionShade[] = [];
  figures.forEach((f, fi) => {
    const axisTag = axes?.[fi];
    (f.region_shades ?? []).forEach((s, si) => {
      if (!s.fill || ![s.x1, s.x2, s.y1, s.y2].every(Number.isFinite)) return;
      out.push({
        id: `figshade-${key}-${fi}-${si}`,
        x1: s.x1,
        x2: s.x2,
        y1: s.y1,
        y2: s.y2,
        fill: s.fill,
        ...(axisTag === 1 ? { axis: 1 as const } : {}),
      });
    });
  });
  return out;
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
