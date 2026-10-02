// One-shot handoff from the Recipe Library to the Plot Recipe Manager's
// Batch Figure Builder. Both callers are lazy panels, so this module never
// joins application startup state or project persistence.
let queuedDatasetIds: string[] | null = null;

export function queueBatchFigureRequest(datasetIds: readonly string[]): void {
  queuedDatasetIds = [...new Set(datasetIds)];
}

export function takeBatchFigureRequest(): string[] | null {
  const queued = queuedDatasetIds;
  queuedDatasetIds = null;
  return queued;
}
