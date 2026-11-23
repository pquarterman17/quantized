// Background ESTIMATE over selected worksheets (lane BY4): the fit numbers of
// the Background tab per worksheet, as a table; nothing is subtracted and no
// worksheet is written (the single run's "Subtract background" does that).
//
// What a worksheet means (decided, fail closed):
//  * every worksheet row (the single fit's policy: excluded rows are NOT left
//    out, so a batch row equals the panel's fit for that sheet), the response column
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
import { analysisSeries } from "../../../lib/analysisInputs";
import { columnByName } from "../../../lib/statsBatchColumns";
import type { Dataset } from "../../../lib/types";
import type { AnalysisBatchOutcome } from "../analysisselection/AnalysisBatchControls";
import { resolveMagInputs } from "./magInputs";
import type { MagBgMode } from "./useMagTools";

export const MAG_BACKGROUND_BATCH_HEADERS = ["Routine", "Slope", "Intercept", "Offset", "Points used", "Gap rows"] as const;

export async function magBackgroundBatchItem(
  dataset: Dataset, channel: string, mode: MagBgMode, autoFraction: number, hiFraction: number,
): Promise<AnalysisBatchOutcome> {
  const col = columnByName(dataset.data, channel);
  if (col < 0) throw new Error(`"${channel}" is the X axis of this worksheet, not a response channel.`);
  // The panel's own data path (magInputs.ts): every worksheet row, the
  // response's own X, so a batch row equals the single fit for that sheet.
  const inputs = resolveMagInputs(dataset, null, [col], null);
  if (!inputs.ok) throw new Error(inputs.reason);
  // A response with a channel role (error, ...) is dropped by the plotted-channel rule and
  // would silently fit another column: fail closed instead.
  if (inputs.yKeys[0] !== col) throw new Error(`"${channel}" has a channel role (for example an error column) and cannot be fitted as a moment.`);
  const { x, y } = analysisSeries(inputs);
  const axis = magXAxis(inputs.data, inputs.xKey);
  let path: "mt" | "mh";
  if (mode === "auto") {
    const detection = detectMagXKind(axis.label, axis.unit);
    if (detection.kind === "unknown") throw new Error(`Cannot tell M(T) from M(H): ${detection.reason}. Choose the data type in the panel.`);
    path = detection.kind === "field" ? "mh" : "mt";
  } else {
    path = mode;
  }
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
    return { values: ["M(H) loop", r.slope, null, r.offset, pairs.keep.length, gaps], warnings, rows: inputs.rowCount };
  }
  const r = await subtractMagBackground({ temperature: pairs.x, moment: pairs.y, auto_fraction: autoFraction });
  return { values: ["M(T) tail", r.slope, r.intercept, null, pairs.keep.length, gaps], warnings, rows: inputs.rowCount };
}
