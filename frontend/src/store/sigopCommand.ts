import type { SigopParams } from "../lib/transformSigop";
import { runTransform } from "../lib/transformRun";
import { useApp } from "./useApp";

/** Imperative bridge for the lazy Signal Processing filters and Reduce XY: run
 *  the recorded `sigop` transform on `sourceId` (one undo entry, one pipeline
 *  step, the new dataset becomes active). Throws the backend's message on a
 *  refused input; the caller shows it. Resolves false when nothing was made. */
export async function createSigopFromApp(params: SigopParams, sourceId: string): Promise<boolean> {
  return (await runTransform(useApp.getState, params, sourceId)) !== null;
}
