// Per-series DECADE offsets for a log-y comparison plot (audit P2.3, box 3).
//
// On a log y axis an additive stagger (the `view.waterfall` fraction) means
// nothing, so overlapping profiles — SIMS species, or one species across
// samples — are separated MULTIPLICATIVELY: series i is drawn at y · 10^k,
// which on a log axis is a rigid shift of k decades. `k` is a whole number
// stored on the series' own style (`SeriesStyle.logOffset`), so it persists
// with the plot exactly like a colour or a dash: the `.dwk`, a window's view,
// a saved figure document. The DATA never change — the worksheet, CSV and the
// export wire's `dataset` keep the true values; this is render metadata.
//
// The two producers that must agree share this module, the way BUG-013's
// waterfall does (`lib/waterfallOffset.ts`):
//   * the CANVAS — `Stage/usePlotPayload` scales the fetched payload before it
//     composes the display (the focused Stage and every background window go
//     through that hook);
//   * the EXPORT WIRE — `lib/figureSpec.ts` emits `log_offsets` aligned to
//     `y_keys`, applied by the backend's `calc.plot_log_offsets` in the ONE
//     `_figure_series` every figure export route shares.
// Each offset series' legend name gains " ×10^k" BEFORE its unit on both
// sides (`P ×10^3 (atoms/cm3)`), so the offset is stated wherever the curve
// is; a user's own legend rename is shown verbatim on both, as always.
//
// WHEN IT APPLIES (one predicate each side asks): never together with an
// additive waterfall (the two would compound, and the waterfall's span is
// measured on data this would already have scaled), and only on the plain
// single-panel XY overlay — a group split, facets, and the stack/polar/stat
// canvases are refused exactly as the waterfall wire refuses them
// (`seriesStyleCycle.overlayModesMatchTheCanvas`), so the canvas never shows
// an offset the export would drop or the reverse. Multi-panel cells
// (`lib/multipanel.ts`) do not read series styles' offsets either.

import type { ErrorSpan } from "./errorbars";
import type { PlotPayload } from "./plotdata";
import { overlayModesMatchTheCanvas, type CycleView } from "./seriesStyleCycle";
import type { SeriesStyle } from "./types";
import { waterfallApplies } from "./waterfallOffset";

/** The largest offset honoured, either way (the backend's `MAX_DECADES`). */
export const MAX_DECADES = 30;

/** The usable offset in whole decades for a stored value (0 = none): a
 *  non-integer, non-finite or out-of-range value is no offset, never an error
 *  (a `.dwk` is user-editable JSON). Mirrors `log_offset_decades`. */
export function logOffsetDecades(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || Math.abs(v) > MAX_DECADES) return 0;
  return v === 0 ? 0 : v; // -0 -> 0
}

/** The legend suffix for an offset series ("" for none). Mirrors the
 *  backend's `log_offset_suffix` character for character. */
export function logOffsetSuffix(k: number): string {
  return k ? ` ×10^${k}` : "";
}

/** Do decade offsets apply to this view? Canvas half of the shared rule. */
export function logOffsetsApply(waterfall: number, groupCol: number | null): boolean {
  return !waterfallApplies(waterfall) && groupCol === null;
}

/** Scale the plotted series of `payload` by their channels' decade offsets.
 *  `channels[i]` is the dataset channel of `payload.data[i + 1]` (overlays,
 *  appended after the plotted series, are never offset). Returns `payload`
 *  itself when nothing is offset, so memoized consumers see no change. */
export function applyLogOffsets(
  payload: PlotPayload,
  channels: readonly number[],
  styles: Record<number, SeriesStyle>,
  applies: boolean,
): PlotPayload {
  if (!applies) return payload;
  const ks = channels.map((ch) => logOffsetDecades(styles[ch]?.logOffset));
  if (!ks.some((k) => k !== 0)) return payload;
  const cols = payload.data as unknown as (number | null | undefined)[][];
  const data = cols.map((col, c) => {
    const k = c >= 1 && c - 1 < ks.length ? ks[c - 1] : 0;
    if (!k) return col;
    const f = 10 ** k;
    return col.map((v) => (v == null ? v : v * f));
  });
  const series = payload.series.map((s, i) =>
    i < ks.length && ks[i] ? { ...s, label: s.label + logOffsetSuffix(ks[i]) } : s,
  );
  return { ...payload, data: data as unknown as PlotPayload["data"], series };
}

/** Finding 3: `buildErrorColumns`' magnitude map is built from the RAW
 *  dataset, independent of `applyLogOffsets` above — an offset series' whisker
 *  would otherwise stay at the true (unscaled) magnitude while the point it
 *  brackets is drawn at `y · 10^k`, understating the uncertainty on an offset
 *  trace by exactly the offset's own factor. `cols` is keyed like
 *  `buildErrorColumns` returns it (uPlot data-column index, 1-based); `channels`
 *  is the SAME `plotted` list `applyLogOffsets` takes, so column `p+1`'s offset
 *  is `channels[p]`'s. Returns `cols` itself when nothing is offset. */
export function scaleErrorColumns(
  cols: Map<number, (number | null)[]>,
  channels: readonly number[],
  styles: Record<number, SeriesStyle>,
  applies: boolean,
): Map<number, (number | null)[]> {
  if (!applies || cols.size === 0) return cols;
  let changed = false;
  const out = new Map<number, (number | null)[]>();
  cols.forEach((col, dataCol) => {
    const p = dataCol - 1;
    const k = p >= 0 && p < channels.length ? logOffsetDecades(styles[channels[p]]?.logOffset) : 0;
    if (!k) {
      out.set(dataCol, col);
      return;
    }
    changed = true;
    const f = 10 ** k;
    out.set(dataCol, col.map((v) => (v == null ? v : v * f)));
  });
  return changed ? out : cols;
}

/** The same scaling as {@link scaleErrorColumns}, for `buildErrorSpans`' richer
 *  `{axis, plus, minus}` map: only the Y half of a span is scaled (an offset
 *  moves a series vertically, never sideways, so an X span is untouched). */
export function scaleErrorSpans(
  spans: Map<number, ErrorSpan[]>,
  channels: readonly number[],
  styles: Record<number, SeriesStyle>,
  applies: boolean,
): Map<number, ErrorSpan[]> {
  if (!applies || spans.size === 0) return spans;
  let changed = false;
  const out = new Map<number, ErrorSpan[]>();
  spans.forEach((list, dataCol) => {
    const p = dataCol - 1;
    const k = p >= 0 && p < channels.length ? logOffsetDecades(styles[channels[p]]?.logOffset) : 0;
    if (!k) {
      out.set(dataCol, list);
      return;
    }
    changed = true;
    const f = 10 ** k;
    out.set(
      dataCol,
      list.map((s) =>
        s.axis === "y"
          ? {
              ...s,
              plus: s.plus.map((v) => (v == null ? v : v * f)),
              minus: s.minus.map((v) => (v == null ? v : v * f)),
            }
          : s,
      ),
    );
  });
  return changed ? out : spans;
}

/** The `log_offsets` half of a `FigureSpec` — one entry per `plotted`
 *  channel (the wire's `y_keys`) — or `{}` when nothing is offset or the view
 *  is one the rule above refuses, so an ordinary export's wire is unchanged. */
export function logOffsetWire(args: {
  plotted: readonly number[];
  seriesStyles: Record<number, SeriesStyle>;
  waterfall: number;
  view: CycleView;
  /** The `group_col` this spec emits (null = an ungrouped overlay). */
  groupCol: number | null;
}): { log_offsets?: number[] } {
  if (!logOffsetsApply(args.waterfall, args.groupCol)) return {};
  if (!overlayModesMatchTheCanvas({ ...args.view, groupKey: args.groupCol })) return {};
  const ks = args.plotted.map((ch) => logOffsetDecades(args.seriesStyles[ch]?.logOffset));
  return ks.some((k) => k !== 0) ? { log_offsets: ks } : {};
}
