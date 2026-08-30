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
// labels, import-time entry construction, legend templates) stays in
// `./originFigures`.

import { originErrKeys, originHiddenChannels } from "./errorbars";
import {
  curveDisplayName,
  figureLayerFamily,
  originCurveSeriesStyle,
  resolveLegendTemplate,
  type OriginFigureEntry,
} from "./originFigures";
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
