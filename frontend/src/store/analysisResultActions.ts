// Lazy lifecycle actions for durable analysis results. The store's catalog
// fields stay deliberately tiny and eager; result editing/recalculation is
// reached only from lazy Library/result-workspace code.

import type { AnalysisResult } from "../lib/analysisResult";
import { useApp } from "./useApp";

export function registerAnalysisResult(result: AnalysisResult): void {
  const current = useApp.getState().analysisResults;
  if (current.some((item) => item.id === result.id)) return;
  useApp.setState({ analysisResults: [...current, result], openAnalysisResultId: result.id });
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

export async function recalculateAnalysisResult(id: string): Promise<boolean> {
  const result = useApp.getState().analysisResults.find((item) => item.id === id);
  const sourceId = result?.sources[0]?.datasetId;
  const outputId = result?.outputs[0]?.datasetId;
  if (!result || !sourceId || !outputId ||
      !useApp.getState().datasets.some((dataset) => dataset.id === sourceId) ||
      !useApp.getState().datasets.some((dataset) => dataset.id === outputId)) return false;
  useApp.setState((state) => ({
    staleDatasets: state.staleDatasets.includes(outputId)
      ? state.staleDatasets
      : [...state.staleDatasets, outputId],
  }));
  try {
    await useApp.getState().recalcNow();
  } catch (error) {
    useApp.setState({ status: `couldn't recalculate ${result.name}: ${error instanceof Error ? error.message : "unknown error"}` });
    return false;
  }
  if (useApp.getState().staleDatasets.includes(outputId)) return false;
  useApp.setState((state) => ({
    analysisResults: state.analysisResults.map((item) => item.id === id
      ? { ...item, updatedAt: new Date().toISOString() }
      : item),
    status: `recalculated ${result.name}`,
  }));
  return true;
}
