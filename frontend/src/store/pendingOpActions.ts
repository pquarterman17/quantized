// Lazy-only helpers built on the eager pending-operation primitive. Every
// production caller lives behind a workshop/export action, so keeping these
// bodies out of pendingOps.ts avoids charging startup for cancellation and
// polled-job orchestration before the user starts such work.

import { beginOp, endOp, updateOp } from "./pendingOps";

export interface TrackedJob {
  progress(fraction: number, message?: string): void;
  cancellable(cancel: () => void): void;
  end(): void;
}

export function trackJob(label: string): TrackedJob {
  let text = label;
  const id = beginOp(label);
  return {
    progress(fraction, message) {
      const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
      text = `${label} ${pct}%${message ? ` · ${message}` : ""}`;
      updateOp(id, text);
    },
    cancellable(cancel) { updateOp(id, text, cancel); },
    end() { endOp(id); },
  };
}

export async function runCancellable<T>(
  label: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<{ value: T } | null> {
  const controller = new AbortController();
  const id = beginOp(label, () => controller.abort());
  try {
    return { value: await fn(controller.signal) };
  } catch (error) {
    if (controller.signal.aborted) return null;
    throw error;
  } finally {
    endOp(id);
  }
}
