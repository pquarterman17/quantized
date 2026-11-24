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
import { sanitizeBindings, type ErrorBinding } from "./errorRoles";
import { curveErrorBindings } from "./originCurveErrorRoles";
import { assembleOverlay, ORIGIN_OVERLAY_VERSION, textColumnLabels, type OverlayBound } from "./originOverlay";
import { framesCoincide } from "./originPanels";
import { textXLetter } from "./originRecordedX";
import { hasRowFilter, rowFilteredViews } from "./originRowFilter";
import type { AxisFormat, TopAxis } from "./axisFormat";
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
function boundCurves(figure: OriginFigure, books: Dataset[]): { bound: OverlayBound[]; errorCols: Record<number, number>; roles: ErrorBinding[] } {
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
  const roles: ErrorBinding[] = []; // asymmetric / X error-bar columns (originCurveErrorRoles)
  // curveIdx tracks this curve's position among ALL of figure.curves (even
  // ones skipped below for an unresolved book/channel) — the SAME "\l(n)"
  // numbering Origin's legend uses across the whole layer, not per-book.
  const bookOf = (c: { book: string }) =>
    books.find((d) => String((d.data.metadata ?? {}).origin_book ?? "") === c.book);
  // A recorded TEXT X (category positions 1..N, `textXLetter`) holds only when
  // EVERY curve of the layer sits on one with the SAME cells: across books, a
  // text-X curve beside a numeric-X one (or two books' differing text columns
  // under one letter) is not one axis, so its text curves are left out
  // (no channel -> dropped below), never drawn at positions on a guess.
  const textKey = (c: { book: string; x?: string }): string | null => {
    const d = bookOf(c);
    return d && c.x && textXLetter(figure, d) === c.x ? JSON.stringify(textColumnLabels(d.data, c.x)) : null;
  };
  const keys = (figure.curves ?? []).filter((c) => bookOf(c)).map(textKey);
  const categoryOk = keys.length > 0 && keys.every((k) => k !== null && k === keys[0]);
  const filtered = rowFilteredViews(); // B-37: one copy per (book, condition)
  figure.curves?.forEach((c, curveIdx) => {
    const book = bookOf(c);
    // A worksheet-filtered curve draws from a copy holding only the rows the
    // filter keeps; one it cannot evaluate is skipped, never drawn with all rows.
    const ds = book && c.rowFilter ? filtered(book, c.rowFilter) : book;
    if (!ds) return;
    const meta = (ds.data.metadata ?? {}) as Record<string, unknown>;
    const yCh = channelOf(meta, c.y);
    if (yCh < 0) return; // dropped/undecoded column — skip honestly
    // A recorded TEXT X (category positions 1..N, `textXLetter`) has no value channel.
    const xText = categoryOk && c.x && textXLetter(figure, ds) === c.x ? c.x : undefined;
    // B-37: a filtered curve over text categories is not proven (which categories stay?)
    if (xText && c.rowFilter) return;
    const xCh = xText ? -3 : c.x ? channelOf(meta, c.x) : -2;
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
      ...(xText ? { xText } : {}),
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
    const at = bound.length - 1; // this curve's overlay column
    // Origin's error-bar plot on this curve (OriginCurve.yErr): its column
    // rides in the curve's own block, right after it, as whiskers only. The
    // block key includes a text X (`originOverlay.blockKey`), so it is copied.
    const eCh = c.yErr ? channelOf(meta, c.yErr) : -1;
    if (eCh >= 0 && eCh !== yCh) {
      errorCols[at] = bound.length;
      bound.push({
        ds, xCh, ...(xText ? { xText } : {}), yCh: eCh, label: `${c.book}: ${ds.data.labels[eCh] || c.yErr}`,
        unit: ds.data.units[eCh] ?? "", style: null, designation: "Y-error", legendLabel: undefined,
      });
    }
    // Its asymmetric / X bars: each column rides the same block, as "Y" so no
    // designation pairing reads it as symmetric, and binds by overlay column.
    for (const e of curveErrorBindings(c, yCh, (l) => channelOf(meta, l))) {
      roles.push({ ...e, channel: bound.length, target: at });
      bound.push({
        ds, xCh, ...(xText ? { xText } : {}), yCh: e.channel, label: `${c.book}: ${ds.data.labels[e.channel] || e.channel}`,
        unit: ds.data.units[e.channel] ?? "", style: null, designation: "Y", legendLabel: undefined,
      });
    }
  });
  return { bound, errorCols, roles };
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
  /** B2: `y2Figure` is instead a TOP-X layer (`overlayTopXPair`): its curves
   *  share the main Y axis, and their X is mapped onto the main layer's X. */
  topX?: TopXMap,
): DataStruct | null {
  const main = boundCurves(figure, overlayBooks(figure, datasets));
  const rightRaw = y2Figure
    ? boundCurves(y2Figure, overlayBooks(y2Figure, datasets))
    : { bound: [] as OverlayBound[], errorCols: {} as Record<number, number>, roles: [] as ErrorBinding[] };
  const right = topX ? { ...rightRaw, bound: onMainX(rightRaw.bound, topX) } : rightRaw;
  // B-37: a row-filtered curve draws only through this overlay, so even one
  // curve on one block is built (`figureChannelSelection` leaves it out).
  const own = ownX || hasRowFilter(figure, y2Figure);
  const out = assembleOverlay([...main.bound, ...right.bound], figure.name || "", own);
  if (!out) return out;
  // Error-bar columns (#778) for BOTH layers; the right layer's indices sit
  // after the main layer's, so they shift by main.bound.length.
  const n = main.bound.length;
  const errorCols: Record<number, number> = { ...main.errorCols };
  for (const [k, v] of Object.entries(right.errorCols)) errorCols[Number(k) + n] = v + n;
  const roles = [...main.roles, ...right.roles.map((e) => ({ ...e, channel: e.channel + n, target: e.target + n }))];
  const extra: Record<string, unknown> = {};
  if (right.bound.length && !topX) extra.origin_overlay_y2 = right.bound.map((_, i) => n + i);
  if (Object.keys(errorCols).length) extra.origin_overlay_errors = errorCols;
  if (roles.length) extra.origin_overlay_error_roles = roles;
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

/** An overlay's Origin error-bar columns (`origin_overlay_errors` and
 *  `origin_overlay_error_roles`, stamped by `buildOverlayDataset`): curve
 *  column -> symmetric error column, the asymmetric / X bindings, and the
 *  error columns themselves (whiskers, never their own series). */
export function overlayErrorState(data: DataStruct | null | undefined): {
  errKeys: Record<number, number>; roles: ErrorBinding[]; errorColumns: number[];
} {
  const meta = data?.metadata ?? {};
  const raw = meta["origin_overlay_errors"];
  const errKeys: Record<number, number> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Number.isInteger(Number(k)) && Number.isInteger(v)) errKeys[Number(k)] = v as number;
    }
  }
  const roles = sanitizeBindings(meta["origin_overlay_error_roles"], data?.labels.length ?? 0) ?? [];
  const cols = new Set([...Object.values(errKeys), ...roles.map((e) => e.channel)]);
  return { errKeys, roles, errorColumns: [...cols].sort((a, b) => a - b) };
}

/** B2: where a top-X layer's own X lands on its host's X axis. Both layers
 *  fill the SAME frame (`overlayTopXPair`), so on linear axes an upper-layer
 *  value `u` sits where the host's axis reads `scale * u + shift`. */
export interface TopXMap {
  scale: number;
  shift: number;
}

/** [host, top] when `family` (one graph window's layers) is a top-X window:
 *  the mirror of `overlayDoubleYPair` -- exactly two layers, both with
 *  curves, whose decoded frames coincide, with the SAME Y range and Y scale
 *  but a DIFFERENT X range (SerialCore Bqqbar Graph2: mu on the bottom, 1/mu
 *  on top). Both X axes must be linear with a non-zero span, so the upper
 *  layer's X maps onto the host's by one exact linear map (`topXMap`); a log
 *  X would need a different map, so it fails closed to the panel apply. */
export function overlayTopXPair<T extends { figure: OriginFigure }>(family: T[]): [T, T] | null {
  if (family.length !== 2) return null;
  const [lower, upper] = [...family].sort((a, b) => (a.figure.layer ?? 1) - (b.figure.layer ?? 1));
  const [a, b] = [lower.figure, upper.figure];
  if (!(a.curves ?? []).length || !(b.curves ?? []).length) return null;
  if (a.x_log || b.x_log || a.y_log !== b.y_log) return null;
  if (!(a.x_to !== a.x_from && b.x_to !== b.x_from)) return null;
  if (!rangesEqual(a.y_from, a.y_to, b.y_from, b.y_to)) return null;
  if (rangesEqual(a.x_from, a.x_to, b.x_from, b.x_to)) return null;
  if (!a.frame || !b.frame || !framesCoincide(a.frame, b.frame)) return null;
  return [lower, upper];
}

/** The linear map from `top`'s X onto `host`'s X: both axes span the same
 *  frame width, so their ranges' ends line up. */
export function topXMap(host: OriginFigure, top: OriginFigure): TopXMap {
  const scale = (host.x_to - host.x_from) / (top.x_to - top.x_from);
  return { scale, shift: host.x_from - scale * top.x_from };
}

/** The top axis that labels the host's X in `top`'s own units: the inverse
 *  of `topXMap`, as the Axis dialog's linear top axis (`lib/axisTop.ts`). */
export function topXAxis(host: OriginFigure, top: OriginFigure): TopAxis {
  const { scale, shift } = topXMap(host, top);
  return { kind: "linear", factor: 1 / scale, shift: -shift / scale, ...(top.x_title ? { title: top.x_title } : {}) };
}

/** The `xFmt` patch that gives the plot Origin's top X axis `top` (B2), or
 *  takes a previous one away: a recovered graph is a whole-view command, so
 *  an earlier graph's top axis never leaks in. `{}` when nothing changes. */
export function topAxisPatch(fmt: AxisFormat, top?: TopAxis): { xFmt?: AxisFormat } {
  if (!top && !fmt.top) return {};
  const { top: _old, ...rest } = fmt;
  return { xFmt: top ? { ...rest, top } : rest };
}

/** `bound` re-pointed at copies of their datasets whose X column is mapped by
 *  `m` (onto the host's X); one copy per (dataset, X column), so curves that
 *  shared an X block still share one. Y values are untouched. */
function onMainX(bound: OverlayBound[], m: TopXMap): OverlayBound[] {
  const copies = new Map<string, Dataset>();
  return bound.map((b) => {
    const key = `${b.ds.id}#${b.xCh}`;
    let ds = copies.get(key);
    if (!ds) {
      const d = b.ds.data;
      const xs = b.xCh === -2 ? d.time : d.values.map((row) => row?.[b.xCh] ?? NaN);
      ds = { ...b.ds, id: `${b.ds.id}#topx${b.xCh}`, data: { ...d, time: Array.from(xs, (x) => m.scale * x + m.shift) } };
      copies.set(key, ds);
    }
    return { ...b, ds, xCh: -2 };
  });
}
