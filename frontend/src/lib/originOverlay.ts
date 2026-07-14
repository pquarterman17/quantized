// Materialize a cross-book Origin figure as one "overlay dataset" — the
// owner-approved way to restore graphs whose curves span several workbooks
// (e.g. XRD's Graph1 plotting column B of six books). The plot pipeline is
// single-dataset, so the overlay becomes a real Library dataset: one value
// column per curve, labelled "Book: Column".
//
// Layout is SEGMENT CONCATENATION, not a sorted x-union: each source book
// contributes its own x-block (order preserved), and a curve's column holds
// values only inside its book's block (NaN elsewhere). A sorted union would
// scramble non-monotonic x (hysteresis loops); segments keep every curve's
// point order intact and render correctly through the existing loop-safe
// plot machinery (sorted=0 + full-range path builders).

import { curveDisplayName, originCurveSeriesStyle, resolveLegendTemplate } from "./originFigures";
import type { Dataset, DataStruct, OriginFigure, SeriesStyle } from "./types";

/** Derived-overlay schema. Increment when construction or binding semantics
 * change so persisted workspaces cannot silently reuse older geometry. */
export const ORIGIN_OVERLAY_VERSION = 2;

/** Construct regenerated overlay geometry without carrying row/column-dependent
 * state from the previous derivation. User organization and annotations are
 * safe to retain because they do not reinterpret the rebuilt data. */
export function originOverlayDataset(
  id: string,
  name: string,
  data: DataStruct,
  sourceId: string,
  existing?: Dataset,
): Dataset {
  const stamped = {
    ...data,
    metadata: {
      ...data.metadata,
      origin_overlay_source: sourceId,
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

/** Build the overlay DataStruct for a figure whose curves span ≥2 books, or
 *  null when it doesn't (single-book figures use the plain channel-selection
 *  path). Curves whose letters don't map to decoded channels are skipped —
 *  partial recall must degrade gracefully, never invent data. */
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
 *  `resolveLegendTemplate` at build time (`%(n)` -> the nth curve's display
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

export function buildOverlayDataset(
  figure: OriginFigure,
  datasets: Dataset[],
): DataStruct | null {
  const books = overlayBooks(figure, datasets);
  if (books.length === 0) return null;

  // Resolve each curve to (dataset, x-channel, y-channel) up front.
  interface Bound {
    ds: Dataset;
    xCh: number; // -2 = time column
    yCh: number;
    label: string;
    unit: string;
    style: SeriesStyle | null; // decoded line/scatter, per curve
    designation: string; // the source column's Origin designation (Y / Y-error / …)
    legendLabel: string | undefined; // decoded legend caption (fix #4), if any
  }
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
  const bound: Bound[] = [];
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
          ? resolveLegendTemplate(legend[curveIdx], curveNames)
          : undefined,
    });
  });
  if (bound.length < 2) return null;

  // One x-block per distinct (dataset, x-channel), in first-curve order. A
  // cross-book figure gets one block per book; a MULTI-X worksheet -- curves
  // in ONE book plotted against DIFFERENT x columns (e.g. Moke's Graph3, three
  // field sweeps A/E/I) -- gets one block per x column. Either way a curve's
  // values live only inside its own block (NaN elsewhere); segment
  // concatenation (never a sorted union) keeps each loop's point order intact
  // so a non-monotonic hysteresis sweep renders correctly.
  interface Block {
    ds: Dataset;
    xCh: number; // -2 = the dataset's time column
  }
  const blockKey = (b: Bound): string => `${b.ds.id}#${b.xCh}`;
  const blocks: Block[] = [];
  const blockIndex = new Map<string, number>();
  for (const b of bound) {
    const key = blockKey(b);
    if (!blockIndex.has(key)) {
      blockIndex.set(key, blocks.length);
      blocks.push({ ds: b.ds, xCh: b.xCh });
    }
  }
  // Fewer than two distinct x-blocks is not an overlay (a single-book,
  // single-x figure) -- fall through to the plain channel-selection path.
  if (blocks.length < 2) return null;
  const starts: number[] = [];
  let total = 0;
  for (const blk of blocks) {
    starts.push(total);
    total += blk.ds.data.time.length;
  }

  // Each block's x is its own column: the designated time (xCh === -2) or a
  // value channel.
  const time: number[] = new Array(total).fill(NaN);
  blocks.forEach((blk, bi) => {
    const s = starts[bi];
    const n = blk.ds.data.time.length;
    for (let i = 0; i < n; i++) {
      time[s + i] =
        blk.xCh === -2 ? blk.ds.data.time[i] : (blk.ds.data.values[i]?.[blk.xCh] ?? NaN);
    }
  });
  const values: number[][] = Array.from({ length: total }, () =>
    new Array(bound.length).fill(NaN),
  );
  bound.forEach((b, col) => {
    const bi = blockIndex.get(blockKey(b)) ?? 0;
    const s = starts[bi];
    const n = b.ds.data.time.length;
    for (let i = 0; i < n; i++) {
      values[s + i][col] = b.ds.data.values[i]?.[b.yCh] ?? NaN;
    }
  });

  const first = blocks[0].ds.data.metadata ?? {};
  return {
    time,
    values,
    labels: bound.map((b) => b.label),
    units: bound.map((b) => b.unit),
    metadata: {
      source_format: String((first as Record<string, unknown>).source_format ?? "origin"),
      origin_overlay: true,
      origin_overlay_figure: figure.name || "",
      // Per-column line/scatter styles in column order (null where undecoded),
      // so applyOriginFigure can restore the figure's look — carried in metadata
      // so it survives the overlay-reuse path too.
      origin_curve_styles: bound.map((b) => b.style),
      // Per-column decoded legend caption (fix #4), same null-where-undecoded
      // shape as origin_curve_styles — read back via overlayCurveLabels.
      origin_curve_labels: bound.map((b) => b.legendLabel ?? null),
      // Carry each column's source Origin designation (as synthetic per-column
      // keys), so the same error/secondary-X hiding the default view applies runs
      // on the overlay too (setActive → originHiddenChannels): an error column
      // like dSA feeds/whiskers, never a stray line, even in a cross-book figure.
      origin_column_names: bound.map((_, i) => `c${i}`),
      column_designations: Object.fromEntries(bound.map((b, i) => [`c${i}`, b.designation])),
      origin_overlay_books: [
        ...new Set(
          blocks.map((blk) => String((blk.ds.data.metadata ?? {}).origin_book ?? blk.ds.name)),
        ),
      ],
      x_column_name: "A",
      x_column_long: String((first as Record<string, unknown>).x_column_long ?? ""),
      x_column_unit: String((first as Record<string, unknown>).x_column_unit ?? ""),
    },
  };
}
