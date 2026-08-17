// Quick Plot's store action (PR F, plan L0.7). A sibling slice file rather
// than another method on FigureLifecycleSlice -- figureLifecycle.ts sits
// close enough to the general 500-line ceiling (architecture.test.ts) that
// this action would push it over; same "extract a cohesive sibling instead
// of raising the pin" convention store/datasetMeta.ts and store/cellEdit.ts
// already follow.
//
// Guard the dataset exists and passes quickPlotAvailability (fail-closed
// no-op -- false, with a status message -- otherwise: a keystroke/menu race
// must never plot unrecognized data); mint a FRESH figure id; dedupe its
// name against every currently-saved editable figure's name (mirroring the
// window-title dedupe convention, `lib/plotview.ts`'s `dedupeWindowTitle`
// -- two Quick Plots on the same dataset read "Quick Plot — X" / "Quick
// Plot — X (2)", never two indistinguishable rows); APPEND the new
// FigureDocument to editableFigures (never look up an existing document by
// datasetId and overwrite it -- L0.7's "never replace an existing figure"
// is structural, not a policy someone could forget); open it in a fresh
// window.
//
// ONE undo entry for the whole gesture (review fix #4): `createWindow`
// (store/windows.ts) already calls `recordHistory("create window")`
// internally, unconditionally. Calling `quickPlotDataset`'s OWN
// `recordHistory` first (the original shape) meant TWO snapshots landed on
// the stack -- one before anything happened, one after the document existed
// but before the window did -- so a single Undo popped only the more recent
// "create window" entry and left the just-created FigureDocument orphaned
// (in `editableFigures`, in no window) until a SECOND Undo removed it too.
// The fix follows the SAME pattern `openFigureDocInWindow` (store/useApp.ts)
// already uses for its own create-window-then-configure compound gesture:
// call `createWindow` FIRST (its recordHistory is the ONLY one, capturing
// state before window OR document exist), then layer every remaining
// mutation on top via plain `set()` calls with no further `recordHistory`
// -- they ride along in the SAME undo unit for free, because `undo()`
// simply restores the snapshot taken before the first (only) recordHistory
// call, regardless of how many plain `set()`s followed it.
import { createFigureDocument } from "../lib/figureDocument";
import { dedupeWindowTitle } from "../lib/plotview";
import { quickPlotAvailability, quickPlotFigureSeed } from "../lib/quickPlot";
import { nextFigureId } from "./figureLifecycle";
import type { AppState } from "./useApp";
import { withPlotWindowDocument } from "./windowDocuments";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export interface QuickPlotActionSlice {
  /** Create a NEW editable figure from a recognized worksheet and open it in
   *  a fresh window, as ONE undoable gesture. Returns true on success; a
   *  fail-closed no-op (false, with a status message, no history entry, no
   *  new document or window) when the dataset is missing or unrecognized --
   *  see lib/quickPlot.ts's quickPlotAvailability for the exact gate.
   *  Callers gate a stage-return (`onStageOpen`) on the return value: a
   *  refused Quick Plot has nothing to return TO. */
  quickPlotDataset: (datasetId: string) => boolean;
}

export function createQuickPlotActionSlice(set: SliceSet, get: SliceGet): QuickPlotActionSlice {
  return {
    quickPlotDataset: (datasetId) => {
      const state = get();
      const dataset = state.datasets.find((d) => d.id === datasetId);
      if (!dataset) {
        set({ status: "Quick Plot unavailable: dataset not found" });
        return false;
      }
      const availability = quickPlotAvailability(dataset);
      if (!availability.available) {
        set({ status: `Quick Plot unavailable for "${dataset.name}": ${availability.reason}` });
        return false;
      }
      const seed = quickPlotFigureSeed(dataset, state.techniqueViewMemory);
      const name = dedupeWindowTitle(seed.name, state.editableFigures.map((f) => f.name));
      const windowId = state.createWindow(dataset.id, seed.view, name); // the gesture's one recordHistory
      const id = nextFigureId();
      const document = createFigureDocument({ id, name, datasetId: dataset.id, view: seed.view });
      set((current) => ({
        editableFigures: [...current.editableFigures, document],
        plotWindows: current.plotWindows.map((w) =>
          w.id === windowId ? withPlotWindowDocument(w, document) : w,
        ),
        status: `created "${document.name}" from Quick Plot`,
      }));
      get().focusWindow(windowId);
      return true;
    },
  };
}
