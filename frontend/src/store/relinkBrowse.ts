// The C1 "Browse…" consent gesture, extracted from store/relink.ts under
// the general 500-line module ceiling (architecture.test.ts, RSM_CUTS_PLAN
// #20) — the one store action whose whole job is the native-folder-picker
// grant lifecycle, so it splits cohesively. See store/relink.ts's header
// for the full C1 ruling (why only a real dialog return may ever set
// `newRootConsented`, and the three revocation points).

import { CANCELLED, pickRelinkDirectory, revokeRelinkDir } from "../lib/desktopBridge";
import { toast } from "./toasts";

/** The slice of RelinkState `browseForNewRoot` reads and writes — kept as a
 *  structural type so this module needs no import from store/relink.ts
 *  (which imports HERE; a type import back the other way would be a cycle
 *  in module terms even if erased at runtime). */
interface BrowseSlice {
  open: boolean;
  oldRoot: string;
  newRoot: string;
  newRootConsented: boolean;
  preview: unknown[];
}

/** C1: the ONLY way `newRootConsented` becomes true — a real dialog return
 *  (`pickRelinkDirectory`), never a typed path. */
export async function browseForNewRoot(
  get: () => BrowseSlice,
  set: (partial: { newRoot: string; preview: never[]; newRootConsented: boolean }) => void,
): Promise<void> {
  // Start the picker where the user already is — the typed new root if
  // any, else the old root — instead of the backend's cwd (review F6).
  const at = get();
  const picked = await pickRelinkDirectory(at.newRoot.trim() || at.oldRoot.trim() || undefined);
  if (picked === null) return toast("no desktop bridge — type the folder path instead", "info");
  if (picked === CANCELLED) return; // session cancellation: no state change
  if (typeof picked !== "string") {
    // A real post-pick failure (review F2): the user acted — say why
    // nothing happened rather than swallowing it as a cancel.
    return toast(`folder picker failed — ${picked.error}`, "danger");
  }
  if (!get().open) {
    // The pick resolved AFTER the panel closed (a non-modal native dialog
    // — review F3): the backend grant was already minted, and closePanel's
    // revoke ran before it existed, so revoke it NOW — a grant must never
    // outlive the relink session that asked for it.
    void revokeRelinkDir();
    return;
  }
  set({ newRoot: picked, preview: [], newRootConsented: true });
}
