// LIBRARY_WORKBOOK_UX_PLAN acceptance scenario: "Right-click a recognized
// XYXYXY workbook and Quick Plot: three correctly paired editable series are
// created." An Origin book laid out X,Y,X,Y,X,Y arrives with its FIRST X as
// `.time` and the other two X columns among `values`, designated "X"
// (`metadata.column_designations`). Origin's own rule (`opj_curves.py`'s
// nearest-preceding X) pairs each Y with the X column just before it -- so a
// Quick Plot that drew every Y against `.time` would plot the second and
// third loops against the wrong abscissa. Driven both at the seed
// (`lib/quickPlotSeriesX.ts`, the on-demand module store/quickPlotRun.ts
// loads for a declared multi-X book) and through the Library row's real
// "Quick Plot" context action, reading back what the created window actually
// plots. The command path is asynchronous (that module loads on demand), so
// the tests wait on the STORE -- the created figure -- never on a call.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextAction, DatasetActionTarget } from "./contextActions";
import { buildColumns } from "./plotdata";
import type { PlotView } from "./plotview";
import { hasDesignatedSeriesX } from "./quickPlot";
import { datasetQuickPlotActions } from "./quickPlotActions";
import { quickPlotSeriesXSeed } from "./quickPlotSeriesX";
import type { DataStruct, Dataset } from "./types";
import { useApp } from "../store/useApp";
import { plotWindowView } from "../store/windowDocuments";

// A (X, the acquisition axis) = [0, 1, 2]; B/D/F are the Y series and C/E
// their own X columns. Every X differs so a mispairing is visible, and E is
// non-monotonic so acquisition row order must survive too.
const XYXYXY: Dataset = {
  id: "moke",
  name: "Moke",
  data: {
    time: [0, 1, 2],
    values: [
      [10, 5, 100, 0.5, -1],
      [20, 6, 200, 0.2, 1],
      [30, 7, 300, 0.9, 2],
    ],
    labels: ["Y1", "X2", "Y2", "X3", "Y3"],
    units: ["", "", "", "", ""],
    metadata: {
      technique: "magnetometry.mvsh",
      x_column_name: "A",
      x_column_long: "X1",
      origin_column_names: ["B", "C", "D", "E", "F"],
      column_designations: { A: "X", B: "Y", C: "X", D: "Y", E: "X", F: "Y" },
    },
  },
};

const EXPECTED_PAIRS = {
  Y1: [
    [0, 10],
    [1, 20],
    [2, 30],
  ],
  Y2: [
    [5, 100],
    [6, 200],
    [7, 300],
  ],
  Y3: [
    [0.5, -1],
    [0.2, 1],
    [0.9, 2],
  ],
};

// The same book with ONE X: a shared-X control, which must keep binding to
// the worksheet itself (no derived dataset).
const SHARED_X: Dataset = {
  id: "shared",
  name: "Shared",
  data: {
    time: [0, 1, 2],
    values: [
      [10, 100],
      [20, 200],
      [30, 300],
    ],
    labels: ["Y1", "Y2"],
    units: ["", ""],
    metadata: {
      technique: "magnetometry.mvsh",
      origin_column_names: ["B", "C"],
      column_designations: { A: "X", B: "Y", C: "Y" },
    },
  },
};

/** The finite (x, y) points each drawn curve would get, in row order, via
 *  the offline column packer the Stage falls back to -- keyed by label. */
function drawnPairs(data: DataStruct, view: PlotView): Record<string, number[][]> {
  const hidden = new Set(view.hiddenChannels);
  const visible = (view.yKeys ?? data.labels.map((_, c) => c)).filter((c) => !hidden.has(c));
  const payload = buildColumns(data, view.y2Keys, view.xKey, visible);
  const x = payload.data[0];
  const out: Record<string, number[][]> = {};
  payload.series.forEach((s, i) => {
    const ys = payload.data[i + 1];
    const pairs: number[][] = [];
    ys.forEach((y, r) => {
      const xv = x[r];
      if (y != null && xv != null) pairs.push([xv, y]);
    });
    out[s.label] = pairs;
  });
  return out;
}

function target(ds: Dataset): DatasetActionTarget {
  return {
    dataset: ds,
    active: false,
    selected: false,
    selectedIds: [],
    canMoveUp: false,
    canMoveDown: false,
    onRename: () => {},
    onAddTag: () => {},
  };
}

const quickPlot = datasetQuickPlotActions.find((a) => a.id === "dataset.quickPlot") as ContextAction<DatasetActionTarget>;

/** Right-click -> Quick Plot, then the created window's view and the dataset
 *  its figure is bound to (whatever that is). */
async function rightClickQuickPlot(ds: Dataset): Promise<{ view: PlotView; bound: Dataset }> {
  useApp.setState({ datasets: [ds] });
  const t = target(ds);
  expect(quickPlot.enabled?.(t)).toBe(true);
  quickPlot.run(t);
  await vi.waitFor(() => expect(useApp.getState().editableFigures).toHaveLength(1));
  const { editableFigures, plotWindows, datasets } = useApp.getState();
  expect(editableFigures).toHaveLength(1);
  const doc = editableFigures[0];
  const win = plotWindows.find((w) => w.kind === "plot" && w.document?.id === doc.id);
  expect(win).toBeDefined();
  const bound = datasets.find((d) => d.id === doc.bindings.datasetId);
  expect(bound).toBeDefined();
  return { view: plotWindowView(win!), bound: bound! };
}

beforeEach(() => {
  useApp.setState({
    datasets: [],
    activeId: null,
    selectedIds: [],
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    techniqueViewMemory: {},
    quickPlotTemplates: [],
    history: [],
    future: [],
    status: "",
  });
});

describe("Quick Plot on a recognized XYXYXY workbook makes three paired series", () => {
  it("the Library row's Quick Plot command: each Y is drawn against its own preceding X, in row order", async () => {
    const { view, bound } = await rightClickQuickPlot(XYXYXY);
    expect(drawnPairs(bound.data, view)).toEqual(EXPECTED_PAIRS);
  });

  it("the seed (lib/quickPlotSeriesX.ts): a per-series-X overlay, one block per X column, first-series order", () => {
    expect(hasDesignatedSeriesX(XYXYXY)).toBe(true);
    const seed = quickPlotSeriesXSeed(XYXYXY);
    expect(seed?.overlay.blocks).toEqual([null, 1, 3]);
    expect(drawnPairs(seed!.overlay.data, seed!.view)).toEqual(EXPECTED_PAIRS);
  });

  it("the overlay it binds to is a new Library dataset; the worksheet itself is untouched, and one Undo removes it all", async () => {
    const { bound } = await rightClickQuickPlot(XYXYXY);
    const state = useApp.getState();
    expect(bound.id).not.toBe("moke");
    expect(bound.data.metadata["quick_figure_source"]).toBe("moke");
    expect(state.datasets.find((d) => d.id === "moke")).toEqual(XYXYXY);
    expect(state.history).toHaveLength(1);
    state.undo();
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["moke"]);
    expect(useApp.getState().editableFigures).toHaveLength(0);
  });

  it("control: a shared-X worksheet still binds to the worksheet itself, with no overlay", async () => {
    expect(hasDesignatedSeriesX(SHARED_X)).toBe(false);
    expect(quickPlotSeriesXSeed(SHARED_X)).toBeNull();
    const { view, bound } = await rightClickQuickPlot(SHARED_X);
    expect(bound.id).toBe("shared");
    expect(drawnPairs(bound.data, view)).toEqual({
      Y1: [
        [0, 10],
        [1, 20],
        [2, 30],
      ],
      Y2: [
        [0, 100],
        [1, 200],
        [2, 300],
      ],
    });
  });
});
