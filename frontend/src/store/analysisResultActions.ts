// Lazy lifecycle actions for durable analysis results. Keep static importers
// off the eager graph enforced by architecture.test.ts's DRAGGED_OUT list.

import { signalAnalysisResult, type AnalysisResult } from "../lib/analysisResult";
import { analysisFitTableCsv } from "../lib/analysisFitTable";
import { analysisPeakTableCsv } from "../lib/analysisPeakTable";
import { fitModel } from "../lib/api";
import { listFitModels } from "../lib/api/curvefit";
import { dropGapRows } from "../lib/api/finitePairs";
import { fitBands } from "../lib/api/fitStats";
import { analysisResultTableCsv } from "../lib/analysisResultTable";
import { csvBlob } from "../lib/csvCell";
import { saveBlob } from "../lib/download";
import { stemFromName } from "../lib/exportActive";
import { fullPlottedX } from "../lib/fitselectionActions";
import { liveFitPlotBinding } from "../lib/fitAnalysisResultLive";
import { boundsFromWire } from "../lib/fitBoundsWire";
import { fitOverlayValues, stampRecompute } from "../lib/fitRecompute";
import { fitDataForSpec } from "../lib/fitselection";
import type { Dataset } from "../lib/types";
import { recomputeDerivedSheet } from "./derivedWorksheets";
import { nextAnalysisResultId, nextDatasetId } from "./idSeq";
import { commitDerivedRecompute } from "./recalcDatasets";
import { publishFitAnalysisResult } from "./publishFitAnalysisResult";
import { useApp } from "./useApp";

export function registerAnalysisResult(result: AnalysisResult, open = true): void {
  const current = useApp.getState().analysisResults;
  if (current.some((item) => item.id === result.id)) return;
  useApp.setState({ analysisResults: [...current, result], ...(open ? { openAnalysisResultId: result.id } : {}) });
}

/** The ONE result id for a linked signal output: one result per output, and a
 *  legacy file's migration (lib/analysisResult.ts) mints the same id. */
export const signalResultId = (outputId: string): string => `analysis-${outputId}`;

/** Register the durable result for a signal output `runTransform` just
 *  created — interactive and Pipeline/macro replay alike. Not a separate
 *  history entry: the output's own `addDataset` snapshot precedes it, so one
 *  undo removes both. */
export function registerSignalResult(sourceId: string, outputId: string): void {
  const { datasets } = useApp.getState();
  const source = datasets.find((dataset) => dataset.id === sourceId);
  const output = datasets.find((dataset) => dataset.id === outputId);
  const result = source && output ? signalAnalysisResult(signalResultId(outputId), source, output) : null;
  if (result) registerAnalysisResult(result, false);
}

export function renameAnalysisResult(id: string, name: string): void {
  const next = name.trim();
  const current = useApp.getState().analysisResults.find((result) => result.id === id);
  if (!current || !next || current.name === next) return;
  useApp.getState().recordHistory("rename analysis result");
  useApp.setState((state) => ({
    analysisResults: state.analysisResults.map((result) => result.id === id ? { ...result, name: next } : result),
  }));
}

export function updateAnalysisResultNotes(id: string, notes: string): void {
  const current = useApp.getState().analysisResults.find((result) => result.id === id);
  const next = notes.trim() ? notes : undefined;
  if (!current || current.notes === next) return;
  useApp.getState().recordHistory("edit analysis result notes");
  useApp.setState((state) => ({
    analysisResults: state.analysisResults.map((result) => result.id === id ? { ...result, notes: next } : result),
  }));
}

export function removeAnalysisResult(id: string): void {
  if (!useApp.getState().analysisResults.some((result) => result.id === id)) return;
  useApp.getState().recordHistory("delete analysis result");
  useApp.setState((state) => ({
    analysisResults: state.analysisResults.filter((result) => result.id !== id),
    openAnalysisResultId: state.openAnalysisResultId === id ? null : state.openAnalysisResultId,
    librarySelection: state.librarySelection?.kind === "analysis-result" && state.librarySelection.id === id
      ? null
      : state.librarySelection,
  }));
}

/** Duplicate a single-output result and its linked worksheet as one undoable
 * edit. A second catalog record must never point at the same output: result
 * freshness and recalculation are output-level facts, so sharing one would
 * let the records disagree about the same scientific data. */
export async function duplicateAnalysisResult(id: string, now = new Date().toISOString()): Promise<string | null> {
  const initial = useApp.getState();
  const current = initial.analysisResults.find((result) => result.id === id);
  const outputRef = current?.outputs.length === 1 ? current.outputs[0] : null;
  if (!current || !outputRef) {
    initial.setStatus(`can't duplicate ${current?.name ?? "result"}: one output worksheet is required`);
    return null;
  }
  try {
    await initial.resolveDataset(outputRef.datasetId);
  } catch (error) {
    useApp.getState().setStatus(`can't duplicate ${current.name}: ${error instanceof Error ? error.message : "worksheet loading failed"}`);
    return null;
  }
  const state = useApp.getState();
  const liveResult = state.analysisResults.find((result) => result.id === id);
  const liveOutputRef = liveResult?.outputs.length === 1 ? liveResult.outputs[0] : null;
  const output = liveOutputRef?.datasetId === outputRef.datasetId
    ? state.datasets.find((dataset) => dataset.id === outputRef.datasetId)
    : null;
  if (!liveResult || !output) {
    state.setStatus("can't duplicate analysis result: its output changed while loading");
    return null;
  }
  const outputCopyId = nextDatasetId();
  const outputCopy: Dataset = { ...structuredClone(output), id: outputCopyId, name: `${output.name} (copy)` };
  const copyId = liveResult.producer.id === "signal-processing"
    ? signalResultId(outputCopyId)
    : nextAnalysisResultId();
  const remapOutput = (datasetId: string): string => datasetId === output.id ? outputCopyId : datasetId;
  const copy: AnalysisResult = {
    ...structuredClone(liveResult),
    id: copyId,
    name: `${liveResult.name} copy`,
    outputs: liveResult.outputs.map((ref) => ({ ...ref, datasetId: remapOutput(ref.datasetId) })),
    ...(liveResult.selection ? { selection: { ...structuredClone(liveResult.selection), datasetId: remapOutput(liveResult.selection.datasetId) } } : {}),
    ...(liveResult.settingsRef ? { settingsRef: { ...liveResult.settingsRef, datasetId: remapOutput(liveResult.settingsRef.datasetId) } } : {}),
    ...(liveResult.tableRefs ? { tableRefs: liveResult.tableRefs.map((ref) => ({ ...ref, datasetId: remapOutput(ref.datasetId) })) } : {}),
    ...(liveResult.plotBindings ? { plotBindings: liveResult.plotBindings.map((binding) => ({ ...binding, datasetId: remapOutput(binding.datasetId), channels: [...binding.channels] })) } : {}),
    createdAt: now,
  };
  state.recordHistory("duplicate analysis result");
  useApp.setState((latest) => {
    const outputIndex = latest.datasets.findIndex((dataset) => dataset.id === output.id);
    const datasets = [...latest.datasets];
    datasets.splice(outputIndex < 0 ? datasets.length : outputIndex + 1, 0, outputCopy);
    return {
      datasets,
      analysisResults: [...latest.analysisResults, copy],
      openAnalysisResultId: copyId,
      staleDatasets: latest.staleDatasets.includes(output.id)
        ? [...latest.staleDatasets, outputCopyId]
        : latest.staleDatasets,
      status: `duplicated result ${liveResult.name}`,
    };
  });
  return copyId;
}

/** Freeze a single linked output into an ordinary independent worksheet. */
export function freezeAnalysisResult(id: string): string | null {
  const state = useApp.getState();
  const result = state.analysisResults.find((item) => item.id === id);
  const outputId = result?.outputs.length === 1 ? result.outputs[0].datasetId : null;
  const output = outputId ? state.datasets.find((dataset) => dataset.id === outputId) : null;
  if (!result || !output?.derivedFrom) {
    state.setStatus(`can't freeze ${result?.name ?? "result"}: one linked output worksheet is required`);
    return null;
  }
  const frozenId = state.freezeCopy(output.id);
  if (frozenId) useApp.getState().setStatus(`froze ${result.name} as independent data`);
  return frozenId;
}

/** Resolve and focus one recorded plot binding. Returns null without changing
 * the active plot when the saved binding is missing or no longer valid. */
export interface PreparedAnalysisResultPlot {
  dataset: Dataset;
  channels: number[];
  xChannel?: number | null;
}

/** Resolve and validate a binding without changing the current workspace.
 * Builder callers use this read-only half so Cancel really is a no-op. */
export async function resolveAnalysisResultPlot(id: string, bindingIndex: number): Promise<PreparedAnalysisResultPlot | null> {
  const initial = useApp.getState();
  const result = initial.analysisResults.find((item) => item.id === id);
  const fitDatasetId = result?.settingsRef?.field === "fitSpec" && bindingIndex === 0
    ? result.settingsRef.datasetId
    : null;
  const binding = result?.plotBindings?.[bindingIndex];
  const datasetId = fitDatasetId ?? binding?.datasetId;
  if (!result || !datasetId) {
    initial.setStatus("can't open result figure: the saved plot binding is unavailable");
    return null;
  }
  try {
    await initial.resolveDataset(datasetId);
  } catch (error) {
    useApp.getState().setStatus(`can't open result figure: ${error instanceof Error ? error.message : "worksheet loading failed"}`);
    return null;
  }
  const state = useApp.getState();
  // Re-read after lazy loading so a stale click never
  // opens data the result no longer owns.
  const currentResult = state.analysisResults.find((item) => item.id === id);
  const fitDataset = fitDatasetId ? state.datasets.find((item) => item.id === fitDatasetId) : null;
  if (fitDatasetId) {
    const liveBinding = currentResult && fitDataset ? liveFitPlotBinding(currentResult, fitDataset) : null;
    if (!liveBinding || currentResult?.settingsRef?.datasetId !== fitDatasetId) {
      state.setStatus(`can't open result figure: ${fitDataset && !fitDataset.fitSpec
        ? "the saved fit is missing"
        : fitDataset ? "its live fit channels are unavailable" : "its worksheet is missing"}`);
      return null;
    }
    return { dataset: fitDataset!, channels: liveBinding.channels, xChannel: liveBinding.xChannel };
  }
  if (!binding) {
    state.setStatus("can't open result figure: the saved plot binding is unavailable");
    return null;
  }
  const currentBinding = currentResult?.plotBindings?.[bindingIndex];
  if (!currentBinding || currentBinding.datasetId !== binding.datasetId ||
      currentBinding.xChannel !== binding.xChannel ||
      currentBinding.channels.length !== binding.channels.length ||
      currentBinding.channels.some((channel, index) => channel !== binding.channels[index])) {
    state.setStatus("can't open result figure: the saved plot binding changed while loading");
    return null;
  }
  const dataset = state.datasets.find((item) => item.id === currentBinding.datasetId);
  const channels = dataset
    ? [...new Set(currentBinding.channels)].filter((channel) => Number.isInteger(channel) && channel >= 0 && channel < dataset.data.labels.length)
    : [];
  const xChannel = currentBinding.xChannel;
  const xValid = xChannel === undefined || xChannel === null ||
    (Number.isInteger(xChannel) && xChannel >= 0 && xChannel < (dataset?.data.labels.length ?? 0));
  if (!dataset || channels.length === 0 || !xValid) {
    state.setStatus(`can't open result figure: ${dataset ? "its plotted channels are unavailable" : "its worksheet is missing"}`);
    return null;
  }
  return { dataset, channels, ...(xChannel !== undefined ? { xChannel } : {}) };
}

export async function prepareAnalysisResultPlot(id: string, bindingIndex: number): Promise<PreparedAnalysisResultPlot | null> {
  const prepared = await resolveAnalysisResultPlot(id, bindingIndex);
  if (!prepared) return null;
  let state = useApp.getState();
  const result = state.analysisResults.find((item) => item.id === id);
  const fitDatasetId = result?.settingsRef?.field === "fitSpec" ? result.settingsRef.datasetId : null;
  const fitDataset = fitDatasetId === prepared.dataset.id ? prepared.dataset : null;
  const fitSpec = fitDataset?.fitSpec;
  let fitY: (number | null)[] | null = null;
  if (fitDatasetId && (!fitDataset || !fitSpec)) {
    state.setStatus("can't open fitted plot: the saved fit is missing");
    return null;
  }
  if (fitDataset && fitSpec) {
    if (!fitSpec.params?.length) {
      state.setStatus("can't open fitted plot: the saved fit has no parameter values");
      return null;
    }
    // `null` deliberately means the independent/time axis; unlike `undefined`
    // it must not fall through to the FitSpec channel.
    const savedX = prepared.xChannel !== undefined ? prepared.xChannel : fitSpec.xKey ?? null;
    const xs = fullPlottedX(fitDataset.data, savedX);
    const finite = xs.flatMap((value, index) => Number.isFinite(value) ? [{ value, index }] : []);
    if (!finite.length) {
      state.setStatus("can't open fitted plot: the saved X channel has no finite values");
      return null;
    }
    try {
      const evaluated = await fitBands({
        model: fitSpec.model,
        params: fitSpec.params,
        covar: null,
        x: finite.map((entry) => entry.value),
        n_points: finite.length,
        dof: Math.max(1, (fitSpec.nPoints ?? finite.length) - (fitSpec.nFree ?? fitSpec.params.length)),
      });
      if (!Array.isArray(evaluated.yFit) || evaluated.yFit.length !== finite.length ||
          !evaluated.yFit.every((value) => value === null || (typeof value === "number" && Number.isFinite(value)))) {
        throw new Error("model evaluation returned the wrong number of fitted values");
      }
      fitY = Array.from({ length: xs.length }, () => null);
      finite.forEach((entry, index) => { fitY![entry.index] = evaluated.yFit[index] ?? null; });
    } catch (error) {
      useApp.getState().setStatus(`can't open fitted plot: ${error instanceof Error ? error.message : "model evaluation failed"}`);
      return null;
    }
    state = useApp.getState();
    const current = state.analysisResults.find((item) => item.id === id);
    const currentDataset = state.datasets.find((item) => item.id === fitDataset.id);
    if (current?.settingsRef?.field !== "fitSpec" || current.settingsRef.datasetId !== fitDataset.id ||
        currentDataset?.fitSpec !== fitSpec || currentDataset.data !== fitDataset.data) {
      state.setStatus("can't open fitted plot: the fit changed while its curve was loading");
      return null;
    }
  }
  state.setActive(prepared.dataset.id);
  if (prepared.xChannel !== undefined) state.setXKey(prepared.xChannel);
  state.setYKeys(prepared.channels);
  useApp.setState({
    stageTab: "plot",
    fitOverlay: fitY ? { datasetId: prepared.dataset.id, y: fitY } : null,
  });
  return prepared;
}

/** Use the same prepared binding as Open plot, then hand the live store to
 * the existing report command. Keeping this in the lazy action module avoids
 * an imperative store read in the React component and one more UI/backend
 * behavior fork. */
export async function sendAnalysisResultPlotToReport(id: string, bindingIndex: number): Promise<boolean> {
  if (!await prepareAnalysisResultPlot(id, bindingIndex)) return false;
  try {
    return await import("../commands/plotCommands").then((module) => module.sendFigureToReport(useApp.getState));
  } catch (error) {
    useApp.getState().setStatus(`can't send result figure to report: ${error instanceof Error ? error.message : "report tools failed to load"}`);
    return false;
  }
}

/** Export a recorded table through the same safe browser-download primitives
 * as the focused analysis workshops. */
export async function exportAnalysisResultTable(id: string, datasetId: string): Promise<boolean> {
  const initial = useApp.getState();
  const result = initial.analysisResults.find((item) => item.id === id);
  const ownsTable = result?.tableRefs?.some((table) => table.datasetId === datasetId)
    || result?.outputs.some((output) => output.datasetId === datasetId);
  if (!result || !ownsTable) return false;
  try {
    await initial.resolveDataset(datasetId);
  } catch (error) {
    useApp.getState().setStatus(`can't export ${result.name}: ${error instanceof Error ? error.message : "worksheet loading failed"}`);
    return false;
  }
  const state = useApp.getState();
  const current = state.analysisResults.find((item) => item.id === id);
  const stillOwned = current?.tableRefs?.some((table) => table.datasetId === datasetId)
    || current?.outputs.some((output) => output.datasetId === datasetId);
  if (!current || !stillOwned) {
    state.setStatus("can't export result table: its result changed while loading");
    return false;
  }
  const dataset = state.datasets.find((item) => item.id === datasetId);
  if (!dataset) {
    state.setStatus(`can't export ${current.name}: its table worksheet is missing`);
    return false;
  }
  const filename = stemFromName(`${current.name}-${dataset.name}`).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "") || "analysis-result";
  saveBlob(csvBlob(analysisResultTableCsv(dataset)), `${filename}.csv`);
  state.setStatus(`exported result table ${dataset.name}`);
  return true;
}

/** Export a source-only Peak Analysis result from its live peak-table
 * authority. The envelope owns no copied numbers. */
export function exportAnalysisPeakTable(id: string): boolean {
  const state = useApp.getState();
  const result = state.analysisResults.find((item) => item.id === id);
  const sourceId = result?.settingsRef?.field === "peakTable" ? result.settingsRef.datasetId : null;
  const dataset = sourceId ? state.datasets.find((item) => item.id === sourceId) : null;
  if (!result || !dataset?.peakTable) {
    state.setStatus(`can't export ${result?.name ?? "peak result"}: its fitted peak table is missing`);
    return false;
  }
  const filename = stemFromName(`${result.name}-peaks`).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "") || "peak-analysis";
  saveBlob(csvBlob(analysisPeakTableCsv(dataset.peakTable)), `${filename}.csv`);
  state.setStatus(`exported ${dataset.peakTable.peaks.length} fitted peaks`);
  return true;
}

/** Export the compact parameter table from the live Dataset.fitSpec authority. */
export async function exportAnalysisFitTable(id: string): Promise<boolean> {
  const state = useApp.getState();
  const result = state.analysisResults.find((item) => item.id === id);
  const sourceId = result?.settingsRef?.field === "fitSpec" ? result.settingsRef.datasetId : null;
  const dataset = sourceId ? state.datasets.find((item) => item.id === sourceId) : null;
  const spec = dataset?.fitSpec;
  if (!result || !dataset || !spec) {
    state.setStatus(`can't export ${result?.name ?? "fit result"}: its saved fit is missing`);
    return false;
  }
  let names: string[] = [];
  try {
    names = (await listFitModels()).models.find((model) => model.name === spec.model)?.paramNames ?? [];
  } catch {
    // Offline export remains useful with stable p1..pN fallback names.
  }
  const current = useApp.getState();
  const liveResult = current.analysisResults.find((item) => item.id === id);
  const liveDataset = current.datasets.find((item) => item.id === sourceId);
  if (liveResult?.settingsRef?.field !== "fitSpec" || liveDataset?.fitSpec !== spec) {
    current.setStatus("can't export fit parameters: the fit changed while model metadata was loading");
    return false;
  }
  const filename = stemFromName(`${result.name}-parameters`).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "") || "curve-fit";
  saveBlob(csvBlob(analysisFitTableCsv(spec, names)), `${filename}.csv`);
  current.setStatus(`exported ${spec.params?.length ?? 0} fitted parameters`);
  return true;
}

const recalculatingOutputs = new Set<string>();
const recalculatingFits = new Set<string>();

/** Re-run one durable curve-fit result from its recorded recipe. This updates
 * the Dataset.fitSpec authority in place; it does not rewrite source data or
 * silently recalculate unrelated stale work. */
export async function recalculateFitAnalysisResult(id: string): Promise<boolean> {
  const initial = useApp.getState();
  const result = initial.analysisResults.find((item) => item.id === id);
  const sourceId = result?.settingsRef?.field === "fitSpec" ? result.settingsRef.datasetId : null;
  if (!result || !sourceId) return false;
  if (recalculatingFits.has(sourceId)) {
    initial.setStatus(`${result.name} is already recalculating`);
    return false;
  }
  recalculatingFits.add(sourceId);
  try {
    await initial.resolveDataset(sourceId);
    const state = useApp.getState();
    const liveResult = state.analysisResults.find((item) => item.id === id);
    const source = state.datasets.find((dataset) => dataset.id === sourceId);
    const spec = source?.fitSpec;
    if (liveResult?.settingsRef?.field !== "fitSpec" || liveResult.settingsRef.datasetId !== sourceId || !source || !spec) {
      state.setStatus(`can't recalculate ${result.name}: its source or saved fit is missing`);
      return false;
    }
    if (spec.xKey === undefined || spec.yKey === undefined) {
      throw new Error("the legacy fit does not record exact X/Y channels; use Edit / Re-fit first");
    }
    const selection = fitDataForSpec(source, spec, state.xKey, state.yKeys, state.seriesOrder);
    if (!selection) throw new Error("the saved fit's channels are unavailable");
    const pairs = dropGapRows(selection.x, selection.y);
    if (!pairs.x.length) throw new Error("no finite X/Y pairs are available to fit");
    const dy = selection.dy ? pairs.keep.map((index) => selection.dy![index]!) : undefined;
    const fitted = await fitModel({
      model: spec.model,
      x: pairs.x,
      y: pairs.y,
      ...(dy ? { dy } : {}),
      ...(spec.p0 ? { p0: spec.p0 } : {}),
      ...(spec.lower ? { lower: boundsFromWire(spec.lower, -1) } : {}),
      ...(spec.upper ? { upper: boundsFromWire(spec.upper, 1) } : {}),
      ...(spec.fixed ? { fixed: spec.fixed } : {}),
    });
    if (!Array.isArray(fitted.params) ||
        !fitted.params.every((value) => typeof value === "number" && Number.isFinite(value))) {
      throw new Error("the fitter did not return finite parameter values");
    }
    const current = useApp.getState();
    const currentResult = current.analysisResults.find((item) => item.id === id);
    const currentSource = current.datasets.find((dataset) => dataset.id === sourceId);
    if (currentResult?.settingsRef?.field !== "fitSpec" || currentResult.settingsRef.datasetId !== sourceId ||
        currentSource !== source) {
      current.setStatus(`can't apply recalculation: ${result.name} changed while fitting`);
      return false;
    }
    const overlayWasVisible = current.fitOverlay?.datasetId === sourceId;
    const nextOverlay = overlayWasVisible ? fitOverlayValues(source, pairs, fitted.yFit) : null;
    current.recordHistory(`recalculate ${result.name}`);
    current.setFitSpec(sourceId, stampRecompute(spec, fitted));
    if (overlayWasVisible) useApp.setState({ fitOverlay: nextOverlay ? { datasetId: sourceId, y: nextOverlay } : null });
    publishFitAnalysisResult(sourceId);
    useApp.getState().setStatus(`recalculated ${result.name}`);
    return true;
  } catch (error) {
    useApp.getState().setStatus(`couldn't recalculate ${result.name}: ${error instanceof Error ? error.message : "unknown error"}`);
    return false;
  } finally {
    recalculatingFits.delete(sourceId);
  }
}

/** Recompute THIS result's linked output only — never the project-wide
 *  `recalcNow()`, which would also settle stale datasets and fits the user
 *  kept stale on purpose in manual mode. One undo entry; a second request
 *  while this one runs is reported, not silently dropped. */
export async function recalculateAnalysisResult(id: string): Promise<boolean> {
  const state = useApp.getState();
  const result = state.analysisResults.find((item) => item.id === id);
  if (!result) return false;
  const output = state.datasets.find((dataset) => dataset.id === result.outputs[0]?.datasetId);
  const sourceId = result.sources[0]?.datasetId;
  if (!output?.derivedFrom || !sourceId || !state.datasets.some((dataset) => dataset.id === sourceId)) {
    state.setStatus(`can't recalculate ${result.name}: its source or output worksheet is missing`);
    return false;
  }
  if (recalculatingOutputs.has(output.id)) {
    state.setStatus(`${result.name}'s output is already recalculating`);
    return false;
  }
  recalculatingOutputs.add(output.id);
  try {
    const { sheet, shift } = await recomputeDerivedSheet(useApp.getState, output);
    useApp.getState().recordHistory(`recalculate ${result.name}`);
    const before = useApp.getState().status;
    commitDerivedRecompute(useApp.setState, useApp.getState, output, sheet, shift);
    // A row-count guard notice from the commit outranks the success line.
    const status = useApp.getState().status === before ? `recalculated ${result.name}` : useApp.getState().status;
    useApp.setState((s) => ({
      analysisResults: s.analysisResults.map((item) => item.outputs.some((ref) => ref.datasetId === output.id)
        ? { ...item, updatedAt: new Date().toISOString() }
        : item),
      status,
    }));
    return true;
  } catch (error) {
    useApp.getState().setStatus(`couldn't recalculate ${result.name}: ${error instanceof Error ? error.message : "unknown error"}`);
    return false;
  } finally {
    recalculatingOutputs.delete(output.id);
  }
}
