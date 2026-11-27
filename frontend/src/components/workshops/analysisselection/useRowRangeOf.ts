import type { RowRange } from "../../../lib/rowRange";
import { rowRangeOn, useAnalysisSelection } from "../../../store/analysisSelection";

/** The row range set on worksheet `datasetId` in the shared analysis selection
 *  (null = none): what a statistics tool narrows to (ROW_RANGE_CONTRACT 3.3). */
export function useRowRangeOf(datasetId: string | null | undefined): RowRange | null {
  return useAnalysisSelection((state) => datasetId ? rowRangeOn(datasetId, state.selection) : null);
}
