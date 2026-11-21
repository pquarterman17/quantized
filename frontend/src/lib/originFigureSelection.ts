// Origin figure -> plot-state resolution: the legend placement/title, the
// decoded curve -> channel selection, the double-Y partner rule, and the
// annotation / region-shade marks an apply pins on the plot.
//
// LAZY HALF (bundle headroom slice 1, `plans/BUNDLE_HEADROOM.md`): reached
// only when an Origin figure is actually applied, so `store/useApp.ts` loads
// it on demand through `store/originApplyLibs.ts`. Do NOT statically import
// this from an eagerly-reachable module — Rollup ships a module to wherever
// ANY of its importers' chunks land, so one such import folds the whole thing
// back into the entry chunk. `src/architecture.test.ts` guards that with an
// allowlist of importers known to be lazy themselves. The eager half (Library
// labels, import-time entry construction) stays in `./originFigures`; the
// curve style and legend-template helpers are `./originCurveText` (slice 18).

import { originErrKeys, originHiddenChannels } from "./errorbars";
import { figureCurveErrorBindings } from "./originCurveErrorRoles";
import type { ErrorBinding } from "./errorRoles";
import { curveDisplayName, curveLegendLabel, originCurveSeriesStyle } from "./originCurveText";
import { figureLayerFamily, type OriginFigureEntry } from "./originFigures";
export { figureMapState, queueFigurePie, queueFigureTernary } from "./originFigureMap";
import type { StatPicks } from "./plotviewSanitize";
import { statColRefs, type StatCols } from "./statPicks";
import type {
  Annotation,
  Dataset,
  OriginCurve,
  OriginFigure,
  RegionShade,
  SeriesStyle,
} from "./types";

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
  legendSize: null;
} {
  const pos = originLegendPos(fig);
  return {
    ...(pos ? { legendPos: pos } : {}),
    legendTitle: fig.legend_title ? fig.legend_title : null,
    legendFrameXY: originLegendFrameXY(fig),
    legendSize: null,
  };
}

/** Whether a figure layer carries evidence of curves Origin draws: decoded
 *  curve bindings, or curves the importer LEFT OUT with a reason
 *  (`curve_sheet_omitted`). Such a layer must never fall back to "every
 *  channel" when none of those curves resolves -- that draws phantom data
 *  (Moke Graph2, hc2convert Graph1/4/6/7..11: 11-33 channels where Origin
 *  draws one empty curve or three). A layer with no curve evidence at all
 *  keeps the dataset-default view. */
export function figureHasCurveEvidence(
  figure: Pick<OriginFigure, "curves" | "curve_sheet_omitted" | "map" | "ternary">,
): boolean {
  // A heatmap / contour / ternary layer opens its own stage from its own
  // columns (figureMapState / queueFigureTernary): not an XY fallback case.
  if (figure.map || figure.ternary) return false;
  return (figure.curves?.length ?? 0) > 0 || (figure.curve_sheet_omitted?.length ?? 0) > 0;
}

/** The channel-selection slice of a single-layer apply's plot state. When
 *  the figure has no curve evidence (`figureHasCurveEvidence`), explicitly
 *  restore the dataset-default channel view: `setActive()` only derives that
 *  default on a genuine dataset switch, so without this a binding-less graph
 *  applied to the dataset already on Stage inherits stale channel picks.
 *  When the figure DOES record curves but none of them resolved to a column
 *  with data, the apply FAILS CLOSED: an empty plot (`yKeys: []`, which the
 *  stage words with `NO_RESOLVED_CURVES_REASON`), never every channel. */
export function figureSelectionState(
  sel: ReturnType<typeof figureChannelSelection>,
  figure?: Parameters<typeof figureHasCurveEvidence>[0],
): { xKey: number | null; yKeys: number[] | null; seriesStyles: Record<number, SeriesStyle>; seriesLabels: Record<number, string> } {
  if (sel) return { xKey: sel.xKey, yKeys: sel.yKeys, seriesStyles: sel.styles, seriesLabels: sel.labels };
  const failClosed = !!figure && figureHasCurveEvidence(figure);
  return { xKey: null, yKeys: failClosed ? [] : null, seriesStyles: {}, seriesLabels: {} };
}
/** The Stat Stage view for a figure whose every curve is an Origin
 *  histogram, box, violin or strip plot of one kind (`OriginCurve.plotType`):
 *  a histogram of the first curve's column, or one box / violin / strip per
 *  plotted column (no group column: the stage's per-plotted-channel fallback,
 *  the channels `figureChannelSelection` picks). `{}` for any other figure.
 *  A grouped / stacked column layer (`bar_layout`) opens the Stat Stage bar
 *  chart (`figureBarState`); other column and bar curves stay on the XY
 *  stage, drawn as bars by their series style (`originCurveSeriesStyle`). */
export function figureStatState(
  figure: OriginFigure,
  ds: Dataset | undefined,
): { statMode?: true; statPicks?: StatPicks } {
  const curves = figure.curves ?? [];
  const mode = curves[0]?.plotType;
  if (!ds || curves.length === 0 || curves.some((c) => c.plotType !== mode)) return {};
  const meta = (ds.data.metadata ?? {}) as Record<string, unknown>;
  const letters = Array.isArray(meta.origin_column_names) ? (meta.origin_column_names as unknown[]).map(String) : [];
  if (figure.bar_layout && mode === "column") return figureBarState(figure, curves, meta, letters, ds);
  if (mode !== "histogram" && mode !== "box" && mode !== "violin" && mode !== "strip") return {};
  const y = curves[0].y;
  const value = y === String(meta.x_column_name ?? "") ? -1 : letters.indexOf(y);
  if (value === -1 && y !== String(meta.x_column_name ?? "")) return {};
  const cols: StatCols = { group: null, group2: null, value, facet: null, color: null };
  return { statMode: true, statPicks: { mode, cols: statColRefs(ds, cols) } };
}

/** Origin's grouped / stacked / 100 % stacked column chart
 *  (`OriginFigure.bar_layout`, io/origin_project/opju_bar_kinds.py): the Stat
 *  Stage bar chart grouped by the curves' one X column, one category per row
 *  (the importer proved the X unique and evenly spaced), one series per
 *  plotted Y, on the layer's own linear Y range (`valueRange`). A text X that
 *  never became numeric is the row index (`.time`), as `isDefaultX` reads it. */
function figureBarState(
  figure: OriginFigure,
  curves: OriginCurve[],
  meta: Record<string, unknown>,
  letters: string[],
  ds: Dataset,
): { statMode?: true; statPicks?: StatPicks } {
  const xName = String(meta.x_column_name ?? "");
  const x = curves[0].x;
  // Only the sheet's own X (as the importer requires): the stage offers no
  // other numeric column as a group (`statPicks.withPickedXGroup`).
  if (xName ? x !== xName : letters.includes(x)) return {};
  const value = letters.indexOf(curves[0].y);
  if (value < 0 || curves.some((c) => c.x !== x || c.book !== curves[0].book)) return {};
  const cols: StatCols = { group: -1, group2: null, value, facet: null, color: null };
  const { bar_layout: layout, y_from: lo, y_to: hi } = figure;
  const valueRange: [number, number] | undefined = !figure.y_log && lo < hi ? [lo, hi] : undefined;
  const shape = { barStack: layout !== "grouped", barPercent: layout === "percent", valueRange };
  return { statMode: true, statPicks: { mode: "bar", ...shape, cols: statColRefs(ds, cols) } };
}

/** An Origin Polar layer (`OriginFigure.coordinates`, theta = X in degrees,
 *  r = Y) opens the XY stage's polar view; `{}` for any other figure. */
export function figurePolarState(figure: OriginFigure): { polarMode?: true } {
  return figure.coordinates === "polar" && (figure.curves ?? []).length > 0 ? { polarMode: true } : {};
}

/** `style` plus a bubble's size column / a colour-mapped scatter's colour
 *  column (`OriginCurve.sizeBy` / `colorBy`, column names of the curve's own
 *  sheet) as dataset channels. A column the dataset does not hold is left
 *  out: the curve then draws as the plain scatter it was before. */
function withMarkerColumns(
  style: SeriesStyle | null,
  curve: OriginCurve,
  letters: string[],
): SeriesStyle | null {
  const size = curve.sizeBy ? letters.indexOf(curve.sizeBy) : -1;
  const color = curve.colorBy ? letters.indexOf(curve.colorBy) : -1;
  if (size < 0 && color < 0) return style;
  const out: SeriesStyle = { ...(style ?? {}), marker: true };
  if (size >= 0) {
    out.sizeBy = size;
    delete out.markerSize;
  }
  if (color >= 0) out.colorBy = color;
  return out;
}

/** Origin's own error-bar bindings for `figure`'s curves on `ds`
 *  (`OriginCurve.yErr`): the curve's y channel -> its error channel. */
export function figureCurveErrKeys(figure: OriginFigure, ds: Dataset): Record<number, number> {
  const meta = (ds.data.metadata ?? {}) as Record<string, unknown>;
  const letters = Array.isArray(meta.origin_column_names) ? (meta.origin_column_names as unknown[]).map(String) : [];
  const out: Record<number, number> = {};
  for (const c of figure.curves ?? []) {
    const y = letters.indexOf(c.y);
    const e = c.yErr && c.book === String(meta.origin_book ?? "") ? letters.indexOf(c.yErr) : -1;
    if (y >= 0 && e >= 0 && e !== y) out[y] = e;
  }
  return out;
}

/** `base` error pairings with the figure's own (`figureCurveErrKeys`) on top:
 *  an error channel the figure binds to one curve feeds no other. */
export function withCurveErrKeys(base: Record<number, number>, own: Record<number, number>): Record<number, number> {
  const taken = new Set(Object.values(own));
  const out = Object.fromEntries(Object.entries(base).filter(([, e]) => !taken.has(e))) as Record<number, number>;
  return { ...out, ...own };
}

/** Whether a curve's X letter is the book's DEFAULT X (`.time`): the
 *  recovered X column, or — when that X is a text/category column that never
 *  became numeric (`x_column_name` empty, `.time` = the row index) — that
 *  designated-X text column itself: Origin plots a category X at its index.
 *  Without this a text-X graph lost every binding and fell back to plotting
 *  all of the book's channels. (`.time` of such a book is the 1-based
 *  category index Origin plots at -- `opj_books._build_book`, A1b.) */
export function isDefaultX(meta: Record<string, unknown>, letter: string | undefined, xLetter: string): boolean {
  if (!letter || letter === xLetter) return true;
  if (xLetter !== "") return false;
  const text = meta.origin_text_columns;
  const designations = meta.column_designations;
  return (
    !!text && typeof text === "object" && Object.prototype.hasOwnProperty.call(text, letter)
    && !!designations && typeof designations === "object"
    && (designations as Record<string, unknown>)[letter] === "X"
  );
}

/** Channel selection for a figure's decoded curves on its resolved dataset:
 *  maps each curve's Origin column letter through the dataset's
 *  `origin_column_names` metadata (value-channel letters, in channel order)
 *  onto `xKey`/`yKeys` indices. Returns null when nothing maps — the apply
 *  action then leaves the default view untouched (curves recall is partial,
 *  so "no selection" means the default view -- unless the figure has curve
 *  evidence, where the apply fails closed to an empty plot instead, see
 *  `figureSelectionState`). */
export function figureChannelSelection(
  figure: OriginFigure,
  ds: Dataset,
): {
  xKey: number | null;
  yKeys: number[];
  styles: Record<number, SeriesStyle>;
  /** Per-curve legend captions (`legend_labels`, resolved via
   *  `legendCaption` — `%(n)` -> the nth curve's display name, no caption
   *  at all when a code cannot be resolved,
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
  /** Origin's asymmetric / X error bars on this figure's curves
   *  (`originCurveErrorRoles.figureCurveErrorBindings`). */
  errors?: ErrorBinding[];
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
  const requireMaterializedData = !ds.pending;
  const yKeys: number[] = [];
  const styles: Record<number, SeriesStyle> = {};
  const labels: Record<number, string> = {};
  const legend = figure.legend_labels ?? [];
  // The nth bound curve's display name (1-based Origin numbering minus one),
  // for resolveLegendTemplate's `%(n)` substitution — same "only curves that
  // actually resolved a channel count" filter as the curveIdx loop below, so
  // a template's index lines up with the curve curveIdx is currently on.
  const curveNames: (string | undefined)[] = mine
    .filter((c) => {
      const yIdx = letters.indexOf(c.y);
      if (yIdx < 0) return false;
      const yCellsExist = ds.data.values.some((row) => yIdx < row.length);
      if (requireMaterializedData && yCellsExist && !ds.data.values.some((row) => Number.isFinite(row[yIdx]))) return false;
      if (isDefaultX(meta, c.x, xLetter)) return !requireMaterializedData || ds.data.time.some(Number.isFinite);
      const xIdx = letters.indexOf(c.x);
      if (xIdx < 0) return false;
      const xCellsExist = ds.data.values.some((row) => xIdx < row.length);
      return !requireMaterializedData || !xCellsExist || ds.data.values.some((row) => Number.isFinite(row[xIdx]));
    })
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
    const yCellsExist = ds.data.values.some((row) => yIdx < row.length);
    const yHasData = !requireMaterializedData || !yCellsExist || ds.data.values.some((row) => Number.isFinite(row[yIdx]));
    if (!yHasData) continue; // decoded-but-empty formula/result column — never produce a blank plot
    const defaultX = isDefaultX(meta, curve.x, xLetter);
    const requestedX = defaultX ? -1 : letters.indexOf(curve.x);
    if (!defaultX && requestedX < 0) continue;
    const xCellsExist = requestedX < 0 || ds.data.values.some((row) => requestedX < row.length);
    const xHasData = requestedX >= 0
      ? ds.data.values.some((row) => Number.isFinite(row[requestedX]))
      : ds.data.time.some(Number.isFinite);
    if (requireMaterializedData && xCellsExist && !xHasData) continue;
    if (!yKeys.includes(yIdx)) yKeys.push(yIdx);
    const st = withMarkerColumns(originCurveSeriesStyle(curve), curve, letters);
    if (st) styles[yIdx] = st; // line/scatter from the decoded .opju curve record
    if (!defaultX && requestedX >= 0) xKey = requestedX; // plot against a non-default x channel
    const shown = curveLegendLabel(legend[curveIdx], curveNames, ds.data.labels, yIdx, (ds.data.metadata ?? {}).origin_column_labels as unknown[] | undefined);
    if (shown !== undefined) labels[yIdx] = shown;
    curveIdx++;
  }
  if (yKeys.length === 0) return null;
  const own = figureCurveErrKeys(figure, ds);
  const errors = figureCurveErrorBindings(figure, meta); // asymmetric / X bars: whiskers only
  const hidden = new Set([...originHiddenChannels(ds.data), ...Object.values(own), ...errors.map((e) => e.channel)]);
  return {
    xKey, yKeys, styles, labels, ...(errors.length ? { errors } : {}),
    errKeys: withCurveErrKeys(originErrKeys(ds.data), own),
    hiddenChannels: [...hidden].sort((a, b) => a - b),
  };
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

/** Pull a value that fell outside [from, to] back inside the frame, keeping
 *  `inset` (axis fraction) of margin from the edge it crossed. A value already
 *  inside — or an axis with no finite range — is returned untouched, so a
 *  correctly placed mark never moves. Log axes clamp in log10 space (the same
 *  space `annotation_marks` interpolates in). Frontend-only: the decoded
 *  coordinates in the payload are never modified. */
export function clampIntoAxis(
  v: number,
  from: number | undefined,
  to: number | undefined,
  log: boolean | undefined,
  inset: { lo: number; hi: number },
): number {
  if (!Number.isFinite(v) || from == null || to == null) return v;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return v;
  const useLog = !!log && from > 0 && to > 0 && v > 0;
  const f = useLog ? Math.log10(from) : from;
  const t = useLog ? Math.log10(to) : to;
  const x = useLog ? Math.log10(v) : v;
  const lo = Math.min(f, t);
  const hi = Math.max(f, t);
  const span = hi - lo;
  // `inset.lo` is measured from the lower data edge, `inset.hi` from the upper.
  const min = lo + span * inset.lo;
  const max = hi - span * inset.hi;
  if (x >= lo && x <= hi) return v; // inside the frame (even near an edge)
  const c = x < lo ? min : max;
  return useLog ? 10 ** c : c;
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
        // A mark Origin anchored outside the frame (its text box hangs off the
        // layer edge) would render under the toolbar — pull it just inside.
        // x stays put unless it left the frame; the text is baseline-anchored
        // so the top margin is larger than the bottom one.
        x: clampIntoAxis(m.x, f.x_from, f.x_to, f.x_log, { lo: 0.02, hi: 0.02 }),
        y: clampIntoAxis(m.y, f.y_from, f.y_to, f.y_log, { lo: 0.04, hi: 0.08 }),
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
