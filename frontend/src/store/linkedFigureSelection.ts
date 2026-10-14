import { useApp } from "./useApp";

/** Set the shared worksheet brush from a frozen result figure without
 * rebinding the focused plot. This action is lazy with that specialized UI. */
export function setLinkedFigureSourceSelection(datasetId: string, rows: readonly number[]): void {
  const state = useApp.getState();
  const dataset = state.datasets.find((candidate) => candidate.id === datasetId);
  if (!dataset) return;
  const clean = [...new Set(rows)]
    .filter((row) => Number.isInteger(row) && row >= 0 && row < dataset.data.time.length)
    .sort((a, b) => a - b);
  useApp.setState({ selection: clean.length ? { datasetId, rows: clean } : null });
}
