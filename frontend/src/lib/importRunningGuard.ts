import { ALREADY_RUNNING_MSG, isImportRunning } from "../store/importBatch";
import { toast } from "../store/toasts";

/** Refuse actions that would replace data or compete with an active import. */
export function rejectIfImportRunning(): boolean {
  const running = isImportRunning();
  if (running) toast(ALREADY_RUNNING_MSG, "danger");
  return running;
}

/** Apply the same preflight before a picker or backend read starts. */
export function guardAgainstRunningImport(run: () => void): () => void {
  return () => {
    if (!rejectIfImportRunning()) run();
  };
}
