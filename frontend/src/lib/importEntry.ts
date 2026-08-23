// The single "let the user choose files, then import them" entry point
// (MAIN_PLAN #31).
//
// Every Open affordance — the Library toolbar button, File ▸ Open, the command
// palette — used to call `openFilePicker` directly, which means every one of
// them would have needed the desktop branch bolted on separately. They go
// through here instead, so the native-vs-browser decision is made in ONE place
// and cannot drift between entry points.
//
// The branch: a desktop shell that can pick files gets a NATIVE dialog, whose
// paths import through `/api/parsers/import` and yield datasets carrying
// `source.path` (so re-import never re-asks). Anything else — every browser tab
// — falls back to the `<input type=file>` picker exactly as before.
//
// Cancelling is not a fallback trigger. `pickNativeFiles` returns `null` for
// "no usable bridge" and `[]` for "the user cancelled", and conflating those
// would pop the browser picker in the face of someone who just backed out of
// the native one.

import { hasDesktopShell, pickNativeFiles } from "./desktopBridge";
import { IMPORT_ACCEPT, openFilePicker } from "./openFilePicker";
import { useWorkingPaths } from "../store/workingPaths";

export interface ImportEntryStore {
  // Promise<unknown> (not <void>): the real store actions now resolve with
  // the created dataset ids (R6 F2, POST_SPRINT_INDEPENDENT_REVIEW.md) —
  // this structural interface only ever awaits them, never reads the
  // result, so it stays permissive rather than re-narrowing the real type.
  importFiles: (files: File[]) => Promise<unknown>;
  importPaths: (paths: string[]) => Promise<unknown>;
}

/** Open the best available file chooser and import what comes back.
 *
 *  `accept` applies to the browser picker only — the native dialog carries its
 *  own filter list (quantized/desktop_bridge.IMPORT_FILE_TYPES). */
export async function chooseAndImport(
  store: ImportEntryStore,
  accept: string = IMPORT_ACCEPT,
): Promise<void> {
  if (hasDesktopShell()) {
    // MAIN #31: open where the user already works. This is the half that
    // actually removes the pain of a long network path — a native dialog
    // only fixes picking a file ONCE; starting in the right folder is what
    // makes the second and tenth time fast.
    const paths = await pickNativeFiles(useWorkingPaths.getState().current || undefined);
    if (paths !== null) {
      // Includes the empty (cancelled) case — deliberately NOT a fallback.
      if (paths.length > 0) {
        await store.importPaths(paths);
        // Remember the folder they actually picked from, so it floats to
        // the top of the working-path list next time.
        const dir = parentDirectory(paths[0]);
        if (dir) useWorkingPaths.getState().use(dir);
      }
      return;
    }
    // null = the bridge is present but unusable (no window attached yet, or it
    // errored). Fall through rather than leaving the user with no dialog at all.
  }
  openFilePicker((files) => void store.importFiles(files), accept);
}

/** Directory holding `path`, or "" when it has no separator. Kept here rather
 *  than reaching for a node path module — this runs in the browser. */
export function parentDirectory(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf(String.fromCharCode(92)));
  return cut > 0 ? path.slice(0, cut) : "";
}
