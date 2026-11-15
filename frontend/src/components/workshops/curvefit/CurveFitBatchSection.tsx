import { useCallback, useRef } from "react";

import { fitModel } from "../../../lib/api";
import { dropGapRows } from "../../../lib/api/finitePairs";
import { analysisSelectionData, type AnalysisSelectionItem } from "../../../lib/analysisSelection";
import { partitionByColumn } from "../../../lib/byPartition";
import { fitSelectionRefusal, selectedFitData } from "../../../lib/fitselection";
import { parseFitParams, rowsAreDefault, type FitParamRow } from "../../../lib/fitParams";
import { dyForFit } from "../../../lib/fitweights";
import type { CalcResult, Dataset, FitModel, WeightMode } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { addWorksheetQuietly } from "../../../store/addWorksheetQuietly";
import { nextDatasetId } from "../../../store/idSeq";
import AnalysisBatchControls, { type AnalysisBatchOutcome, type AnalysisBatchRow } from "../analysisselection/AnalysisBatchControls";
import { inOrder, summaryX, summaryXNote, type SummaryXChoice } from "../../../lib/batchSummaryX";
import { ownXKey } from "../../../lib/perSeriesX";
import { batchColumns, batchSummaryData, batchTableInputs, fitSummaryValues, libraryOrder } from "./curveFitBatchSummary";
import { batchFitTable } from "../../../lib/fitTableLayer";
import FitTableControls from "./FitTableControls";
import { parseFitStarts } from "./fitStarts";

interface Props {
  modelName: string;
  model: FitModel | undefined;
  paramRows: FitParamRow[];
  weightMode: WeightMode;
  manualKey: number | null;
  /** The panel's "Scale errors with √(reduced χ²)" switch: a weighted batch
   *  input reports its errors the way the single fit would. */
  scaleErrors?: boolean;
}

const median = (values: number[]): number | null => {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
};

export default function CurveFitBatchSection({ modelName, model, paramRows, weightMode, manualKey, scaleErrors = true }: Props) {
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
    // Per input: an edited table's unchosen starts come from THAT input's
    // data (fitStarts.ts), as in the single fit.
    const customRequest = async (x: number[], y: number[]) => {
      if (!custom) return {};
      const p = await parseFitStarts(paramRows, model, modelName, x, y);
      if (p.error) throw new Error(p.error);
      return { p0: p.p0, lower: p.lower, upper: p.upper, ...(p.fixed.some(Boolean) ? { fixed: p.fixed } : {}) };
    };
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
        const yKey = selection.yKeys[0];
        const fitX = ownXKey(dataset, selection.xKey, yKey); // a secondary-X Y fits against its own X
        const x = fitX === null ? level.data.time : level.data.values.map((row) => row[fitX]);
        const y = level.data.values.map((row) => row[yKey]);
        const pairs = dropGapRows(x, y);
        try {
          if (pairs.x.length === 0) throw new Error("no finite pairs");
          results.push(await fitModel({ model: modelName, x: pairs.x, y: pairs.y, ...(await customRequest(pairs.x, pairs.y)) }));
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
    if (!selected) throw new Error(fitSelectionRefusal(dataset, selection.xKey, selection.yKeys, null) ?? "No response column is available to fit.");
    const pairs = dropGapRows(selected.x, selected.y);
    if (pairs.x.length === 0) throw new Error("No finite X/Y pairs are available to fit.");
    const request: Parameters<typeof fitModel>[0] = {
      model: modelName, x: pairs.x, y: pairs.y, ...(await customRequest(pairs.x, pairs.y)),
    };
    if (weightMode === "yerr" || weightMode === "poisson") {
      const keep = pairs.keep.map((index) => selected.analysisRows?.[index] ?? index);
      const weighted = dyForFit(dataset, selected.yKey, weightMode === "poisson"
        ? { mode: "poisson" }
        : { mode: "yerr", errKey: selection.errorKeys[selected.yKey] }, keep);
      if (weighted.dy) {
        request.dy = keep.map((index) => weighted.dy![index]!);
        if (!scaleErrors) request.scale_errors = false;
      }
      if (weighted.issue) warnings.push(weighted.issue);
    } else if (weightMode === "manual" || weightMode === "direct") {
      const what = weightMode === "direct" ? "Direct weighting" : "Manual weighting";
      warnings.push(manualKey === null
        ? `${what} was not configured; this input ran unweighted.`
        : `${what} columns are worksheet-specific; this batch input ran unweighted.`);
    }
    const result = await fitModel(request);
    return { values: [1, 1, ...fitSummaryValues(result, names.length)], warnings };
  }, [manualKey, model, modelName, paramRows, weightMode, scaleErrors, names.length]);

  const xFor = (rows: readonly AnalysisBatchRow[], xChoice: SummaryXChoice) => {
    const byId = new Map(datasets.map((d) => [d.id, d]));
    return summaryX(rows.map((r) => ({ name: r.name, metadata: byId.get(r.datasetId)?.data.metadata, labels: byId.get(r.datasetId)?.data.labels })), xChoice);
  };

  const summarySheet = (ranRows: readonly AnalysisBatchRow[], xChoice: SummaryXChoice) => {
    const run = ran.current ?? { model: modelName, columns };
    // In Library order, not run order: the batch starts with the active
    // worksheet, so selecting b1, b2, b3 with b3 active ran (and listed) b3
    // first — and "parameter against input" plotted the samples out of order.
    const rows = libraryOrder(ranRows, datasets.map((d) => d.id));
    const name = `Curve Fit summary — ${run.model} (${rows.length} worksheet${rows.length === 1 ? "" : "s"})`;
    // Not activated: the batch selection and the plot stay as they are.
    // X per input: its position, or a parameter read off ITS OWN worksheet
    // (blank, and reported, where it has none).
    const x = xFor(rows, xChoice);
    addWorksheetQuietly({ id: nextDatasetId(), name, data: batchSummaryData(rows, run.columns, run.model, x) }, "add curve fit summary worksheet");
    setStatus(`added the worksheet "${name}" to the Library (Undo removes)${summaryXNote(x) ? ` — ${summaryXNote(x)}` : ""}`);
  };

  return <AnalysisBatchControls
    toolId="curvefit"
    label={`Curve Fit (${modelName})`}
    summaryColumns={columns}
    runItem={runItem}
    onSummarySheet={summarySheet}
    afterRun={(ranRows, xChoice) => {
      // The same rows, in the same order, as the summary worksheet.
      const lib = libraryOrder(ranRows, datasets.map((d) => d.id));
      const inputs = inOrder(lib, xFor(lib, xChoice));
      return <FitTableControls
        sourceKey={`batch:${ranRows.map((r) => r.datasetId).join(",")}`}
        stats={["r2", "chiSqRed"]}
        build={(want) => batchFitTable(
          ran.current ? ran.current.columns.slice(6).filter((_, k) => k % 2 === 0) : names,
          batchTableInputs(inputs, ran.current ? (ran.current.columns.length - 6) / 2 : names.length),
          want,
        )}
      />;
    }}
  />;
}
