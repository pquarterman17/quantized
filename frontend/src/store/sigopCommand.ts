import type { SigopParams } from "../lib/transformSigop";
import { commitTransformOutput } from "./commitTransformOutput";
import { toast } from "./toasts";
import { useApp } from "./useApp";

/** Imperative bridge for the lazy Signal Processing filters and Reduce XY: run
 *  the recorded `sigop` transform on `sourceId` (one undo entry, one pipeline
 *  step, the new dataset becomes active). Throws the backend's message on a
 *  refused input; the caller shows it. Resolves false when nothing was made.
 *  `signal` (Cancel): an abort before the output is added writes nothing. */
export async function createSigopFromApp(params: SigopParams, sourceId: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const out = await commitTransformOutput(useApp.getState, params, sourceId, undefined, signal);
    // An identical output is already there: say so (the commit also set the status line).
    if (out?.existing) toast(`${out.name} is already added; nothing was duplicated`, "ok");
    return out !== null;
  } catch (e) {
    if (!signal?.aborted) throw e;
    useApp.getState().setStatus("cancelled — nothing was created");
    return false;
  }
}
