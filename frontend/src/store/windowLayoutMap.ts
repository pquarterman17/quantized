// Map as a plot type in a plot window (WORKSPACE_LAYOUT_PLAN P5). In windows
// mode a request for the classic Map stage tab opens the active dataset's MAP
// WINDOW instead: a plot-family window (`kind: "map"`, the classic item-17
// document window) whose body is MapStage, with the Map toolbar on the plot.
// Lazy: only the window-layout host (components/workshops/windowlayout/
// stageTabAdapter.ts) imports it.

import { canRenderMap, ensureMapGate } from "../lib/mapdata";
import { float } from "../lib/windowLayout/ops";
import { plotRef } from "../lib/windowLayout/refs";
import { SMALL_SCREEN_PX } from "../lib/windowLayout/seed";
import { useApp } from "./useApp";
import { applyLayout, reopenRef } from "./windowLayoutActions";

/** Why a map request opened nothing. */
export const NOT_A_MAP = "No map window was opened: this dataset cannot be drawn as a 2-D map, or the check for one did not load (try again).";
/** Why a map request with no active dataset opened nothing. */
export const NO_DATASET = "No map window was opened: no dataset is active. Click a 2-D map dataset in the Library first.";

export type MapWindowResult = { id: string; name: string; existed: boolean } | { refused: string } | null;

/** Open the active dataset's map window, or bring its open one forward:
 *  - one already bound to the dataset comes forward (a minimized one is restored);
 *  - otherwise one is created, docked in the centre beside the other centre
 *    windows, or FLOATING on a screen under SMALL_SCREEN_PX (owner decision D6);
 *  - a dataset that cannot be drawn as a map (the classic Map tab's own rule,
 *    lib/mapdata canRenderMap) opens nothing and the status line says why.
 *  Null when the dataset went away while the grid test loaded. */
export async function openActiveMapWindow(): Promise<MapWindowResult> {
  const datasetId = useApp.getState().activeId;
  const ds = datasetId ? useApp.getState().datasets.find((d) => d.id === datasetId) : undefined;
  if (!ds) {
    useApp.getState().setStatus(NO_DATASET, "warn");
    return { refused: NO_DATASET };
  }
  await ensureMapGate(ds.data); // lazy, memoised grid test (fail closed until it lands)
  const s = useApp.getState();
  const live = s.datasets.find((d) => d.id === ds.id);
  if (!live) return null;
  if (!canRenderMap(live.data)) {
    s.setStatus(NOT_A_MAP, "warn");
    return { refused: NOT_A_MAP };
  }
  const existing = s.plotWindows.find((w) => w.kind === "map" && w.datasetId === live.id);
  const id = existing?.id ?? s.createDocumentWindow("map", live.id);
  const ref = plotRef(id);
  if (!existing && typeof window !== "undefined" && window.innerWidth < SMALL_SCREEN_PX) applyLayout((l) => float(l, ref));
  else reopenRef(ref);
  useApp.getState().raiseWindow(id);
  return { id, name: live.name, existed: existing !== undefined };
}
