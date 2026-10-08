// Lazy lifecycle actions for durable analysis results. The store's catalog
// fields stay deliberately tiny and eager; result editing/recalculation is
// reached only from lazy code — the result workspace, lib/transformRun.ts, and
// the Library through store/analysisResultLazy.ts. architecture.test.ts's
// DRAGGED_OUT list keeps every static importer off the eager graph.

import { signalAnalysisResult, type AnalysisResult } from "../lib/analysisResult";
import { recomputeDerivedSheet } from "./derivedWorksheets";
import { commitDerivedRecompute } from "./recalcDatasets";
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

const recalculating = new Set<string>();

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
  if (recalculating.has(id)) {
    state.setStatus(`${result.name} is already recalculating`);
    return false;
  }
  recalculating.add(id);
  try {
    const { sheet, shift } = await recomputeDerivedSheet(useApp.getState, output);
    useApp.getState().recordHistory(`recalculate ${result.name}`);
    const before = useApp.getState().status;
    commitDerivedRecompute(useApp.setState, useApp.getState, output, sheet, shift);
    // A row-count guard notice from the commit outranks the success line.
    const status = useApp.getState().status === before ? `recalculated ${result.name}` : useApp.getState().status;
    useApp.setState((s) => ({
      analysisResults: s.analysisResults.map((item) => item.id === id
        ? { ...item, updatedAt: new Date().toISOString() }
        : item),
      status,
    }));
    return true;
  } catch (error) {
    useApp.getState().setStatus(`couldn't recalculate ${result.name}: ${error instanceof Error ? error.message : "unknown error"}`);
    return false;
  } finally {
    recalculating.delete(id);
  }
}
