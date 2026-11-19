// Shared "group these new outputs in a Library folder, offer Overlay these N"
// helper (Baseline batch + Signal Processing "Apply to selected sheets…").
// The folder is created under the sources' common Library folder (root when
// they differ), the outputs are written/moved into it, and the whole gesture
// is ONE undo step (asOneEditStep). The Overlay button itself lives in
// OverlayOutputsButton.tsx.

import { asOneEditStep } from "../../store/undoStep";
import { moveToFolderViaWorkbooks } from "../../store/collapsedWorkbookActions";
import type { Dataset } from "../../lib/types";
import type { AppState } from "../../store/useApp";

/** The Library folder every source sits in, or null (root) when they differ. */
export function commonFolder(s: AppState, sources: readonly Dataset[]): string | null {
  const of = (d: Dataset): string | null =>
    s.workbooks.find((w) => w.id === d.workbookId)?.folderId ?? d.folderId ?? null;
  const first = sources.length ? of(sources[0]) : null;
  return sources.every((d) => of(d) === first) ? first : null;
}

/** Create folder `folderName` next to `sources`, run `make` (which writes the
 *  new outputs and returns their ids, in order — or just returns ids that
 *  already exist), and move those ids into the folder; one undo step. */
export function groupOutputsInFolder(
  get: () => AppState,
  opts: { label: string; folderName: string; sources: readonly Dataset[]; make: () => string[] },
): { ids: string[]; folderId: string } {
  return asOneEditStep(get, opts.label, () => {
    const folderId = get().createFolder(commonFolder(get(), opts.sources), opts.folderName);
    const ids = opts.make();
    moveToFolderViaWorkbooks(ids, folderId);
    return { ids, folderId };
  });
}
