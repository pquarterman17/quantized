// The plot's row window (ROW_RANGE_CONTRACT 3.3, D4): rows outside
// `PlotView.rowRange` are not drawn and range nothing, yet the payload keeps its
// length, so overlays, error bars and a waterfall stay row-aligned and every row
// keeps its SOURCE index (Select rows, the lasso and Go to Source count source
// rows).
//
// "Not drawn" is the leading-gaps rule (`leadingGapsFixture.test.ts`): a row with
// no x draws no point and ranges neither axis, so a hidden row gets a null x AND
// null values in every column. That reuses the one path that already
// autoscales, strokes and exports "only rows with an x" instead of a second one.
//
// Applied LAST over the composed payload (exclusion mask, fit / baseline / peak
// overlays, selection brush), so a hidden row stays hidden in every companion
// column too: a fit curve outside the window would otherwise stretch the axis.
// The hidden set is two intervals, never a per-row `Set`: a 100-row window on a
// 1M-row sheet allocates nothing per row.

import { mapColumn } from "./plotColumnOps";
import type { PlotPayload } from "./plotdata";
import type { RowRange } from "./rowRange";

/** The dataset row behind payload row `i`: a reduced payload names it
 *  (`rowIds`), a waterfall X-offset one repeats each row per block. */
function sourceRow(payload: PlotPayload, i: number): number {
  return payload.rowIds ? payload.rowIds[i] : payload.blockRows ? i % payload.blockRows : i;
}

/** `payload` with every row outside `range` hidden (null x and values), or the
 *  same object when nothing is outside it or there is no range. A range past the
 *  sheet's `rows` is never clamped: it is not applied and the plot draws every
 *  row (the chip says so, lib/plotRowRangeState.ts). */
export function windowRows(payload: PlotPayload, range: RowRange | null | undefined, rows = Infinity): PlotPayload {
  if (!range || range.to >= rows) return payload;
  const cols = payload.data as ArrayLike<number | null>[];
  const n = cols[0]?.length ?? 0;
  const plain = !payload.rowIds && !payload.blockRows;
  const hidden = (i: number): boolean => {
    const row = sourceRow(payload, i);
    return row < range.from || row > range.to;
  };
  // A plain payload hides the two intervals [0, from) and (to, n); a reduced or
  // block-laid-out one maps each payload row to its dataset row first.
  const outside = plain ? range.from > 0 || range.to < n - 1 : cols[0] !== undefined && Array.from(cols[0], (_v, i) => hidden(i)).some(Boolean);
  if (!outside) return payload;
  const hide = (col: ArrayLike<number | null>): (number | null)[] => {
    const out = mapColumn(col, (v) => v);
    if (plain) {
      for (let i = 0; i < Math.min(range.from, n); i++) out[i] = null;
      for (let i = Math.max(range.to + 1, 0); i < n; i++) out[i] = null;
    } else {
      for (let i = 0; i < n; i++) if (hidden(i)) out[i] = null;
    }
    return out;
  };
  return { ...payload, data: cols.map(hide) as PlotPayload["data"], rowWindow: true };
}
