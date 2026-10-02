// Shared coordinator for modest, client-side scientific batches. It runs
// sequentially so a large selection cannot flood the API or browser, isolates
// each item's failure, reports deterministic progress, and honours Stop after
// the current item. The worker owns scientific validation and commits.

export interface BatchItem {
  id: string;
  name: string;
}

export interface BatchProgress {
  done: number;
  total: number;
  current: string | null;
}

export type BatchResult<T> =
  | { item: BatchItem; status: "created"; value: T }
  | { item: BatchItem; status: "failed"; reason: string }
  | { item: BatchItem; status: "stopped" };

export interface SequentialBatchOptions {
  signal?: AbortSignal;
  onProgress?: (progress: BatchProgress) => void;
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : "processing failed";

/** Run every item in order. A stop never interrupts an item halfway through;
 * it marks all not-yet-started items stopped, leaving completed work valid. */
export async function runSequentialBatch<T>(
  items: readonly BatchItem[],
  worker: (item: BatchItem) => Promise<T>,
  options: SequentialBatchOptions = {},
): Promise<BatchResult<T>[]> {
  const results: BatchResult<T>[] = [];
  let completed = 0;
  const progress = (done: number, current: string | null) =>
    options.onProgress?.({ done, total: items.length, current });
  progress(0, null);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (options.signal?.aborted) {
      results.push(...items.slice(i).map((rest): BatchResult<T> => ({ item: rest, status: "stopped" })));
      break;
    }
    progress(i, item.name);
    try {
      results.push({ item, status: "created", value: await worker(item) });
    } catch (error) {
      results.push({ item, status: "failed", reason: reasonOf(error) });
    }
    completed += 1;
    progress(completed, null);
  }
  progress(completed, null);
  return results;
}
