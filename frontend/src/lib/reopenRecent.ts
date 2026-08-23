// Reopening a Recent entry (MAIN_PLAN #31).
//
// Before #31 a Recent click could only re-open the file picker, because the
// entry held a name and nothing else. Entries imported through a native dialog
// now carry a path, so they can reopen their actual target.
//
// The interesting part is what happens when the target is NOT there, and the
// rule is: never be destructive, and never claim more than we know.
//
//   ok       -> import it. The ordinary case.
//   missing  -> the volume is present and the file is not. Offer to LOCATE it
//               (the picker), because re-picking is the useful next step.
//   offline  -> the volume itself is unreachable. Say so and STOP. Do NOT open
//               a picker: the file is probably fine, the share is just not
//               mounted, and shoving a dialog at the user invites them to
//               "fix" a problem that will fix itself. RETRY is clicking again.
//   invalid  -> the stored path cannot be resolved at all; offer Locate.
//   unknown  -> no bridge to ask (any browser). Fall back to the picker, which
//               is exactly the pre-#31 behaviour.

import { pathState } from "./desktopBridge";
import { IMPORT_ACCEPT, openFilePicker } from "./openFilePicker";
import type { RecentFile } from "./recentFiles";

export interface ReopenStore {
  // Promise<unknown> (not <void>) — see ImportEntryStore's identical note
  // in lib/importEntry.ts (R6 F2, POST_SPRINT_INDEPENDENT_REVIEW.md).
  importFiles: (files: File[]) => Promise<unknown>;
  importPaths: (paths: string[]) => Promise<unknown>;
  setStatus: (msg: string) => void;
}

/** What reopening did — returned so the caller (and tests) can tell the
 *  outcomes apart without scraping status text. */
export type ReopenOutcome = "imported" | "located" | "offline" | "picker";

export async function reopenRecent(
  store: ReopenStore,
  entry: RecentFile,
): Promise<ReopenOutcome> {
  if (!entry.path) {
    // A browser-uploaded entry never had a path to remember. Re-picking is the
    // honest best we can do, and the menu says so rather than implying more.
    openFilePicker((files) => void store.importFiles(files), IMPORT_ACCEPT);
    return "picker";
  }

  const state = await pathState(entry.path);
  if (state === "ok") {
    await store.importPaths([entry.path]);
    return "imported";
  }
  if (state === "offline") {
    store.setStatus(
      `${entry.name}: the drive or share is not available right now — reconnect and try again`,
    );
    return "offline";
  }
  if (state === "unknown") {
    // No desktop bridge to ask. Do not guess that the file is gone.
    openFilePicker((files) => void store.importFiles(files), IMPORT_ACCEPT);
    return "picker";
  }
  // missing / invalid: the volume is there but the file is not.
  store.setStatus(`${entry.name}: not found at its saved location — locate it`);
  openFilePicker((files) => void store.importFiles(files), IMPORT_ACCEPT);
  return "located";
}
