import type { StatsTestId } from "../lib/api/statsTests";
import { statisticalTestAnalysisResult } from "../lib/statisticalTestAnalysisResult";
import type { TestParams, TestSelection } from "../lib/statsTests";
import type { TestOutput } from "../lib/statsTestsResults";
import type { Dataset } from "../lib/types";
import { nextAnalysisResultId } from "./idSeq";
import { useApp } from "./useApp";

/** Publish one completed test as one undoable Library edit. The workshop may
 * continue displaying its local response, but the envelope is the sole
 * persisted authority and survives closing the panel or reopening the file. */
export function publishStatisticalTestResult(
  source: Dataset | null,
  testId: StatsTestId,
  selection: TestSelection,
  params: TestParams,
  labels: string[],
  output: TestOutput,
): string {
  const result = statisticalTestAnalysisResult(
    nextAnalysisResultId(), source, testId, selection, params, labels, output,
  );
  const state = useApp.getState();
  state.recordHistory("run statistical test");
  useApp.setState((current) => ({
    analysisResults: [...current.analysisResults, result],
    status: `created ${result.name} result`,
  }));
  return result.id;
}
