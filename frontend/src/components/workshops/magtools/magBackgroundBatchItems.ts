// Background ESTIMATE over selected worksheets (lane BY4): the fit numbers of
// the Background tab per worksheet, as a table; nothing is subtracted and no
// worksheet is written (the single run's "Subtract background" does that).
//
// What a worksheet means (decided, fail closed):
//  * its analysis view (excluded / filtered rows dropped), the response column
//    with the panel's channel NAME, and that response's OWN X axis;
//  * the routine follows the panel's Data type: "Auto-detect" reads each
//    worksheet's own X axis (field -> M(H) loop, temperature -> M(T) tail) and a
//    worksheet whose axis cannot be told is an error row, never a guess; an
//    explicit M(T) / M(H) choice applies to every worksheet, as the user asked;
//  * the fractions are the panel's (a fraction is physical, like a fit window).
// Units and Internal field are not batched: they need a per-sample mass or
// geometry that a shared value would guess.

import { dropGapRows } from "../../../lib/api/finitePairs";
import { subtractHysteresisBackground, subtractMagBackground } from "../../../lib/api/magnetometry";
import { detectMagXKind, magXAxis } from "../../../lib/magDataKind";
import { ownXKey } from "../../../lib/perSeriesX";
import { columnByName, statsBatchData } from "../../../lib/statsBatchColumns";
import type { Dataset } from "../../../lib/types";
import type { AnalysisBatchOutcome } from "../analysisselection/AnalysisBatchControls";
import type { MagBgMode } from "./useMagTools";

export const MAG_BACKGROUND_BATCH_HEADERS = ["Routine", "Slope", "Intercept", "Offset", "Points used", "Gap rows"] as const;

export async function magBackgroundBatchItem(
  dataset: Dataset, channel: string, mode: MagBgMode, autoFraction: number, hiFraction: number,
): Promise<AnalysisBatchOutcome> {
  const data = statsBatchData(dataset);
  const col = columnByName(data, channel);
  if (col < 0) throw new Error(`"${channel}" is the X axis of this worksheet, not a response channel.`);
  const view = { ...dataset, data };
  const xCol = ownXKey(view, null, col);
  const axis = magXAxis(data, xCol);
  let path: "mt" | "mh";
  if (mode === "auto") {
    const detection = detectMagXKind(axis.label, axis.unit);
    if (detection.kind === "unknown") throw new Error(`Cannot tell M(T) from M(H): ${detection.reason}. Choose the data type in the panel.`);
    path = detection.kind === "field" ? "mh" : "mt";
  } else {
    path = mode;
  }
  const x = xCol === null ? data.time : data.values.map((row) => row[xCol]!);
  const y = data.values.map((row) => row[col]!);
  const pairs = dropGapRows(x, y);
  if (pairs.keep.length < 3) {
    throw new Error(`Only ${pairs.keep.length} of ${pairs.n} rows have both a finite x and a finite moment; not enough to fit a background.`);
  }
  const warnings: string[] = [];
  const gaps = pairs.n - pairs.keep.length;
  if (gaps) warnings.push(`${gaps} gap rows were excluded from the fit.`);
  if (path === "mh") {
    const r = await subtractHysteresisBackground({ h: pairs.x, m: pairs.y, hi_fraction: hiFraction });
    if (r.slope === 0 && r.offset === 0) {
      warnings.push("No high-field background found (too few saturated-tail points, or the field span is degenerate); the moment would be unchanged.");
    } else if (r.offset === 0) {
      warnings.push("High field on one side only: the slope is estimated without a centring offset.");
    }
    return { values: ["M(H) loop", r.slope, null, r.offset, pairs.keep.length, gaps], warnings };
  }
  const r = await subtractMagBackground({ temperature: pairs.x, moment: pairs.y, auto_fraction: autoFraction });
  return { values: ["M(T) tail", r.slope, r.intercept, null, pairs.keep.length, gaps], warnings };
}
