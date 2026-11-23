// The Data window (WORKSPACE_LAYOUT_PLAN P3): the worksheet grid of the
// dataset the layout's `data` source names (lib/windowLayout/dataSource.ts).
// It mounts the SAME `WorksheetPane` the classic Worksheet tab and worksheet
// document windows mount (the same lazy specifier, so one chunk). While it
// FOLLOWS the focused plot and shows that plot's own dataset it mounts without
// a window id, exactly as the Worksheet tab does, so its row selection IS the
// plot's selection (the existing `plotLinked` path of useWorksheetView, with
// its "Linked to plot" badge): rows picked here highlight on the plot and
// points brushed on the plot select rows here. In every other case (pinned,
// following the Library, a graph's source) it passes its own selection key
// (`DATA_SELECTION_KEY`, like a worksheet document window's id), so its
// selection is its own and never silently shared with the plot, even when it
// happens to show the plot's dataset. Its sheet/book strip is hidden: the
// window's dataset comes from the plot, the pin or the Library, and a tab
// click would move the Library's worksheet instead (fail closed).
//
// Title bar: the dataset name and whether the window follows the plot or the
// Library or is pinned, and the pin toggle. Body: the switcher between a
// multi-dataset plot's inputs (D14), the grid, or a one-sentence reason when
// there is nothing to show (a pin to a removed dataset offers Unpin).

import { lazyRegion } from "../../../lib/lazyRegion";
import { resolveDataSource, type DataSource } from "../../../lib/windowLayout/dataSource";
import { useApp } from "../../../store/useApp";
import { pinDataWindow, unpinDataWindow } from "../../../store/windowLayoutActions";
import { setDataChoice, useDataChoice } from "./dataWindowChoice";

const WorksheetPane = lazyRegion(() => import("../../Stage/worksheet/WorksheetPane"), "Data");

/** The Data window's own row-selection key when it is not linked to the plot
 *  (store/worksheetSelection.ts; never a real window id, those are `win-...`). */
export const DATA_SELECTION_KEY = "layout-data";

type Resolved = DataSource & { plotDatasetId: string | null };

/** The Data window's source, from the live store. */
export function useDataSource(): Resolved {
  const data = useApp((s) => s.windowLayout?.data ?? null);
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const worksheetId = useApp((s) => s.worksheetId);
  const selectedIds = useApp((s) => s.selectedIds);
  // The focused window is a plot window (only those take focus); its dataset is the facade's activeId.
  const plotFocused = useApp((s) => s.plotWindows.some((w) => w.id === s.focusedWindowId && w.kind === "plot"));
  const plotDatasetId = plotFocused ? activeId : null;
  const chosen = useDataChoice(plotDatasetId);
  const src = resolveDataSource({
    data: data ?? { pinned: null, follow: "plot" },
    datasets,
    plotDatasetId,
    library: { worksheetId, selectedIds, activeId },
    chosen,
  });
  return { ...src, plotDatasetId };
}

const MODE: Record<DataSource["mode"], string> = { plot: "following the plot", library: "following the Library", pinned: "pinned" };

/** The title-bar half: name, mode, and the pin toggle. */
export function DataTitle() {
  const src = useDataSource();
  const name = useApp((s) => (src.kind === "dataset" ? s.datasets.find((d) => d.id === src.datasetId)?.name : undefined));
  const pinned = src.mode === "pinned";
  const label = src.kind === "dataset" ? name : src.kind === "missing" ? "removed dataset" : "no dataset";
  return (
    <>
      <span className="qzk-wl-data-src" data-testid="data-source">
        <span className="qzk-wl-data-name">{label}</span> · {MODE[src.mode]}
      </span>
      <button
        type="button"
        className="qzk-wl-close qzk-wl-pin"
        aria-label="Pin the Data window"
        aria-pressed={pinned}
        disabled={!pinned && src.kind !== "dataset"}
        title={pinned ? "Pinned to this dataset; press to follow again." : "Keep showing this dataset whatever plot is focused."}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => (pinned ? unpinDataWindow() : src.kind === "dataset" && pinDataWindow(src.datasetId))}
      >
        ⚲
      </button>
    </>
  );
}

function InputSwitcher({ inputs, value }: { inputs: string[]; value: string }) {
  // inputs[0] is the plot's own dataset (lib/windowLayout/dataSource plotInputs).
  const plot = inputs[0];
  const datasets = useApp((s) => s.datasets);
  return (
    <div className="qzk-wl-data-switch">
      <label>
        Input{" "}
        <select className="qz-select" aria-label="Plot input" title="Choose which of the plot's datasets the grid shows." value={value} onChange={(e) => setDataChoice({ plot, id: e.target.value })}>
          {inputs.map((id, i) => (
            <option key={id} value={id}>
              {(datasets.find((d) => d.id === id)?.name ?? id) + (i === 0 ? " (all curves)" : "")}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** The window's body. */
export default function DataWindowBody() {
  const src = useDataSource();
  if (src.kind === "missing") {
    return (
      <div className="qzk-wl-empty" role="status">
        <div>
          <p>{src.reason}</p>
          <button type="button" className="qzk-wl-tbtn" title="Follow the focused plot or the Library again." onClick={unpinDataWindow}>
            Unpin
          </button>
        </div>
      </div>
    );
  }
  if (src.kind === "none") {
    return (
      <div className="qzk-wl-empty" role="status">
        {src.reason}
      </div>
    );
  }
  const linked = src.mode === "plot" && src.datasetId === src.plotDatasetId;
  return (
    <div className="qzk-wl-data">
      {src.inputs.length > 1 && <InputSwitcher inputs={src.inputs} value={src.datasetId} />}
      <div className="qzk-wl-data-grid">
        <WorksheetPane key={src.datasetId} datasetId={src.datasetId} windowId={linked ? undefined : DATA_SELECTION_KEY} sheetTabs={false} />
      </div>
    </div>
  );
}
