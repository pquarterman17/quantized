// Process capability: blank LSL / USL / Target fall back to the measurement
// column's spec limits (GAP_AUDIT_9 G27; provisional, owner to confirm). The
// user's typed value always wins; the inputs panel names every fallback and
// Run reports it, so a pre-fill is never silent.

import { fillBlankSpec } from "../../../lib/columnSpecs";
import type { TestParams, TestSelection } from "../../../lib/statsTests";
import type { Dataset } from "../../../lib/types";

export interface SpecPrefill {
  params: TestParams;
  /** The fields filled (LSL / USL / Target), empty when none. */
  filled: string[];
  /** The column they came from. */
  column: string;
}

export function withColumnSpecs(testId: string, ds: Dataset | null, sel: TestSelection, tp: TestParams): SpecPrefill {
  const none = { params: tp, filled: [], column: "" };
  if (testId !== "capability" || !ds) return none;
  const spec = ds.columnProps?.[sel.x]?.spec;
  const { params, filled } = fillBlankSpec(tp.spc, spec);
  if (filled.length === 0) return none;
  const meta = ds.data.metadata ?? {};
  const column = sel.x < 0 ? String(meta["x_column_name"] ?? "X") : (ds.data.labels[sel.x] ?? `column ${sel.x + 1}`);
  return { params: { ...tp, spc: params }, filled, column };
}
