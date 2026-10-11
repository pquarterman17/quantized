import { useCallback } from "react";

import { fitModel } from "../../../lib/api";
import { dropGapRows } from "../../../lib/api/finitePairs";
import { analysisSelectionData, type AnalysisSelectionItem } from "../../../lib/analysisSelection";
import { partitionByColumn } from "../../../lib/byPartition";
import { selectedFitData } from "../../../lib/fitselection";
import { parseFitParams, rowsAreDefault, type FitParamRow } from "../../../lib/fitParams";
import { dyForFit } from "../../../lib/fitweights";
import type { Dataset, FitModel, WeightMode } from "../../../lib/types";
import AnalysisBatchControls, { type AnalysisBatchOutcome } from "../analysisselection/AnalysisBatchControls";

interface Props {
  modelName: string;
  model: FitModel | undefined;
  paramRows: FitParamRow[];
  weightMode: WeightMode;
  manualKey: number | null;
}

const median = (values: number[]): number | null => {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
};

export default function CurveFitBatchSection({ modelName, model, paramRows, weightMode, manualKey }: Props) {
  const runItem = useCallback(async (dataset: Dataset, selection: AnalysisSelectionItem): Promise<AnalysisBatchOutcome> => {
    const parsed = parseFitParams(paramRows, model);
    if (parsed.error) throw new Error(parsed.error);
    const custom = !rowsAreDefault(paramRows, model);
    const customRequest = custom ? {
      p0: parsed.p0, lower: parsed.lower, upper: parsed.upper,
      ...(parsed.fixed.some(Boolean) ? { fixed: parsed.fixed } : {}),
    } : {};
    const factor = selection.factorKeys[0];
    const warnings: string[] = [];

    if (factor !== undefined) {
      const partition = partitionByColumn(analysisSelectionData(dataset, selection), factor);
      if (!partition.levels.length) throw new Error("The selected factor has no analyzable levels.");
      if (partition.totalLevels > partition.levels.length) {
        warnings.push(`Only the first ${partition.levels.length} of ${partition.totalLevels} factor levels were run.`);
      }
      if (weightMode !== "none") warnings.push("Factor-level batch fits are unweighted.");
      const r2: number[] = [];
      const rmse: number[] = [];
      let completed = 0;
      for (const level of partition.levels) {
        const x = selection.xKey === null ? level.data.time : level.data.values.map((row) => row[selection.xKey!]);
        const yKey = selection.yKeys[0];
        const y = level.data.values.map((row) => row[yKey]);
        const pairs = dropGapRows(x, y);
        try {
          if (pairs.x.length === 0) throw new Error("no finite pairs");
          const result = await fitModel({ model: modelName, x: pairs.x, y: pairs.y, ...customRequest });
          completed++;
          if (typeof result.R2 === "number") r2.push(result.R2);
          if (typeof result.RMSE === "number") rmse.push(result.RMSE);
        } catch (error) {
          warnings.push(`${level.label}: ${error instanceof Error ? error.message : "fit failed"}`);
        }
      }
      if (!completed) throw new Error("No factor level could be fit.");
      return { values: [partition.totalLevels, completed, median(r2), median(rmse), "By factor"], warnings };
    }

    const selected = selectedFitData(dataset, selection.xKey, selection.yKeys, null, selection);
    if (!selected) throw new Error("No response column is available to fit.");
    const pairs = dropGapRows(selected.x, selected.y);
    if (pairs.x.length === 0) throw new Error("No finite X/Y pairs are available to fit.");
    const request: Parameters<typeof fitModel>[0] = { model: modelName, x: pairs.x, y: pairs.y, ...customRequest };
    if (weightMode === "yerr" || weightMode === "poisson") {
      const keep = pairs.keep.map((index) => selected.analysisRows?.[index] ?? index);
      const weighted = dyForFit(dataset, selected.yKey, weightMode === "poisson"
        ? { mode: "poisson" }
        : { mode: "yerr", errKey: selection.errorKeys[selected.yKey] }, keep);
      if (weighted.dy) request.dy = keep.map((index) => weighted.dy![index]!);
      if (weighted.issue) warnings.push(weighted.issue);
    } else if (weightMode === "manual") {
      warnings.push(manualKey === null
        ? "Manual weighting was not configured; this input ran unweighted."
        : "Manual weight columns are worksheet-specific; this batch input ran unweighted.");
    }
    const result = await fitModel(request);
    const params = Array.isArray(result.params) ? result.params.map((value) => Number(value).toPrecision(5)).join(", ") : null;
    return {
      values: [1, 1, typeof result.R2 === "number" ? result.R2 : null, typeof result.RMSE === "number" ? result.RMSE : null, params],
      warnings,
    };
  }, [manualKey, model, modelName, paramRows, weightMode]);

  return <AnalysisBatchControls
    toolId="curvefit"
    label={`Curve Fit (${modelName})`}
    summaryColumns={["Levels", "Completed", "Median R²", "RMSE", "Parameters"]}
    runItem={runItem}
  />;
}
