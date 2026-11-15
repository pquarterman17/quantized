// The columns Curve Fit may group ("By") the fit over: every column except the
// two already driving it -- the fitted Y and the X it is fitted against, which
// on a multi-X sheet is the Y's OWN X (T1,R1,T2,R2: R2 fits against T2). The
// plot's shared X is a legitimate grouping column unless it is that own X.

import { ownXKey } from "../../../lib/perSeriesX";
import type { Dataset } from "../../../lib/types";

export interface ByColumnCandidate {
  index: number;
  label: string;
}

export function byColumnOptions(
  active: Dataset | null | undefined,
  xKey: number | null,
  yKey: number | null,
): ByColumnCandidate[] {
  if (!active) return [];
  const fitX = yKey === null ? xKey : ownXKey(active, xKey, yKey);
  return active.data.labels
    .map((label, index) => ({ index, label }))
    .filter((c) => c.index !== fitX && c.index !== yKey);
}
