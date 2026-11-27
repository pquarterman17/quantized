import type { StatsTestId } from "../lib/api/statsTests";
import { statisticalTestAnalysisResult } from "../lib/statisticalTestAnalysisResult";
import type { TestParams, TestSelection } from "../lib/statsTests";
import { parametersWithoutInputs } from "../lib/resultInputsRecord";
import type { TestOutput } from "../lib/statsTestsResults";
import type { DataStruct, Dataset } from "../lib/types";
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
  /** The exact rows a row range limited the run to: the recorded inputs then
   *  count these rows, not the whole analysis view. */
  view: DataStruct | null = null,
): string {
  const result = statisticalTestAnalysisResult(
    nextAnalysisResultId(), source, testId, selection, params, labels, output, undefined, view,
  );
  const state = useApp.getState();
  // A repeat Run of the same question on the same data (same tables) adds nothing:
  // it shows the saved one (result-lifecycle criterion 11).
  const same = (other: typeof result): boolean =>
    other.producer.id === result.producer.id &&
    other.sourceFingerprint === result.sourceFingerprint &&
    JSON.stringify([other.sources, parametersWithoutInputs(other.parameters), other.tables]) ===
      JSON.stringify([result.sources, parametersWithoutInputs(result.parameters), result.tables]);
  const existing = state.analysisResults.find(same);
  if (existing) {
    state.setStatus(`this ${existing.name} result is already saved; nothing was duplicated`);
    return existing.id;
  }
  state.recordHistory("run statistical test");
  useApp.setState((current) => ({
    analysisResults: [...current.analysisResults, result],
    status: `created ${result.name} result`,
  }));
  return result.id;
}
