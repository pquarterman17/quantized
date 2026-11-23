// Baseline over the shared AnalysisSelection contract: Review inputs plus a
// batch that estimates the chosen method over every selected worksheet (the
// same plotted channel by role) and records one comparable result table.
// Estimate-only: the existing "Apply to N selected" still writes subtracted
// worksheets; this adds preflight, per-input status and a durable result.

import { useCallback } from "react";

import type { AnalysisSelectionItem } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import AnalysisBatchControls, { type AnalysisBatchOutcome } from "../analysisselection/AnalysisBatchControls";
import AnalysisInputReview from "../analysisselection/AnalysisInputReview";
import { useToolAnalysisSelection } from "../analysisselection/useToolAnalysisSelection";
import { peakInputs } from "../peaks/peakInputs";
import { callBaseline } from "./baselineCall";
import { BASELINE_SUMMARY_HEADERS, baselineSummary } from "./baselineSummary";
import type { BaselineState } from "./useBaseline";

export default function BaselineBatchSection({ b }: { b: Pick<BaselineState, "method" | "params"> }) {
  useToolAnalysisSelection("baseline"); // seeds / keeps this tool's selection
  const { method, params } = b;
  const runItem = useCallback(async (dataset: Dataset, selection: AnalysisSelectionItem): Promise<AnalysisBatchOutcome> => {
    const inputs = peakInputs(dataset, selection.xKey, selection.yKeys, null, selection);
    if (inputs.refusal) throw new Error(inputs.refusal);
    if (inputs.x.length < 3) throw new Error("No usable finite X/Y pairs are available to estimate a baseline.");
    const { baseline } = await callBaseline(method, inputs.x, inputs.y, params, []);
    return {
      values: baselineSummary(inputs.y, baseline),
      warnings: inputs.gapCount ? [`${inputs.gapCount} gap rows were omitted.`] : [],
    };
  }, [method, params]);
  const blocked = method === "anchor"
    ? "Anchor baselines are placed by hand on one curve; choose another method to run a batch."
    : null;
  return <>
    <AnalysisInputReview toolId="baseline" singleY supportsBatch />
    {blocked && <p className="qzk-analysis-input-issue error">{blocked}</p>}
    <AnalysisBatchControls
      toolId="baseline"
      label="Baseline"
      summaryColumns={[...BASELINE_SUMMARY_HEADERS]}
      resultParameters={{ method, params: JSON.stringify(params) }}
      blockedReason={blocked}
      runItem={runItem}
      settingsKey={JSON.stringify([method, params])}
    />
  </>;
}
