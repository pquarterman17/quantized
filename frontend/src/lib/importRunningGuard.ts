import { ALREADY_RUNNING_MSG, isImportRunning } from "../store/importBatch";
import { toast } from "../store/toasts";

/** Refuse actions that would replace data or compete with an active import. */
export function rejectIfImportRunning(): boolean {
  if (!isImportRunning()) return false;
  toast(ALREADY_RUNNING_MSG, "danger");
  return true;
}
