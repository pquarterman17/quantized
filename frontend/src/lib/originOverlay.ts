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
//
// PLOT_WORKFLOW_PLAN #3: the segment-concatenation core (`assembleOverlay`)
// is shared with `buildSelectionOverlay` below, which generalizes this
// mechanism beyond Origin figure apply to an arbitrary Library multi-select
// — same NaN-filled-block geometry, one curve per source dataset instead of
// per decoded Origin curve.
//
// Bundle headroom slice 18: the Origin-figure half (`buildOverlayDataset`,
// `originOverlayDataset`, `overlayBooks` and the style/label read-backs) is
// `lib/originOverlayFigure.ts`. Only the lazy apply body calls it. It is NOT
// re-exported from here: an `export *` kept it in this module's eager chunk.

import { primaryChannel } from "./plotdata";
import type { Dataset, DataStruct, SeriesStyle } from "./types";

/** Derived-overlay schema. Increment when construction or binding semantics
 * change so persisted workspaces cannot silently reuse older geometry. */
export const ORIGIN_OVERLAY_VERSION = 2;

/** One resolved overlay curve: which dataset it comes from, its (x, y)
 *  channel binding, and the display/style metadata `assembleOverlay` stamps
 *  into the merged DataStruct. Shared shape for both overlay builders below
 *  — `buildOverlayDataset` resolves these from an Origin figure's curves;
 *  `buildSelectionOverlay` resolves one per selected dataset. */
export interface OverlayBound {
  ds: Dataset;
  xCh: number; // -2 = time column
  yCh: number;
  label: string;
  unit: string;
  style: SeriesStyle | null; // decoded line/scatter, per curve (null = default)
  designation: string; // the source column's Origin designation (Y / Y-error / …)
  legendLabel: string | undefined; // decoded legend caption (fix #4), if any
}

/** Segment-concatenate resolved overlay curves into one DataStruct — the
 *  shared core of `buildOverlayDataset` (Origin figure apply) and
 *  `buildSelectionOverlay` (PLOT_WORKFLOW #3 arbitrary Library selection).
 *  One x-block per distinct (dataset, x-channel), in first-curve order: a
 *  cross-book Origin figure gets one block per book; a MULTI-X worksheet --
 *  curves in ONE book plotted against DIFFERENT x columns (e.g. Moke's
 *  Graph3, three field sweeps A/E/I) -- gets one block per x column; a
 *  Library multi-select gets one block per selected dataset. Either way a
 *  curve's values live only inside its own block (NaN elsewhere); segment
 *  concatenation (never a sorted union) keeps each loop's point order intact
 *  so a non-monotonic hysteresis sweep renders correctly. Returns null for
 *  fewer than 2 bound curves, or fewer than 2 distinct x-blocks (not a real
 *  overlay — the plain channel-selection path handles those). */
export function assembleOverlay(bound: OverlayBound[], figureName = ""): DataStruct | null {
  if (bound.length < 2) return null;

  interface Block {
    ds: Dataset;
    xCh: number; // -2 = the dataset's time column
  }
  const blockKey = (b: OverlayBound): string => `${b.ds.id}#${b.xCh}`;
  const blocks: Block[] = [];
  const blockIndex = new Map<string, number>();
  for (const b of bound) {
    const key = blockKey(b);
    if (!blockIndex.has(key)) {
      blockIndex.set(key, blocks.length);
      blocks.push({ ds: b.ds, xCh: b.xCh });
    }
  }
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
      source_format: String((first as Record<string, unknown>).source_format ?? "overlay"),
      origin_overlay: true,
      origin_overlay_figure: figureName,
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
      // The x-axis title reads `x_column_long || x_column_name`: a non-Origin
      // source (a QD loop's "Magnetic Field") has only a name, so carry it here.
      x_column_long: String(
        (first as Record<string, unknown>).x_column_long || (first as Record<string, unknown>).x_column_name || "",
      ),
      // One shared x axis: list every block's unit ("Oe / K") rather than
      // titling a mixed overlay with the first source's unit alone.
      x_column_unit: [...new Set(blocks.map((b) => b.ds.data.metadata?.x_column_unit))].filter(Boolean).join(" / "),
    },
  };
}

/** PLOT_WORKFLOW_PLAN #3 "Plot selected together": build an overlay
 *  DataStruct from an arbitrary Library multi-selection, generalizing
 *  `buildOverlayDataset` beyond Origin figure apply. Each dataset
 *  contributes exactly ONE curve — its own designated x/time column against
 *  its default plotted channel ({@link primaryChannel}, the same "what does
 *  this dataset show by default" rule the Library thumbnail and plot use) —
 *  labelled by dataset name (not "book: column", since there's no book).
 *  A dataset with no plottable channel is skipped honestly, same as an
 *  undecoded Origin column; callers are expected to have already filtered
 *  out 2-D maps ({@link "./mapdata".is2DMap}) before calling this, since a
 *  map has no single "curve" to contribute. Returns null when fewer than 2
 *  curves resolve. */
export function buildSelectionOverlay(datasets: Dataset[]): DataStruct | null {
  const bound: OverlayBound[] = [];
  for (const ds of datasets) {
    const yCh = primaryChannel(ds.data);
    if (yCh == null) continue; // no plottable channel — skip honestly
    bound.push({
      ds,
      xCh: -2,
      yCh,
      label: ds.name,
      unit: ds.data.units[yCh] ?? "",
      style: null,
      designation: "Y",
      legendLabel: undefined,
    });
  }
  const out = assembleOverlay(bound);
  // assembleOverlay names x by Origin's column letter "A"; a Library selection
  // keeps the first source's own x name ("A (deg)" was the XRD symptom).
  const xName = bound[0]?.ds.data.metadata?.x_column_name;
  if (out) out.metadata.x_column_name = typeof xName === "string" && xName ? xName : "x";
  return out;
}

