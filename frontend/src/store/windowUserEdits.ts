// Does a plot window carry user edits that a PASSIVE rebind would destroy?
// (publication-figures audit B1, 2026-11-13.)
//
// The audit: importing a file, or opening a Library item, rebound the single
// plot window to the new dataset and silently reset everything the user had
// built on it: error columns, the y2 assignment, axis titles, annotations, a
// log axis, reference lines and shades. Origin never does that: each graph
// window is independent, and new data opens in a new graph. The passive entry
// points (`addDataset`, `activateFromLibrary`) now ask `windowHasUserEdits`
// first. A window with edits is protected exactly like a pinned one: the data
// goes to an unedited window, or to a fresh one (`retargetPassiveRebind`). An
// EXPLICIT rebind (dropping a Library row onto a frame, Graph Builder's
// "apply to current") still rebinds, because the user chose it.
//
// "Edited" means: the window's view differs from the view a fresh bind to its
// own dataset would produce (`datasetViewDefaults`, technique defaults
// included), or its document carries axis breaks / encodings / publication
// overrides, or it is a saved editable figure, or the user renamed it.

import { isDefaultWindowTitle } from "../lib/plotWindows";
import { defaultPlotView, snapshotView, type PlotView, type PlotWindow } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import type { AppState } from "./useApp";
import { datasetViewDefaults } from "./windowDefaults";
import { plotWindowDatasetId, plotWindowView } from "./windowDocuments";

/** View fields that are not a user edit: `showGrid` is seeded from a
 *  preference, and the Stat Stage writes its own picks/marks on mount (the
 *  stat MODE itself, `statMode`, is compared). */
const NOT_EDITS: ReadonlySet<string> = new Set(["showGrid", "statMarks", "statPicks"]);

const VIEW_KEYS = Object.keys(defaultPlotView()) as (keyof PlotView)[];

/** JSON with object keys in sorted order, so `{ mode, digits }` built in two
 *  different orders compares equal. (Not lib/canonicalJson: that module is
 *  lazy, and this check runs on every import — eager bundle budget.) */
const sortedJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );

/** True when `view` differs, in any user-editable field, from the view a
 *  fresh bind to `dataset` produces. */
export function viewHasUserEdits(view: PlotView, dataset: Dataset | undefined): boolean {
  const fresh = { ...defaultPlotView(), ...datasetViewDefaults(dataset) };
  return VIEW_KEYS.some((k) => !NOT_EDITS.has(k) && sortedJson(view[k]) !== sortedJson(fresh[k]));
}

/** The view a window shows right now: the live singleton fields for the
 *  focused window (its record is stale while focused), its record otherwise. */
function currentView(s: AppState, win: PlotWindow): PlotView {
  return win.id === s.focusedWindowId ? snapshotView(s) : plotWindowView(win);
}

/** True when a passive rebind of `win` would discard something the user
 *  made. Only plot windows can be edited this way. */
export function windowHasUserEdits(s: AppState, win: PlotWindow): boolean {
  if (win.kind !== "plot") return false;
  const ds = s.datasets.find((d) => d.id === plotWindowDatasetId(win));
  if (viewHasUserEdits(currentView(s, win), ds)) return true;
  const doc = win.document;
  if (doc) {
    const breaks = doc.plot.axisBreaks;
    if (breaks.x.length + breaks.y.length + breaks.y2.length > 0) return true;
    if (doc.bindings.encoding !== undefined || doc.publication !== undefined) return true;
    if (s.editableFigures.some((figure) => figure.id === doc.id)) return true;
  }
  return !isDefaultWindowTitle(win.title, ds?.name);
}

/** True when the focused plot window carries user edits AND shows none of
 *  `datasetIds` — a whole-view open (an Origin graph from the Library) should
 *  then go to a new window instead of replacing that work. Re-opening onto
 *  the window that already shows that data still refreshes it in place. */
export function focusedWindowGuardsAgainst(s: AppState, datasetIds: readonly string[]): boolean {
  const focused = s.plotWindows.find((w) => w.id === s.focusedWindowId);
  if (!focused || !windowHasUserEdits(s, focused)) return false;
  const shown = plotWindowDatasetId(focused);
  return shown === null || !datasetIds.includes(shown);
}
