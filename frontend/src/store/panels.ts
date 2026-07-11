// Multi-dataset panel/overlay composite windows (MAIN_PLAN #19 v1): the
// Library's "Panel: side by side/stacked/grid" and "Overlay in one plot"
// quick picks (>=2 selected rows) each open ONE new `kind:"panel"` window
// binding every selected dataset id + the picked layout. Composed into the
// ONE useApp store instance exactly like ./windows/./history/./reductions/
// ./reimport (read windows.ts's header first) — kept in its OWN file rather
// than added to windows.ts because that module sits AT its architecture.test.ts
// size-ratchet pin with zero headroom for a new action; `nextWindowId`/`maxZ`
// are exported from there so this slice places a panel window exactly like
// every other window-creating action does, with one shared id sequence.
//
// Dataset-removal pruning (item 19's "a removed dataset drops out of the
// panel") lives in `lib/plotview.ts`'s `pruneWindowDatasetRefs`, called from
// `store/useApp.ts`'s three removal sites (removeDataset/removeSelected/
// removeDatasets) — this file only builds the window, it never needs to
// prune one.
//
// Drag-to-rearrange follow-up: `reorderPanelDatasets` is the ONE mutation a
// cell-header drag drops into (`components/windows/PanelCell.tsx`); the pure
// splice lives in `lib/panelwindow.reorderPanelDatasetIds` so it's unit-
// testable without a store. `removeFromPanel` is the header ✕ chip's
// mutation, same shape. Neither calls `recordHistory` — window-level
// mutations (geometry, kind, this file's own `createPanelWindow`) aren't
// part of the undo stack, only dataset/library edits are.

import {
  cascadeGeometry,
  dedupeWindowTitle,
  defaultPlotView,
  displayedWindowTitle,
  type PanelLayout,
  type PlotWindow,
} from "../lib/plotview";
import { panelWindowTitle, reorderPanelDatasetIds, removePanelDatasetId } from "../lib/panelwindow";
import type { AppState } from "./useApp";
import { maxZ, nextWindowId } from "./windows";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

// Composite windows default larger than a plain plot window (`cascadeGeometry`'s
// 480x360) — they hold multiple sub-plots (or a merged overlay with a wider
// legend), so a sensible v1 default gives each panel real room immediately.
const PANEL_WIDTH = 760;
const PANEL_HEIGHT = 560;

export interface PanelsSlice {
  /** Open ONE new composite `kind:"panel"` window over `datasetIds` laid out
   *  per `layout` — the Library quick picks' + command-palette entries'
   *  shared entry point. Never focuses it (the caller does, same convention
   *  as `createWindow`); returns the new window's id. A no-op-ish call with
   *  an empty/1-item `datasetIds` still creates a window (the empty/
   *  single-panel placeholder renders instead of nothing) rather than
   *  silently failing — callers gate on ">=2 selected" themselves. */
  createPanelWindow: (datasetIds: string[], layout: PanelLayout) => string;
  /** Reorder-insert one cell within a composite panel window (drag-to-
   *  rearrange follow-up): splices the dataset id at `fromIndex` into
   *  `toIndex`'s slot (see `lib/panelwindow.reorderPanelDatasetIds`). A
   *  missing/non-panel window, a self-drop, or an out-of-range index is a
   *  no-op — never throws, never touches other windows. */
  reorderPanelDatasets: (windowId: string, fromIndex: number, toIndex: number) => void;
  /** Drop one dataset out of a composite panel window (the cell header's ✕
   *  chip) — the window tolerates shrinking down to a single cell or an
   *  empty panel (PanelPlotWindow's placeholder), same as dataset-removal
   *  pruning. A missing window/id is a no-op. */
  removeFromPanel: (windowId: string, datasetId: string) => void;
}

export function createPanelsSlice(set: SliceSet): PanelsSlice {
  return {
    createPanelWindow: (datasetIds, layout) => {
      const id = nextWindowId();
      set((s) => {
        const names = datasetIds
          .map((did) => s.datasets.find((d) => d.id === did)?.name)
          .filter((n): n is string => !!n);
        const title = dedupeWindowTitle(
          panelWindowTitle(layout, names),
          s.plotWindows.map((w) => displayedWindowTitle(w, s.datasets)),
        );
        const win: PlotWindow = {
          id,
          kind: "panel",
          title,
          datasetId: null,
          geometry: { ...cascadeGeometry(s.plotWindows.length), w: PANEL_WIDTH, h: PANEL_HEIGHT },
          z: maxZ(s.plotWindows) + 1,
          winState: "normal",
          view: defaultPlotView(), // unused by a panel window, like the item-17 document kinds
          bg: "theme",
          linkGroup: null, // cross-WINDOW link groups (item 13) are XY-plot-only
          pinned: false, // never a passive-retarget candidate anyway (kind-guarded)
          panel: { datasetIds: [...datasetIds], layout },
        };
        return { plotWindows: [...s.plotWindows, win] };
      });
      return id;
    },
    reorderPanelDatasets: (windowId, fromIndex, toIndex) => {
      set((s) => {
        const win = s.plotWindows.find((w) => w.id === windowId);
        if (!win?.panel) return {};
        const datasetIds = reorderPanelDatasetIds(win.panel.datasetIds, fromIndex, toIndex);
        return {
          plotWindows: s.plotWindows.map((w) =>
            w.id === windowId && w.panel ? { ...w, panel: { ...w.panel, datasetIds } } : w,
          ),
        };
      });
    },
    removeFromPanel: (windowId, datasetId) => {
      set((s) => {
        const win = s.plotWindows.find((w) => w.id === windowId);
        if (!win?.panel) return {};
        const datasetIds = removePanelDatasetId(win.panel.datasetIds, datasetId);
        return {
          plotWindows: s.plotWindows.map((w) =>
            w.id === windowId && w.panel ? { ...w, panel: { ...w.panel, datasetIds } } : w,
          ),
        };
      });
    },
  };
}
