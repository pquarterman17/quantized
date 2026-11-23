// The (X, Y) column pair a batch tool (peak wizard batch, batch integrate)
// resolves from the plot: the primary Y and ITS OWN X (R2 in T1,R1,T2,R2 is
// read against T2, not the plot's T1), as names plus indices so another
// worksheet can match by name. xLabel/xIndex null = the time axis.

import { fitChannelOf } from "./fitselection";
import { ownXKey } from "./perSeriesX";
import type { Dataset } from "./types";

export interface OwnXChannels {
  xLabel: string | null;
  yLabel: string;
  xIndex: number | null;
  yIndex: number;
}

export function ownXChannels(
  active: Dataset | null | undefined,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
): OwnXChannels | null {
  // Channel identity only (no rows are read): a lazy preview or an excluded
  // row set must not hide the batch's channel pick.
  const sel = active ? fitChannelOf(active, xKey, yKeys, seriesOrder) : null;
  const labels = active?.data.labels ?? [];
  if (!sel || sel.refusal || sel.yKey === undefined || labels[sel.yKey] === undefined) return null;
  const ownX = active ? ownXKey(active, xKey, sel.yKey) : xKey;
  const xLabel = ownX === null ? null : (labels[ownX] ?? null);
  if (ownX !== null && xLabel === null) return null;
  return { xLabel, yLabel: labels[sel.yKey], xIndex: ownX, yIndex: sel.yKey };
}
