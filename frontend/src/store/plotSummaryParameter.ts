// "Plot ▸ parameter" for a batch summary worksheet: open it with ONE column on
// Y and R² (summary column 3 -- see components/workshops/curvefit/
// curveFitBatchSummary.ts `batchColumns`) on the right axis, against its X.
// Lives in the store layer: it is a multi-field imperative write.

import { useApp } from "./useApp";

const R2_COLUMN = 3;

/** Plot `column` (and R² on Y2) of the summary worksheet `datasetId` against its X. */
export function plotSummaryParameter(datasetId: string, column: number): void {
  const app = useApp.getState();
  app.setActive(datasetId);
  app.setXKey(null);
  app.setYKeys([column]);
  app.setY2Keys([R2_COLUMN]);
  useApp.setState({ stageTab: "plot" });
}
