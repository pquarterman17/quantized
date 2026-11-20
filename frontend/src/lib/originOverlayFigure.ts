// The Origin-figure half of `lib/originOverlay.ts` (bundle headroom slice 18,
// `plans/BUNDLE_HEADROOM.md`): building a cross-book figure's overlay dataset
// and reading its stamped styles and legend captions back. Only the lazy
// Origin-apply body (`store/originApplyRun.ts`) calls these, so they moved
// here verbatim. The parent does NOT re-export them: measured, an `export *`
// kept this module in the parent's eager chunk. The shared
// segment-concatenation core stays in the parent, which the eager "Plot
// selected together" path also uses.

import {
  curveDisplayName,
  legendCaption,
  originCurveSeriesStyle,
  readableSheetCurveLabel,
} from "./originCurveText";
import { assembleOverlay, ORIGIN_OVERLAY_VERSION, type OverlayBound } from "./originOverlay";
import { framesCoincide } from "./originPanels";
import type { Dataset, DataStruct, OriginFigure, SeriesStyle } from "./types";

/** Construct regenerated overlay geometry without carrying row/column-dependent
 * state from the previous derivation. User organization and annotations are
 * safe to retain because they do not reinterpret the rebuilt data. */
export function originOverlayDataset(
  id: string,
  name: string,
  data: DataStruct,
  sourceId: string,
  refreshedById: string,
  existing?: Dataset,
): Dataset {
  const stamped = {
    ...data,
    metadata: {
      ...data.metadata,
      // `source` is the canonical graph-family id used to reuse one dataset;
      // `entry` is the specific layer whose curves currently occupy it.
      // A single-X sibling does not rebuild the family overlay, so consumers
      // must not infer its contents from family identity alone.
      origin_overlay_source: sourceId,
      origin_overlay_entry: refreshedById,
      origin_overlay_version: ORIGIN_OVERLAY_VERSION,
    },
  };
  return {
    id,
    name,
    data: stamped,
    ...(existing?.notes !== undefined ? { notes: existing.notes } : {}),
    ...(existing?.tags !== undefined ? { tags: existing.tags } : {}),
    ...(existing?.group !== undefined ? { group: existing.group } : {}),
    ...(existing?.folderId !== undefined ? { folderId: existing.folderId } : {}),
    ...(existing?.order !== undefined ? { order: existing.order } : {}),
  };
}

/** Letter -> 0-based value-channel index via origin_column_names, or -1;
 *  the designation-X letter maps to the time column (-2 sentinel). */
function channelOf(meta: Record<string, unknown>, letter: string): number {
  if (letter && letter === String(meta.x_column_name ?? "")) return -2;
  const names = Array.isArray(meta.origin_column_names)
    ? (meta.origin_column_names as unknown[]).map(String)
    : [];
  return names.indexOf(letter);
}

/** The books a figure's decoded curves resolve to among `datasets` (unique,
 *  in curve order). Only books with an importable dataset count. */
export function overlayBooks(figure: OriginFigure, datasets: Dataset[]): Dataset[] {
  const out: Dataset[] = [];
  for (const c of figure.curves ?? []) {
    const ds = datasets.find(
      (d) => String((d.data.metadata ?? {}).origin_book ?? "") === c.book,
    );
    if (ds && !out.includes(ds)) out.push(ds);
  }
  return out;
}

/** Recover the per-column line/scatter styles stamped by buildOverlayDataset
 *  into an overlay's metadata, as a channel-index → SeriesStyle map ready for
 *  the store's `seriesStyles`. Empty for a non-overlay dataset. */
export function overlayCurveStyles(data: DataStruct | null | undefined): Record<number, SeriesStyle> {
  const arr = (data?.metadata ?? {})["origin_curve_styles"];
  if (!Array.isArray(arr)) return {};
  const out: Record<number, SeriesStyle> = {};
  arr.forEach((s, i) => {
    if (s) out[i] = s as SeriesStyle;
  });
  return out;
}

/** Recover the per-column legend captions stamped by buildOverlayDataset into
 *  an overlay's metadata, as a channel-index → label map ready for the
 *  store's `seriesLabels` (fix #4). Already resolved via
 *  `legendCaption` at build time (`%(n)` -> the nth curve's display
 *  name, `\l(n)` swatch stripped) — this is just the read-back, no further
 *  substitution here. Empty for a non-overlay dataset or one whose figure had
 *  no legend_labels. */
export function overlayCurveLabels(data: DataStruct | null | undefined): Record<number, string> {
  const arr = (data?.metadata ?? {})["origin_curve_labels"];
  if (!Array.isArray(arr)) return {};
  const out: Record<number, string> = {};
  arr.forEach((s, i) => {
    if (s) out[i] = s as string;
  });
  return out;
}

/** Each of `figure`'s curves resolved to an overlay column (dataset, x and y
 *  channel, label, style, legend caption), in curve order. Curves whose
 *  letters don't map to decoded channels are skipped -- partial recall must
 *  degrade gracefully, never invent data. */
function boundCurves(figure: OriginFigure, books: Dataset[]): { bound: OverlayBound[]; errorCols: Record<number, number> } {
  // Resolve each curve to (dataset, x-channel, y-channel) up front.
  const legend = figure.legend_labels ?? [];
  // The nth entry of figure.curves' own display name (undefined where the
  // book/channel never resolved) — a pre-pass so resolveLegendTemplate's
  // `%(n)` substitution can look up ANY curve in the layer, not just the one
  // currently being bound (a legend entry is not required to reference only
  // itself). Same "book:channel" resolution the main loop below repeats to
  // build each Bound entry; kept as a light separate pass for that reason.
  const curveNames: (string | undefined)[] = (figure.curves ?? []).map((c) => {
    const ds = books.find((d) => String((d.data.metadata ?? {}).origin_book ?? "") === c.book);
    if (!ds) return undefined;
    const yCh = channelOf((ds.data.metadata ?? {}) as Record<string, unknown>, c.y);
    // Comment-first (curveDisplayName): Origin's %(n) auto text substitutes
    // the bound column's Comment when set — validated on PNR.opj Graph1's
    // cross-book layer ("700 mT"/"1.5 mT from 700mT" are Comments).
    return yCh >= 0 ? curveDisplayName(ds, c.y, yCh) : undefined;
  });
  const bound: OverlayBound[] = [];
  const errorCols: Record<number, number> = {}; // curve column -> its Origin error-bar column
  // curveIdx tracks this curve's position among ALL of figure.curves (even
  // ones skipped below for an unresolved book/channel) — the SAME "\l(n)"
  // numbering Origin's legend uses across the whole layer, not per-book.
  figure.curves?.forEach((c, curveIdx) => {
    const ds = books.find(
      (d) => String((d.data.metadata ?? {}).origin_book ?? "") === c.book,
    );
    if (!ds) return;
    const meta = (ds.data.metadata ?? {}) as Record<string, unknown>;
    const yCh = channelOf(meta, c.y);
    if (yCh < 0) return; // dropped/undecoded column — skip honestly
    const xCh = c.x ? channelOf(meta, c.x) : -2;
    // An x-LETTER present in the figure but mapping to no decoded channel
    // (channelOf -> -1) must NOT be coerced to the time column (-2): blocks are
    // keyed by (dataset, xCh), so a -2 alias would silently plot this curve
    // against an UNRELATED curve's x (contamination) or collapse two real
    // curves into one block. We can't know its true x, so drop it honestly —
    // exactly like the undecoded-y case above (never invent data).
    if (c.x && xCh === -1) return;
    const label = ds.data.labels[yCh] || c.y;
    const cd = meta.column_designations as Record<string, unknown> | undefined;
    bound.push({
      ds,
      xCh,
      yCh,
      label: `${c.book}: ${label}`,
      unit: ds.data.units[yCh] ?? "",
      style: originCurveSeriesStyle(c),
      designation: cd ? String(cd[c.y] ?? "Y") : "Y",
      legendLabel:
        curveIdx < legend.length && legend[curveIdx]
          ? legendCaption(legend[curveIdx], curveNames)
          : readableSheetCurveLabel(
              c.book,
              c.y,
              ds.data.labels[yCh] || "",
              meta,
              curveNames[(figure.curves ?? []).findIndex((p) => p.book === c.book.split("@")[0])],
            ),
    });
    // Origin's error-bar plot on this curve (OriginCurve.yErr): its column
    // rides in the curve's own block, right after it, as whiskers only.
    const eCh = c.yErr ? channelOf(meta, c.yErr) : -1;
    if (eCh >= 0 && eCh !== yCh) {
      errorCols[bound.length - 1] = bound.length;
      bound.push({
        ds, xCh, yCh: eCh, label: `${c.book}: ${ds.data.labels[eCh] || c.yErr}`,
        unit: ds.data.units[eCh] ?? "", style: null, designation: "Y-error", legendLabel: undefined,
      });
    }
  });
  return { bound, errorCols };
}

/** Build the overlay DataStruct for a figure whose curves span ≥2 books, or
 *  null when it doesn't (single-book figures use the plain channel-selection
 *  path). `y2Figure` (A8): the right-axis layer of a double-Y graph window
 *  (`overlayDoubleYPair`) -- its curves join the overlay AFTER the main
 *  layer's, and their column indices are stamped as
 *  `metadata.origin_overlay_y2` so the apply puts them on the right axis. */
export function buildOverlayDataset(
  figure: OriginFigure,
  datasets: Dataset[],
  y2Figure?: OriginFigure,
  /** A2: build even a single-X overlay, because a curve's RECORDED X differs
   *  from the X the plain path would draw it against (`recordedXConflicts`). */
  ownX = false,
): DataStruct | null {
  const main = boundCurves(figure, overlayBooks(figure, datasets));
  const right = y2Figure
    ? boundCurves(y2Figure, overlayBooks(y2Figure, datasets))
    : { bound: [] as OverlayBound[], errorCols: {} as Record<number, number> };
  const out = assembleOverlay([...main.bound, ...right.bound], figure.name || "", ownX);
  if (!out) return out;
  // Error-bar columns (#778) for BOTH layers; the right layer's indices sit
  // after the main layer's, so they shift by main.bound.length.
  const n = main.bound.length;
  const errorCols: Record<number, number> = { ...main.errorCols };
  for (const [k, v] of Object.entries(right.errorCols)) errorCols[Number(k) + n] = v + n;
  const extra: Record<string, unknown> = {};
  if (right.bound.length) extra.origin_overlay_y2 = right.bound.map((_, i) => n + i);
  if (Object.keys(errorCols).length) extra.origin_overlay_errors = errorCols;
  return Object.keys(extra).length ? { ...out, metadata: { ...out.metadata, ...extra } } : out;
}

/** The overlay columns `buildOverlayDataset` put on the right axis; [] for
 *  any other dataset. */
export function overlayY2Columns(data: DataStruct | null | undefined): number[] {
  const arr = (data?.metadata ?? {})["origin_overlay_y2"];
  return Array.isArray(arr) ? arr.filter((v): v is number => Number.isInteger(v)) : [];
}

function rangesEqual(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  const tol = 1e-6 * Math.max(1, Math.abs(aTo - aFrom));
  return Math.abs(aFrom - bFrom) <= tol && Math.abs(aTo - bTo) <= tol;
}

/** [lower, upper] when `family` (one graph window's layers) is a double-Y
 *  window, whichever datasets its layers use (`doubleYPartner` takes only a
 *  same-dataset pair), so a cross-book main layer no longer drops its right-axis layer
 *  (A8: Absorption-D3 Cys_Cu, CAM-B3Lyp). The spatial merge's geometry test
 *  (`isFrameCoincidentY2Overlay`) minus its same-dataset rule: exactly two
 *  layers, both with curves, the SAME X range, DIFFERENT Y ranges, and frames
 *  that are decoded and coincide. null otherwise. */
export function overlayDoubleYPair<T extends { figure: OriginFigure }>(family: T[]): [T, T] | null {
  if (family.length !== 2) return null;
  const [lower, upper] = [...family].sort((a, b) => (a.figure.layer ?? 1) - (b.figure.layer ?? 1));
  const [a, b] = [lower.figure, upper.figure];
  if (!(a.curves ?? []).length || !(b.curves ?? []).length) return null;
  if (!rangesEqual(a.x_from, a.x_to, b.x_from, b.x_to)) return null;
  if (rangesEqual(a.y_from, a.y_to, b.y_from, b.y_to)) return null;
  // Frames must be DECODED and coincide: two stacked panels with undecoded
  // frames keep the spatial multi-panel apply (fail closed toward it).
  if (!a.frame || !b.frame || !framesCoincide(a.frame, b.frame)) return null;
  return [lower, upper];
}

/** An overlay's Origin error-bar columns (`origin_overlay_errors`, stamped by
 *  `buildOverlayDataset`): curve column -> error column, and the error
 *  columns themselves (whiskers, never their own series). */
export function overlayErrorState(data: DataStruct | null | undefined): { errKeys: Record<number, number>; errorColumns: number[] } {
  const raw = (data?.metadata ?? {})["origin_overlay_errors"];
  const errKeys: Record<number, number> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Number.isInteger(Number(k)) && Number.isInteger(v)) errKeys[Number(k)] = v as number;
    }
  }
  return { errKeys, errorColumns: Object.values(errKeys).sort((a, b) => a - b) };
}
