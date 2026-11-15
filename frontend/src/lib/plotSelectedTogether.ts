// Eager entries for "Plot selected together" (the palette/menu command, the
// Library context menu, import-batch offers, ROI batch) and "Add curve
// from…" / "Layer Contents…": the bodies live in lib/plotSelectedTogetherRun.ts
// and the lazy figure-dialogs chunk, off the eager bundle.

import { openFigureDialog } from "../store/figureDialogs";
import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";
import { onLoadFailure, runLazy } from "./runLazy";

/** Combine `ids` into one live graph, one curve per dataset — see
 *  lib/plotSelectedTogetherRun.ts. A failed chunk load is toasted. */
export function plotSelectedTogether(ids: readonly string[]): Promise<void> {
  return runLazy("Loading overlay…", () => import("./plotSelectedTogetherRun")).then(
    (m) => m.plotSelectedTogether(ids),
    onLoadFailure,
  );
}

/** "Add curve from…" / "Layer Contents…": the focused graph's curves in one
 *  dialog — add from any dataset, remove, reorder, re-bind (gap audit 3 N1,
 *  components/overlays/figuredialogs/LayerContentsDialog.tsx). */
export function openLayerContents(): void {
  const s = useApp.getState();
  if (!s.datasets.some((d) => d.id === s.activeId)) {
    toast("open a graph first, then edit its curves", "danger");
    return;
  }
  openFigureDialog({ kind: "layerContents" });
}
