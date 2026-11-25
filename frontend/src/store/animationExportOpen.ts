// "Export animation…" open/closed handshake. One window (the existing
// AnimationExportDialog), two entry points: File > Export (the
// `export-animation` command) and the Recipe library's button. A standalone
// store, like store/recipeManager.ts, so neither caller owns the dialog.

import { create } from "zustand";

import { toast } from "./toasts";
import { useApp } from "./useApp";

/** The dataset ids the dialog starts with ticked; null while it is closed. */
export const useAnimationExport = create<{ seeds: string[] | null }>(() => ({ seeds: null }));

/** The seed expansion lives in store/batchFigureBuild (recipe schemas and all), which must stay out of the
 *  eager bundle (architecture.test.ts lazy seams), so it loads on the first open. */
export async function openAnimationExport(): Promise<void> {
  let batchSeedDatasetIds: typeof import("./batchFigureBuild").batchSeedDatasetIds;
  try {
    ({ batchSeedDatasetIds } = await import("./batchFigureBuild"));
  } catch {
    toast("Could not load Export animation (reload to retry).", "danger");
    return;
  }
  const s = useApp.getState();
  const seeds = batchSeedDatasetIds({
    datasets: s.datasets,
    folders: s.folders,
    workbooks: s.workbooks,
    selectedIds: s.selectedIds,
    activeId: s.activeId,
    librarySelection: s.librarySelection,
  });
  useAnimationExport.setState({ seeds });
}

export function closeAnimationExport(): void {
  useAnimationExport.setState({ seeds: null });
}
