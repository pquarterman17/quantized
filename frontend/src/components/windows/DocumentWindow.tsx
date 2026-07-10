// Worksheet / map DOCUMENT window content (MULTI_PLOT_PLAN item 17 — full
// Origin-style MDI): mounts the SAME component the stage tab mounts
// (`WorksheetPane` / `MapStage`), LIVE-bound to the window's dataset — fully
// interactive (editing/sorting a worksheet window works; it IS the tab's
// component, not a preview). A null binding (dataset removed, or never
// bound) shows the decision-#4 empty state, mirroring
// `BackgroundPlotWindow`'s — the window is never force-closed.
//
// Known, documented v1 warts (deliberately NOT fixed with item 17 — see the
// plan's Completed entry):
// - The worksheet's plotted-column highlight (`xKey`/`yKeys`) and row
//   `selection` still read the SINGLETON store fields (WorksheetPane's own
//   doc calls this out as its deliberate exception): N worksheet windows
//   SHARE them, so "which columns are plotted" reflects the FOCUSED plot
//   window's view in every sheet window at once.
// - MapStage's gridding/contour settings (`mapMethod`/`mapRes`/`contour*`)
//   are app-wide Inspector state — two map windows share them. Only the
//   dataset binding (and MapStage's local channel picks) are per-window.

import type { Dataset } from "../../lib/types";
import MapStage from "../Stage/MapStage";
import WorksheetPane from "../Stage/worksheet/WorksheetPane";

/** Decision #4's "dataset removed" state. Library clicks never retarget a
 *  document window (they're not passive-rebind candidates), so the only way
 *  back to a live binding is an explicit drop — say so. */
function DocumentEmptyState() {
  return (
    <div
      className="qzk-ds-meta"
      style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}
    >
      No dataset — drag one from the Library onto this window
    </div>
  );
}

export function WorksheetWindow({ dataset }: { dataset: Dataset | null }) {
  if (!dataset) return <DocumentEmptyState />;
  return <WorksheetPane datasetId={dataset.id} />;
}

export function MapWindow({ dataset }: { dataset: Dataset | null }) {
  if (!dataset) return <DocumentEmptyState />;
  return <MapStage dataset={dataset} />;
}
