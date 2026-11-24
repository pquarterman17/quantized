// The bootstrap's job-queue transport (`POST /bootstrap/job`, the same numbers
// as `/bootstrap`), split from lib/api/curvefit.ts so it stays out of the
// eager bundle. `signal` cancels the SERVER's run, not just the wait, and an
// answer that raced the cancel is discarded (AbortError), never returned.

import { cancelJob, JobCancelledError, pollJob, type JobStatus } from "../jobs";
import { bootstrapCap, bootstrapCapMessage } from "../fitPrefs";
import { postJSON } from "./http";
import type { BootstrapRequest, BootstrapResult } from "./curvefit";

export async function bootstrapJob(
  req: BootstrapRequest,
  signal?: AbortSignal,
  onProgress?: (fraction: number, message: string, status?: JobStatus) => void,
): Promise<BootstrapResult> {
  // Owner decision 2026-11-24: the cap is the user's Preferences ▸ Fitting setting.
  const cap = bootstrapCap();
  if (req.n_boot !== undefined && req.n_boot > cap) throw new Error(bootstrapCapMessage(cap));
  const aborted = (): DOMException => new DOMException("aborted", "AbortError");
  // The submit is not abortable on purpose: aborting it could orphan a job whose id we never saw.
  const { job_id } = await postJSON<{ job_id: string }>("/api/fitting/bootstrap/job", req);
  const cancel = (): void => void cancelJob(job_id).catch(() => undefined);
  if (signal?.aborted) {
    cancel();
    throw aborted();
  }
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const result = await pollJob<BootstrapResult>(job_id, onProgress, 400);
    if (signal?.aborted) throw aborted();
    return result;
  } catch (e) {
    if (e instanceof JobCancelledError) throw aborted();
    throw e;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
