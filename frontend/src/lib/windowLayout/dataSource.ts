// Which dataset the Data window shows (WORKSPACE_LAYOUT_PLAN P3, D8/D14).
// Pure: the caller passes the store fields it read.
//
// - Following the focused plot (the default): the plot's dataset. A live
//   multi-dataset graph (`Dataset.linkedCurves`) has several inputs, the graph
//   sheet itself and each source it plots, and the window shows the chosen
//   one with a switcher between them (D14).
// - Following the Library selection (the Preferences setting): the Library's
//   worksheet (an Origin book's worksheet click) while that row is still
//   selected, else the last selected row in the Library's order, else the
//   active dataset.
// - Pinned: that one dataset, whatever is focused or selected. A pin to a
//   dataset that is gone fails closed: the window says so and offers Unpin,
//   never a grid of some other dataset (the pin is kept, so an undo of the
//   delete brings the grid back).

import type { Dataset } from "../types";
import type { DataFollow, WindowLayoutV1 } from "./types";

export type DataMode = "plot" | "library" | "pinned";

export type DataSource =
  /** Show `datasetId`; `inputs` (two or more) means the switcher is shown. */
  | { kind: "dataset"; mode: DataMode; datasetId: string; inputs: string[] }
  /** Nothing to show, and a one-sentence reason why. */
  | { kind: "none"; mode: DataMode; reason: string }
  /** Pinned to a dataset that no longer exists. */
  | { kind: "missing"; mode: "pinned"; pinned: string; reason: string };

export interface DataSourceInput {
  data: DataFollow;
  datasets: readonly Dataset[];
  /** The focused plot window's dataset (the store's `activeId` while a plot
   *  window holds focus), or null. */
  plotDatasetId: string | null;
  /** The Library's selection fields. */
  library: { worksheetId: string | null; selectedIds: readonly string[]; activeId: string | null };
  /** The switcher's last pick, when it is still one of the inputs. */
  chosen: string | null;
}

export const PINNED_GONE = "The pinned dataset was removed, so there is nothing to show until you unpin the window.";
const NO_PLOT_DATA = "The focused plot shows no dataset; pick one in the Library or focus another plot.";
const NO_LIBRARY = "Nothing is selected in the Library; click a dataset there to show its data.";

/** A plot's inputs: the dataset itself, then each live source a multi-dataset
 *  graph plots (first-curve order, each once, only those that still exist). */
export function plotInputs(id: string, datasets: readonly Dataset[]): string[] {
  const ds = datasets.find((d) => d.id === id);
  if (!ds?.linkedCurves?.length) return [id];
  const live = new Set(datasets.map((d) => d.id));
  return [...new Set([id, ...ds.linkedCurves.map((c) => c.datasetId).filter((s) => live.has(s))])];
}

/** The Library's current dataset, or null. `worksheetId` counts only while
 *  its row is still selected: focusing a plot or Ctrl/Shift-clicking replaces
 *  the selection without clearing it. */
export function librarySelection(lib: DataSourceInput["library"], datasets: readonly Dataset[]): string | null {
  const live = (id: string | null | undefined): id is string => !!id && datasets.some((d) => d.id === id);
  if (live(lib.worksheetId) && lib.selectedIds.includes(lib.worksheetId)) return lib.worksheetId;
  const last = lib.selectedIds.at(-1);
  if (live(last)) return last;
  return live(lib.activeId) ? lib.activeId : null;
}

export function resolveDataSource(input: DataSourceInput): DataSource {
  const { data, datasets } = input;
  if (data.pinned !== null) {
    return datasets.some((d) => d.id === data.pinned)
      ? { kind: "dataset", mode: "pinned", datasetId: data.pinned, inputs: [data.pinned] }
      : { kind: "missing", mode: "pinned", pinned: data.pinned, reason: PINNED_GONE };
  }
  if (data.follow === "library") {
    const id = librarySelection(input.library, datasets);
    return id ? { kind: "dataset", mode: "library", datasetId: id, inputs: [id] } : { kind: "none", mode: "library", reason: NO_LIBRARY };
  }
  const plot = input.plotDatasetId;
  if (!plot || !datasets.some((d) => d.id === plot)) return { kind: "none", mode: "plot", reason: NO_PLOT_DATA };
  const inputs = plotInputs(plot, datasets);
  const datasetId = input.chosen !== null && inputs.includes(input.chosen) ? input.chosen : inputs[0];
  return { kind: "dataset", mode: "plot", datasetId, inputs: inputs.length > 1 ? inputs : [datasetId] };
}

/** Pin the Data window to `id` (no-op: the same object). */
export function pinData(layout: WindowLayoutV1, id: string): WindowLayoutV1 {
  return layout.data.pinned === id ? layout : { ...layout, data: { ...layout.data, pinned: id } };
}

/** Let the Data window follow again. */
export function unpinData(layout: WindowLayoutV1): WindowLayoutV1 {
  return layout.data.pinned === null ? layout : { ...layout, data: { ...layout.data, pinned: null } };
}
