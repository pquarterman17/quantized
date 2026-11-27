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
import { rejectIfImportRunning } from "./importRunningGuard";
import { onLoadFailure, runLazy } from "./runLazy";

export interface ImportEntryStore {
  // Promise<unknown> (not <void>): the real store actions now resolve with
  // the created dataset ids (R6 F2, POST_SPRINT_INDEPENDENT_REVIEW.md) —
  // this structural interface only ever awaits them, never reads the
  // result, so it stays permissive rather than re-narrowing the real type.
  importFiles: (files: File[]) => Promise<unknown>;
  importPaths: (paths: string[]) => Promise<unknown>;
}

/** What a chooser hands back: browser `File`s, or native filesystem paths. */
export type ImportPick = { files: File[] } | { paths: string[] };

/** Either shape of a pick (a bare `File[]` is the browser form), as two optionals. */
export function splitPick(pick: ImportPick | File[]): { files?: File[]; paths?: string[] } {
  return Array.isArray(pick) ? { files: pick } : pick;
}

/** Open the best available file chooser and hand what comes back to `onPick`.
 *  Every Import command picks through here, so the native-vs-browser decision,
 *  the remembered working folder and the accept filter are made once.
 *
 *  `accept` applies to the browser picker only — the native dialog carries its
 *  own filter list (quantized/desktop_bridge.IMPORT_FILE_TYPES). A native
 *  cancel never reaches `onPick`; a browser cancel arrives as `{ files: [] }`. */
export async function chooseImportSources(
  onPick: (pick: ImportPick) => unknown,
  accept: string = IMPORT_ACCEPT,
): Promise<void> {
  if (hasDesktopShell()) {
    const working = await runLazy("Loading working folders…", () =>
      import("../store/workingPaths"),
    ).then((module) => module.useWorkingPaths, onLoadFailure);
    if (!working) return;
    // MAIN #31: open where the user already works. This is the half that
    // actually removes the pain of a long network path — a native dialog
    // only fixes picking a file ONCE; starting in the right folder is what
    // makes the second and tenth time fast.
    const paths = await pickNativeFiles(working.getState().current || undefined);
    if (paths !== null) {
      // Includes the empty (cancelled) case — deliberately NOT a fallback.
      if (paths.length > 0) {
        await onPick({ paths });
        // Remember the folder they actually picked from, so it floats to
        // the top of the working-path list next time.
        const dir = parentDirectory(paths[0]);
        if (dir) working.getState().use(dir);
      }
      return;
    }
    // null = the bridge is present but unusable (no window attached yet, or it
    // errored). Fall through rather than leaving the user with no dialog at all.
  }
  openFilePicker((files) => void onPick({ files }), accept);
}

/** Open the best available file chooser and import what comes back. */
export function chooseAndImport(
  store: ImportEntryStore,
  accept: string = IMPORT_ACCEPT,
): Promise<void> {
  return chooseImportSources(
    (pick) => ("paths" in pick ? store.importPaths(pick.paths) : store.importFiles(pick.files)),
    accept,
  );
}

/** The ONE "Import data..." action: Ctrl/Cmd+O, the palette, the menu, the
 *  welcome card and the Library button all call this, so they share the
 *  in-flight guard, the native/remembered-folder routing and the accept filter. */
export function runImportEntry(store: ImportEntryStore): Promise<void> {
  if (rejectIfImportRunning()) return Promise.resolve();
  return chooseAndImport(store);
}

/** Basename of a native path, tolerant of either separator — the
 *  complementary half of `parentDirectory`; shared by the open, save, and
 *  reopen flows (was three private copies until the P1.1 self-review). */
export function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf(String.fromCharCode(92)));
  return cut >= 0 ? path.slice(cut + 1) : path;
}

/** Directory holding `path`, or "" when it has no separator. Kept here rather
 *  than reaching for a node path module — this runs in the browser. */
export function parentDirectory(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf(String.fromCharCode(92)));
  return cut > 0 ? path.slice(0, cut) : "";
}
