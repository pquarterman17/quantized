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

import { originCurveSeriesStyle } from "./originFigures";
import type { Dataset, DataStruct, OriginFigure, SeriesStyle } from "./types";

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

export function buildOverlayDataset(
  figure: OriginFigure,
  datasets: Dataset[],
): DataStruct | null {
  const books = overlayBooks(figure, datasets);
  if (books.length < 2) return null;

  // Resolve each curve to (dataset, x-channel, y-channel) up front.
  interface Bound {
    ds: Dataset;
    xCh: number; // -2 = time column
    yCh: number;
    label: string;
    unit: string;
    style: SeriesStyle | null; // decoded line/scatter, per curve
    designation: string; // the source column's Origin designation (Y / Y-error / …)
  }
  const bound: Bound[] = [];
  for (const c of figure.curves ?? []) {
    const ds = books.find(
      (d) => String((d.data.metadata ?? {}).origin_book ?? "") === c.book,
    );
    if (!ds) continue;
    const meta = (ds.data.metadata ?? {}) as Record<string, unknown>;
    const yCh = channelOf(meta, c.y);
    if (yCh < 0) continue; // dropped/undecoded column — skip honestly
    const xCh = c.x ? channelOf(meta, c.x) : -2;
    const label = ds.data.labels[yCh] || c.y;
    const cd = meta.column_designations as Record<string, unknown> | undefined;
    bound.push({
      ds,
      xCh: xCh === -1 ? -2 : xCh,
      yCh,
      label: `${c.book}: ${label}`,
      unit: ds.data.units[yCh] ?? "",
      style: originCurveSeriesStyle(c),
      designation: cd ? String(cd[c.y] ?? "Y") : "Y",
    });
  }
  if (bound.length < 2) return null;

  // One x-block per participating dataset, in first-curve order.
  const blocks: Dataset[] = [];
  for (const b of bound) if (!blocks.includes(b.ds)) blocks.push(b.ds);
  // Re-validate AFTER channel resolution: if the other book's curves all
  // dropped (undecoded columns), the survivors can collapse onto a single
  // book -- that's not an overlay, so fall through to plain channel selection.
  if (blocks.length < 2) return null;
  const starts = new Map<string, number>();
  let total = 0;
  for (const d of blocks) {
    starts.set(d.id, total);
    total += d.data.time.length;
  }

  const time: number[] = new Array(total).fill(NaN);
  for (const d of blocks) {
    const s = starts.get(d.id) ?? 0;
    for (let i = 0; i < d.data.time.length; i++) time[s + i] = d.data.time[i];
  }
  const values: number[][] = Array.from({ length: total }, () =>
    new Array(bound.length).fill(NaN),
  );
  bound.forEach((b, col) => {
    const s = starts.get(b.ds.id) ?? 0;
    const n = b.ds.data.time.length;
    for (let i = 0; i < n; i++) {
      values[s + i][col] = b.ds.data.values[i]?.[b.yCh] ?? NaN;
    }
    // A curve plotted against a non-default x channel: replace this block's
    // time with that channel (all curves of one book share a block; Origin
    // layers virtually always share the X column, so last-writer-wins is
    // acceptable and recorded in provenance).
    if (b.xCh >= 0) {
      for (let i = 0; i < n; i++) time[s + i] = b.ds.data.values[i]?.[b.xCh] ?? NaN;
    }
  });

  const first = blocks[0].data.metadata ?? {};
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
      // Carry each column's source Origin designation (as synthetic per-column
      // keys), so the same error/secondary-X hiding the default view applies runs
      // on the overlay too (setActive → originHiddenChannels): an error column
      // like dSA feeds/whiskers, never a stray line, even in a cross-book figure.
      origin_column_names: bound.map((_, i) => `c${i}`),
      column_designations: Object.fromEntries(bound.map((b, i) => [`c${i}`, b.designation])),
      origin_overlay_books: blocks.map((d) =>
        String((d.data.metadata ?? {}).origin_book ?? d.name),
      ),
      x_column_name: "A",
      x_column_long: String((first as Record<string, unknown>).x_column_long ?? ""),
      x_column_unit: String((first as Record<string, unknown>).x_column_unit ?? ""),
    },
  };
}
