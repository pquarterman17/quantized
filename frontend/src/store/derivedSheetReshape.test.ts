// Cross-reference consistency: a DERIVED worksheet's column-indexed state when
// its SOURCE's columns change. A derived sheet re-derives from the source's
// displayed table (`recomputeDerivedSheet`), so removing a source column shifts
// every later column of the sheet too — but the sheet's own windows, saved
// figures, fit spec and error roles were never told, and kept pointing at the
// old indices: a plot of a DIFFERENT column, with no notice.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFigureDocument } from "../lib/figureDocument";
import { defaultPlotView } from "../lib/plotview";
import type { ComputedColumn, Dataset, DataStruct } from "../lib/types";
import { singleRemovedColumn } from "./derivedSheetShift";
import { useApp } from "./useApp";
import { plotWindowView, syncPlotWindow } from "./windowDocuments";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  // Identity corrections: the derived sheet's base IS the source's table.
  applyCorrections: vi.fn(async ({ dataset }: { dataset: DataStruct }) => dataset),
}));

// Source "src": base A, formulas F1 (col 1), F2 (col 2).
function source(): Dataset {
  const formulas: ComputedColumn[] = [
    { name: "F1", expr: "A * 10", deps: ["A"] },
    { name: "F2", expr: "A * 100", deps: ["A"] },
  ];
  return {
    id: "src",
    name: "src",
    data: {
      time: [0, 1],
      values: [
        [1, 10, 100],
        [2, 20, 200],
      ],
      labels: ["A", "F1", "F2"],
      units: ["", "", ""],
      metadata: {},
    },
    formulas,
  };
}

// Derived sheet "der": same three columns (identity pipeline), plus its OWN
// formula G (col 3) = C + 1, i.e. F2 + 1.
function derived(): Dataset {
  const own: ComputedColumn[] = [{ name: "G", expr: "C + 1", deps: ["C"] }];
  const src = source().data;
  return {
    id: "der",
    name: "der",
    data: {
      ...src,
      values: src.values.map((r) => [...r, r[2] + 1]),
      labels: [...src.labels, "G"],
      units: [...src.units, ""],
    },
    raw: src,
    corrections: {},
    derivedFrom: { datasetId: "src", pipeline: "identity" },
    formulas: own,
    fitSpec: { model: "linear", xKey: 0, yKey: 2, params: [1, 0] },
    errorRoles: [{ channel: 2, target: 1, axis: "y", side: "both" }],
  };
}

beforeEach(() => {
  useApp.setState({
    datasets: [source(), derived()],
    activeId: "src",
    recalcMode: "manual",
    staleDatasets: [],
    staleFits: [],
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    status: "",
  });
});

/** A background window on the derived sheet plotting F2 (col 2). */
function derivedWindowOnF2(): string {
  const id = useApp.getState().createWindow("der");
  useApp.setState((s) => ({
    plotWindows: s.plotWindows.map((w) =>
      w.id === id ? syncPlotWindow(w, { ...plotWindowView(w), xKey: 0, yKeys: [2] }) : w,
    ),
  }));
  return id;
}

describe("derived worksheet: a source column removal reaches the sheet's references", () => {
  it("the sheet's data really does shift once it recalculates (premise)", async () => {
    useApp.getState().removeFormula("src", 0); // drop F1 (col 1)
    await useApp.getState().recalcNow();
    const der = useApp.getState().datasets.find((d) => d.id === "der")!;
    expect(der.data.labels.slice(0, 2)).toEqual(["A", "F2"]);
  });

  it("a background window on the sheet keeps plotting F2, not the column that slid into its slot", async () => {
    const wid = derivedWindowOnF2();
    useApp.getState().removeFormula("src", 0);
    await useApp.getState().recalcNow();
    const s = useApp.getState();
    const der = s.datasets.find((d) => d.id === "der")!;
    const view = plotWindowView(s.plotWindows.find((w) => w.id === wid)!);
    const plotted = (view.yKeys ?? []).map((k) => der.data.labels[k]);
    expect(plotted).toEqual(["F2"]);
  });

  it("a saved editable figure of the sheet follows F2", async () => {
    const doc = createFigureDocument({
      id: "fig",
      name: "fig",
      datasetId: "der",
      view: { ...defaultPlotView(), xKey: 0, yKeys: [2] },
    });
    useApp.setState({ editableFigures: [doc] });
    useApp.getState().removeFormula("src", 0);
    await useApp.getState().recalcNow();
    const s = useApp.getState();
    const der = s.datasets.find((d) => d.id === "der")!;
    const fig = s.editableFigures.find((f) => f.id === "fig")!;
    expect((fig.bindings.yKeys ?? []).map((k) => der.data.labels[k])).toEqual(["F2"]);
  });

  it("the sheet's fit spec and error roles follow F2; a role on the removed column drops", async () => {
    useApp.getState().removeFormula("src", 0);
    await useApp.getState().recalcNow();
    const der = useApp.getState().datasets.find((d) => d.id === "der")!;
    expect(der.fitSpec?.yKey).toBe(1); // F2's new slot
    // The binding's target was F1 itself — gone, so the binding goes.
    expect(der.errorRoles).toEqual([]);
  });

  it("the sheet's own formula keeps reading F2 (its letter shifts with it)", async () => {
    useApp.getState().removeFormula("src", 0);
    await useApp.getState().recalcNow();
    const der = useApp.getState().datasets.find((d) => d.id === "der")!;
    const g = der.data.labels.indexOf("G");
    expect(der.data.values.map((r) => r[g])).toEqual([101, 201]);
  });
});

describe("derived worksheet: the live view and the detector", () => {
  it("the live view follows when the sheet is the active dataset", async () => {
    useApp.setState({ activeId: "der", xKey: 0, yKeys: [2] });
    useApp.getState().removeFormula("src", 0);
    await useApp.getState().recalcNow();
    expect(useApp.getState().yKeys).toEqual([1]);
  });

  it("an ordinary recalc (no column change) leaves the sheet's windows alone", async () => {
    derivedWindowOnF2();
    const before = useApp.getState().plotWindows;
    useApp.getState().touchDataset("src");
    await useApp.getState().recalcNow();
    expect(useApp.getState().plotWindows).toBe(before);
  });

  it("singleRemovedColumn finds one removal and refuses to guess otherwise", () => {
    expect(singleRemovedColumn(["A", "B", "C"], ["A", "C"])).toBe(1);
    expect(singleRemovedColumn(["A", "B", "C"], ["A", "B"])).toBe(2);
    expect(singleRemovedColumn(["A", "B"], ["A", "B"])).toBeNull();
    expect(singleRemovedColumn(["A", "B"], ["A", "B", "C"])).toBeNull(); // an append
    expect(singleRemovedColumn(["A", "B", "C"], ["A", "X"])).toBeNull(); // a rename too
    expect(singleRemovedColumn(["A", "B", "B"], ["A", "B"])).toBeNull(); // which B?
  });
});
