// The magnetometry tools' data path: ONE function decides which worksheet
// rows and which channels a Background / Units / Internal field / Curie-Weiss
// run reads, and it is the shared resolver (lib/analysisInputs). A tool picks
// its row policy (stated in MagInputSummary): Background, Units and Internal
// field convert EVERY worksheet row (their outputs are row-aligned with the
// source), Curie-Weiss fits the analysis view.

import {
  resolveAnalysisInputs, ROW_POLICY, type AnalysisInputs, type AnalysisRowPolicy,
} from "../../../lib/analysisInputs";
import { plottedYKey } from "../../../lib/fitselectionActions";
import { ownXKey } from "../../../lib/perSeriesX";
import type { Dataset } from "../../../lib/types";

/** The plotted moment channel against ITS OWN X (a secondary-X Y reads its own
 *  X); the first channel when nothing is plotted. Column choice only. */
export function magColumns(
  ds: Dataset, xKey: number | null, yKeys: number[] | null, seriesOrder: number[] | null,
): { xKey: number | null; yKey: number } {
  const yKey = plottedYKey(ds, xKey, yKeys, seriesOrder) ?? 0;
  return { xKey: ownXKey(ds, xKey, yKey), yKey };
}

/** The tool's inputs under the shared contract. A refusal (lazy preview,
 *  missing column, no rows) carries the reason the tool must show. */
export function resolveMagInputs(
  ds: Dataset, xKey: number | null, yKeys: number[] | null, seriesOrder: number[] | null,
  policy: AnalysisRowPolicy = ROW_POLICY.fullWorksheet,
): AnalysisInputs {
  const cols = magColumns(ds, xKey, yKeys, seriesOrder);
  return resolveAnalysisInputs({ datasets: [ds], activeId: ds.id, xKey: cols.xKey, yKeys: [cols.yKey], policy });
}
