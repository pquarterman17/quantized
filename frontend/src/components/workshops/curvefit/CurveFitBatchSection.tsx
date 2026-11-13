import { useCallback } from "react";

import { fitModel } from "../../../lib/api";
import { dropGapRows } from "../../../lib/api/finitePairs";
import { analysisSelectionData, type AnalysisSelectionItem } from "../../../lib/analysisSelection";
import { partitionByColumn } from "../../../lib/byPartition";
import { selectedFitData } from "../../../lib/fitselection";
import { parseFitParams, rowsAreDefault, type FitParamRow } from "../../../lib/fitParams";
import { dyForFit } from "../../../lib/fitweights";
import type { CalcResult, Dataset, FitModel, WeightMode } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { nextDatasetId } from "../../../store/idSeq";
import AnalysisBatchControls, { type AnalysisBatchOutcome, type AnalysisBatchRow } from "../analysisselection/AnalysisBatchControls";
import { batchColumns, batchSummaryData, fitSummaryValues } from "./curveFitBatchSummary";

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
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const names = model?.paramNames ?? paramRows.map((r) => r.name);
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
      const results: CalcResult[] = [];
      for (const level of partition.levels) {
        const x = selection.xKey === null ? level.data.time : level.data.values.map((row) => row[selection.xKey!]);
        const yKey = selection.yKeys[0];
        const y = level.data.values.map((row) => row[yKey]);
        const pairs = dropGapRows(x, y);
        try {
          if (pairs.x.length === 0) throw new Error("no finite pairs");
          results.push(await fitModel({ model: modelName, x: pairs.x, y: pairs.y, ...customRequest }));
        } catch (error) {
          warnings.push(`${level.label}: ${error instanceof Error ? error.message : "fit failed"}`);
        }
      }
      if (!results.length) throw new Error("No factor level could be fit.");
      // Several fits per worksheet: medians, labelled as such in a warning.
      warnings.push(`Factor levels: values are medians over ${results.length} level fits.`);
      const per = results.map((r) => fitSummaryValues(r, names.length));
      return {
        values: [partition.totalLevels, results.length, ...per[0]!.map((_, k) => median(per.map((v) => v[k] ?? Number.NaN)))],
        warnings,
      };
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
    return { values: [1, 1, ...fitSummaryValues(result, names.length)], warnings };
  }, [manualKey, model, modelName, paramRows, weightMode, names.length]);

  const columns = batchColumns(names);
  const summarySheet = (rows: readonly AnalysisBatchRow[]) => {
    const name = `Curve Fit summary — ${modelName} (${rows.length} worksheet${rows.length === 1 ? "" : "s"})`;
    addDataset({ id: nextDatasetId(), name, data: batchSummaryData(rows, columns, modelName) });
    setStatus(`added ${name}`);
  };

  return <AnalysisBatchControls
    toolId="curvefit"
    label={`Curve Fit (${modelName})`}
    summaryColumns={columns}
    runItem={runItem}
    onSummarySheet={summarySheet}
  />;
}
