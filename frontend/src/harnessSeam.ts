// The visual-verification seam (see the note in main.tsx): LAZY, imported only
// under `?harness`, so it adds nothing to the eager bundle.

import { spatialPanelsOf } from "./lib/composition";
import { requestDatasetRemoval } from "./lib/datasetRemoval";
import { defaultPlotView } from "./lib/plotview";
import type { PlotView, PlotWindow, WindowGeometry, WinState } from "./lib/plotview";
import type { Dataset } from "./lib/types";
import { useApp } from "./store/useApp";

/** One window of a multi-window (MDI) harness shot (MULTI_PLOT_PLAN item 16). */
interface HarnessWindowSpec {
  /** Index into the shot-level `datasets` list. */
  dataset: number;
  /** Partial view overrides — the same vocabulary as a single-window shot's
   *  `state` (`yKeys`, `plotTitle`, `yScale`, …), merged over a fresh view. */
  view?: Partial<PlotView>;
  geometry?: WindowGeometry;
  winState?: WinState;
  title?: string;
}

/** Reset the window canvas to the store's startup shape (one maximized
 *  window, bound to nothing) so successive harness shots never inherit a
 *  previous shot's MDI layout. Mirrors the store's own `mainWindow` record. */
function harnessResetWindows(): void {
  const win: PlotWindow = {
    id: "harness-main",
    kind: "plot",
    title: "",
    datasetId: null,
    geometry: { x: 40, y: 40, w: 480, h: 360 },
    z: 0,
    winState: "maximized",
    view: defaultPlotView(),
    bg: "theme",
    linkGroup: null,
    pinned: false,
  };
  useApp.setState({ plotWindows: [win], focusedWindowId: win.id });
}

/** Build a shot's MDI layout through the REAL store actions (addDataset →
 *  createWindow → moveWindow/resizeWindow → focusWindow → minimizeWindow /
 *  toggleMaximizeWindow) so the harness exercises the same code paths a user
 *  does — never raw `setState` window records. `focusedIndex` defaults to the
 *  last non-minimized window (the natural top of a fresh MDI stack). */
function harnessApplyWindows(
  datasets: Dataset[],
  windows: HarnessWindowSpec[],
  focusedIndex?: number,
): void {
  for (const ds of datasets) useApp.getState().addDataset(ds);
  const baseline = useApp.getState().plotWindows.map((w) => w.id);
  const ids = windows.map((spec) => {
    const ds = datasets[spec.dataset];
    // Explicit title (spec's, else the dataset name): the interim pre-shot
    // window below is still in `plotWindows` here, and `addDataset` rebound it
    // to the last dataset — letting createWindow COMPUTE a title would dedupe
    // against that transient ("Foo (2)"), a harness artifact no user sees.
    const id = useApp
      .getState()
      .createWindow(ds ? ds.id : null, { ...defaultPlotView(), ...spec.view }, spec.title ?? ds?.name);
    if (spec.geometry) {
      useApp.getState().moveWindow(id, spec.geometry.x, spec.geometry.y);
      useApp.getState().resizeWindow(id, spec.geometry.w, spec.geometry.h);
    }
    return id;
  });
  // Retire the pre-shot window(s): the described layout is the WHOLE canvas.
  for (const id of baseline) useApp.getState().closeWindow(id);
  const lastVisible = windows.reduce((acc, w, i) => (w.winState === "minimized" ? acc : i), 0);
  const focusId = ids[focusedIndex ?? lastVisible];
  if (focusId) useApp.getState().focusWindow(focusId);
  windows.forEach((spec, i) => {
    if (spec.winState === "minimized") useApp.getState().minimizeWindow(ids[i]);
    else if (spec.winState === "maximized") useApp.getState().toggleMaximizeWindow(ids[i]);
  });
}

(
    window as unknown as {
      __qz: {
        useApp: typeof useApp;
        harnessResetWindows: typeof harnessResetWindows;
        harnessApplyWindows: typeof harnessApplyWindows;
        // Real store accessor (`lib/composition.ts`), exposed so the visual
        // harness reads the ONE discriminated-union `composition` field the
        // app itself renders from, instead of re-deriving its shape (the
        // pre-`composition` store had a raw `spatialPanels` array; the
        // harness kept reading that stale field name after the #54 refactor
        // collapsed it into `composition`, silently misclassifying every
        // spatial-multi-panel apply as "single" in the structural report).
        spatialPanelsOf: typeof spatialPanelsOf;
        // The app's one dataset-removal request path (confirm, remove, toast),
        // so `modal-inert.spec` can raise a toast or a confirm WHILE a dialog
        // is open: since R15 the Delete key no longer reaches it from there.
        requestDatasetRemoval: typeof requestDatasetRemoval;
      };
    }
  ).__qz = { useApp, harnessResetWindows, harnessApplyWindows, spatialPanelsOf, requestDatasetRemoval };
