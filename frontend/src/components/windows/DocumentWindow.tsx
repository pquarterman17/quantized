// Worksheet / map DOCUMENT window content (MULTI_PLOT_PLAN item 17 — full
// Origin-style MDI): mounts the SAME component the stage tab mounts
// (`WorksheetPane` / `MapStage`), LIVE-bound to the window's dataset — fully
// interactive (editing/sorting a worksheet window works; it IS the tab's
// component, not a preview). A null binding (dataset removed, or never
// bound) shows the decision-#4 empty state, mirroring
// `BackgroundPlotWindow`'s — the window is never force-closed.
//
// GUI_INTERACTION #14 (fixed the item-17 v1 wart this used to document here):
// `WorksheetWindow` passes its OWN `windowId` down to `WorksheetPane`, which
// gives every worksheet document window an independent row selection (never
// shared with another window, even on the same dataset) — see
// useWorksheetView's doc for the full contract and the "Linked to plot"
// badge. MapStage's gridding/contour settings remain app-wide Inspector
// state — two map windows still share them; only the dataset binding (and
// MapStage's local channel picks) are per-window.

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

export function WorksheetWindow({ dataset, windowId }: { dataset: Dataset | null; windowId: string }) {
  if (!dataset) return <DocumentEmptyState />;
  return <WorksheetPane datasetId={dataset.id} windowId={windowId} />;
}

export function MapWindow({ dataset }: { dataset: Dataset | null }) {
  if (!dataset) return <DocumentEmptyState />;
  return <MapStage dataset={dataset} />;
}
