// The one warning for a refused browser-storage write (quota full, storage
// blocked). The change still lands for this session; the user just has to know
// it won't be there after a reload (silent-failure audit 2026-10-01).

import { toast } from "../store/toasts";

/** Toast that `what` (e.g. "analysis template") was not saved to storage. */
export function warnStorageRefused(what: string): void {
  toast(`Browser storage refused the ${what} change (full or blocked), so it won't survive a reload.`, "danger");
}
