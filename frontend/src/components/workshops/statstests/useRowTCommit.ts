// Statistical tests: "Add as worksheet" for a row-wise t-test result, on the
// shared computed-output contract (store/commitComputedOutput.ts): one undo step,
// a repeat adds nothing, the output is linked to its source and goes out of date
// when the source changes. Off by default: nothing is written until the button
// is clicked. The worksheet has one row per tested row, X = the source X.

import type { RowTTestsResult } from "../../../lib/api/statsTestsRows";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { recordedPickExtra } from "../../../lib/reductionsReopenSeed";
import { rowTestWorksheet } from "../../../lib/rowTestWorksheet";
import type { Dataset } from "../../../lib/types";
import { commitComputedOutput } from "../../../store/commitComputedOutput";

const ROWT_PRODUCER = { id: "row-t-tests", label: "Row-wise t-tests", version: 1 } as const;

/** The row-wise answer on screen, with what it was computed from. */
export interface RowTRun {
  result: RowTTestsResult;
  sourceId: string;
  sourceName: string;
  /** `analysisDataFingerprint` of the source as the test ran. */
  computedOn: string;
  /** The X value of each tested row (the analysis view). */
  xs: number[];
  /** The source worksheet row (0-based) behind each tested row; null when no row is dropped. */
  sourceRows: number[] | null;
  xLabel: string;
  xUnit: string;
  settings: Record<string, unknown>;
  picks: Record<string, unknown>;
}

export function rowTRunOf(
  result: RowTTestsResult, source: Dataset, xs: number[], sourceRows: number[] | null, settings: Record<string, unknown>, columns: readonly number[],
): RowTRun {
  const xLabel = String(source.data.metadata?.["x_column_name"] ?? "x");
  return {
    result, sourceId: source.id, sourceName: source.name, computedOn: analysisDataFingerprint(source), xs, sourceRows, xLabel,
    xUnit: String(source.data.metadata?.["x_unit"] ?? ""), settings,
    picks: recordedPickExtra(source.data.labels, columns, xLabel),
  };
}

export function commitRowTRun(run: RowTRun): void {
  const data = rowTestWorksheet(run.result, run.xs, run.xLabel, run.xUnit, run.sourceRows);
  commitComputedOutput({
    producer: ROWT_PRODUCER,
    sources: [{ id: run.sourceId, computedOn: run.computedOn }],
    settings: run.settings,
    reopenExtra: run.picks,
    name: `Row-wise t-tests — ${run.sourceName}`,
    data,
    quiet: true,
    status: `added row-wise t-tests (${run.result.rows.length} rows) as a worksheet`,
  });
}
