// A single-book Origin figure whose curves bind DIFFERENT X columns of the
// same worksheet (Origin's X,Y,X,Y multi-X layout, CLAUDE.md "Protect
// multi-X worksheets"): the apply must draw each Y against its OWN X, never
// every Y against one X. The real apply routes such a figure through the
// overlay builder (`lib/originOverlayFigure.ts::buildOverlayDataset` keys
// segments by (dataset, X channel)); this pins that, end to end through
// `applyOriginFigure`. Anchor: plot-corpus specimen `area/multi_x`
// (plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md item 5).

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dataset, DataStruct } from "../lib/types";
import { loadOriginApplyLibs } from "./originApplyLibs";
import { useApp } from "./useApp";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

beforeAll(async () => {
  await loadOriginApplyLibs();
});

// Columns A(X) B(Y) C(X) D(Y): A is the book's first X (`.time`), the value
// channels are B, C, D.
const multiX: DataStruct = {
  time: [0, 1, 2],
  values: [
    [10, 100, 1000],
    [11, 101, 1001],
    [12, 102, 1002],
  ],
  labels: ["y1", "x2", "y2"],
  units: ["", "", ""],
  metadata: {
    origin_book: "MultiX",
    x_column_name: "A",
    origin_column_names: ["B", "C", "D"],
    column_designations: { A: "X", B: "Y", C: "X", D: "Y" },
  },
};

const ds: Dataset = { id: "d1", name: "MultiX", data: multiX };

const entry = {
  id: "fig-mx",
  stem: "multi_x",
  datasetId: "d1",
  siblingIds: ["d1"],
  figure: {
    name: "Graph1",
    x_from: 0, x_to: 200, x_log: false, y_from: 0, y_to: 2000, y_log: false,
    n_curves: 2,
    annotations: [] as string[],
    curves: [
      { book: "MultiX", x: "A", y: "B" },
      { book: "MultiX", x: "C", y: "D" },
    ],
  },
};

beforeEach(() => {
  useApp.setState({
    datasets: [ds], activeId: null, history: [], future: [], macroSteps: [],
    originFigures: [entry], xKey: null, yKeys: null, hiddenChannels: [],
  });
});

describe("applyOriginFigure — single-book multi-X figure", () => {
  it("draws each Y against its own X column", () => {
    useApp.getState().applyOriginFigure("fig-mx");
    const s = useApp.getState();
    const shown = s.datasets.find((d) => d.id === s.activeId);
    expect(shown).toBeDefined();
    const data = shown!.data;
    expect(s.xKey).toBeNull(); // the overlay's own time column
    // Every finite (x, y) point drawn for each plotted channel.
    const pairs = (k: number): [number, number][] =>
      data.time.flatMap((t, i) => (Number.isFinite(data.values[i][k]) ? [[t, data.values[i][k]] as [number, number]] : []));
    const drawn = (s.yKeys ?? []).map(pairs);
    expect(drawn).toEqual([
      [[0, 10], [1, 11], [2, 12]], // B against A
      [[100, 1000], [101, 1001], [102, 1002]], // D against C
    ]);
  });
});
