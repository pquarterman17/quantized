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
  | { item: BatchItem; status: "skipped"; reason: string }
  | { item: BatchItem; status: "stopped" };

/** Thrown by a worker for an item deliberately not processed (the user
 *  declined its review) — reported as "skipped", never as a failure. */
export class BatchSkip extends Error {}

export interface SequentialBatchOptions {
  signal?: AbortSignal;
  onProgress?: (progress: BatchProgress) => void;
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : "processing failed";

const isAbort = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";

/** Run every item in order. A stop marks all not-yet-started items stopped,
 * leaving completed work valid. A worker that honours the signal and throws an
 * AbortError after the stop is "stopped" too (nothing of it was created); a
 * worker that ignores the signal simply finishes its item. */
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
      if (options.signal?.aborted && isAbort(error)) {
        results.push(...items.slice(i).map((rest): BatchResult<T> => ({ item: rest, status: "stopped" })));
        break;
      }
      results.push(
        error instanceof BatchSkip
          ? { item, status: "skipped", reason: error.message }
          : { item, status: "failed", reason: reasonOf(error) },
      );
    }
    completed += 1;
    progress(completed, null);
  }
  progress(completed, null);
  return results;
}
