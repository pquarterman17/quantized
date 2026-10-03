// The Origin-figure half of `lib/originOverlay.ts` (bundle headroom slice 18,
// `plans/BUNDLE_HEADROOM.md`): building a cross-book figure's overlay dataset
// and reading its stamped styles and legend captions back. Only the lazy
// Origin-apply body (`store/originApplyRun.ts`) calls these, so they moved
// here verbatim. The parent does NOT re-export them: measured, an `export *`
// kept this module in the parent's eager chunk. The shared
// segment-concatenation core stays in the parent, which the eager "Plot
// selected together" path also uses.

import { curveDisplayName, originCurveSeriesStyle, resolveLegendTemplate } from "./originCurveText";
import { assembleOverlay, ORIGIN_OVERLAY_VERSION, type OverlayBound } from "./originOverlay";
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
  return assembleOverlay(bound, figure.name || "");
}
