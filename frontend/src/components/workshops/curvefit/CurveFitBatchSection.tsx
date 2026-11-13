import { useCallback, useRef } from "react";

import { fitModel } from "../../../lib/api";
import { dropGapRows } from "../../../lib/api/finitePairs";
import { analysisSelectionData, type AnalysisSelectionItem } from "../../../lib/analysisSelection";
import { partitionByColumn } from "../../../lib/byPartition";
import { selectedFitData } from "../../../lib/fitselection";
import { parseFitParams, rowsAreDefault, type FitParamRow } from "../../../lib/fitParams";
import { dyForFit } from "../../../lib/fitweights";
import type { CalcResult, Dataset, FitModel, WeightMode } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { addWorksheetQuietly } from "../../../store/addWorksheetQuietly";
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
  const setStatus = useApp((s) => s.setStatus);
  const datasets = useApp((s) => s.datasets);
  const names = model?.paramNames ?? paramRows.map((r) => r.name);
  const columns = batchColumns(names);
  // What the LAST RUN fitted. The summary worksheet is built from the run's
  // own model and columns, never the panel's current ones: picking another
  // model after a run used to label that run's values with the new model's
  // parameter names.
  const ran = useRef<{ model: string; columns: string[] } | null>(null);
  const runItem = useCallback(async (dataset: Dataset, selection: AnalysisSelectionItem): Promise<AnalysisBatchOutcome> => {
    ran.current = { model: modelName, columns: batchColumns(model?.paramNames ?? paramRows.map((r) => r.name)) };
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

  const summarySheet = (ranRows: readonly AnalysisBatchRow[]) => {
    const run = ran.current ?? { model: modelName, columns };
    // In Library order, not run order: the batch starts with the active
    // worksheet, so selecting b1, b2, b3 with b3 active ran (and listed) b3
    // first — and "parameter against input" plotted the samples out of order.
    const position = new Map(datasets.map((d, i) => [d.id, i]));
    const rows = [...ranRows].sort((a, b) => (position.get(a.datasetId) ?? Infinity) - (position.get(b.datasetId) ?? Infinity));
    const name = `Curve Fit summary — ${run.model} (${rows.length} worksheet${rows.length === 1 ? "" : "s"})`;
    // Not activated: the batch selection and the plot stay as they are.
    addWorksheetQuietly({ id: nextDatasetId(), name, data: batchSummaryData(rows, run.columns, run.model) }, "add curve fit summary worksheet");
    setStatus(`added the worksheet "${name}" to the Library (Undo removes)`);
  };

  return <AnalysisBatchControls
    toolId="curvefit"
    label={`Curve Fit (${modelName})`}
    summaryColumns={columns}
    runItem={runItem}
    onSummarySheet={summarySheet}
  />;
}
