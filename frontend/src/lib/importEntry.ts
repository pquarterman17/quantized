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

export interface ImportEntryStore {
  importFiles: (files: File[]) => Promise<void>;
  importPaths: (paths: string[]) => Promise<void>;
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
    const paths = await pickNativeFiles();
    if (paths !== null) {
      // Includes the empty (cancelled) case — deliberately NOT a fallback.
      if (paths.length > 0) await store.importPaths(paths);
      return;
    }
    // null = the bridge is present but unusable (no window attached yet, or it
    // errored). Fall through rather than leaving the user with no dialog at all.
  }
  openFilePicker((files) => void store.importFiles(files), accept);
}
