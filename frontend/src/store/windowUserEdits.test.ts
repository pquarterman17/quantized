// Figures audit B1 (2026-11-13): importing data or opening a Library item
// rebound the single plot window to the new dataset and silently wiped its
// styling; window titles kept naming the dataset they were created for; the
// plot title "Sample A..." leaked onto later datasets. Each case below was
// reproduced against the pre-fix store first (it fails there).
import { beforeEach, describe, expect, it } from "vitest";

import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import { newGraphWindowView } from "../lib/plotWindows";
import type { Dataset, DataStruct } from "../lib/types";
import { useApp } from "./useApp";
import { datasetViewDefaults } from "./windowDefaults";
import { plotWindowView } from "./windowDocuments";
import { focusedWindowGuardsAgainst, viewHasUserEdits, windowHasUserEdits } from "./windowUserEdits";

function data(technique = "generic", labels = ["M", "R", "dM"]): DataStruct {
  return {
    time: [1, 2, 3],
    values: [
      [1, 10, 0.1],
      [2, 20, 0.1],
      [3, 30, 0.1],
    ],
    labels,
    units: labels.map(() => ""),
    metadata: { technique },
  };
}
const ds = (id: string, name = `${id}.csv`, technique = "generic"): Dataset => ({ id, name, data: data(technique) });

const act = () => useApp.getState();
const focused = (): PlotWindow => act().plotWindows.find((w) => w.id === act().focusedWindowId)!;
const byId = (id: string): PlotWindow => act().plotWindows.find((w) => w.id === id)!;

/** The audit's styling, applied through the real store actions. */
function styleFocusedWindow(): void {
  const s = act();
  s.setErrKey(0, 2);
  s.setY2Keys([1]);
  s.setPlotTitle("Sample A: chi and rho");
  s.setXAxisLabel("T (K)");
  s.setYScale("log");
  s.addRefLine("x", 2);
}

function expectStyled(win: PlotWindow): void {
  const v = win.id === act().focusedWindowId ? act() : plotWindowView(win);
  expect(v.errKeys).toEqual({ 0: 2 });
  expect(v.y2Keys).toEqual([1]);
  expect(v.plotTitle).toBe("Sample A: chi and rho");
  expect(v.xAxisLabel).toBe("T (K)");
  expect(v.yScale).toBe("log");
  expect(v.refLines).toHaveLength(1);
}

beforeEach(() => {
  useApp.setState(useApp.getInitialState(), true);
});

describe("import into a styled window (B1)", () => {
  it("a first import lands in the default window; styling it, then importing twice, never touches it", () => {
    act().addDataset(ds("mt"));
    const main = focused().id;
    expect(act().plotWindows).toHaveLength(1);
    expect(windowHasUserEdits(act(), focused())).toBe(false);

    styleFocusedWindow();
    expect(windowHasUserEdits(act(), focused())).toBe(true);

    act().addDataset(ds("decay"));
    expect(act().plotWindows).toHaveLength(2);
    expect(byId(main).datasetId).toBe("mt");
    expectStyled(byId(main));
    // The new data opened in its own, unstyled window.
    expect(focused().id).not.toBe(main);
    expect(focused().datasetId).toBe("decay");
    expect(act().plotTitle).toBe("");
    expect(act().refLines).toEqual([]);

    // A second import reuses that unedited window instead of opening a third.
    const second = focused().id;
    act().addDataset(ds("decay2"));
    expect(act().plotWindows).toHaveLength(2);
    expect(focused().id).toBe(second);
    expect(focused().datasetId).toBe("decay2");
    expectStyled(byId(main));
  });

  it("the protected import is ONE undo step that removes both the dataset and its window", () => {
    act().addDataset(ds("mt"));
    styleFocusedWindow();
    useApp.setState({ history: [] });
    act().addDataset(ds("decay"));
    expect(act().history.map((h) => h.label)).toEqual(["add dataset"]);
    act().undo();
    expect(act().datasets.map((d) => d.id)).toEqual(["mt"]);
    expect(act().plotWindows).toHaveLength(1);
    expectStyled(focused());
  });
});

describe("Library open into a styled window (B1)", () => {
  beforeEach(() => {
    act().addDataset(ds("mt"));
    act().addDataset(ds("bar"));
    act().setActive("mt");
  });

  it("opening another dataset leaves a styled window bound and styled, in a new window", () => {
    styleFocusedWindow();
    const main = focused().id;
    act().activateFromLibrary("bar");
    expect(byId(main).datasetId).toBe("mt");
    expectStyled(byId(main));
    expect(focused().id).not.toBe(main);
    expect(focused().datasetId).toBe("bar");
    expect(act().plotTitle).toBe("");
  });

  it("an unedited window still follows the Library click (no window spam)", () => {
    const main = focused().id;
    act().activateFromLibrary("bar");
    expect(act().plotWindows).toHaveLength(1);
    expect(focused().id).toBe(main);
    expect(focused().datasetId).toBe("bar");
  });

  it("dropping the row ONTO the styled frame is the explicit rebind, and still rebinds", () => {
    styleFocusedWindow();
    act().rebindWindow(focused().id, "bar");
    expect(act().plotWindows).toHaveLength(1);
    expect(focused().datasetId).toBe("bar");
    expect(act().plotTitle).toBe(""); // the old dataset's title went with it
  });
});

describe("window titles follow the bound dataset (B1)", () => {
  it("a window created for one dataset is retitled when an import rebinds it", () => {
    act().addDataset(ds("xyz_idx"));
    const id = act().createWindow("xyz_idx");
    act().focusWindow(id);
    expect(byId(id).title).toBe("xyz_idx.csv (2)");
    act().addDataset(ds("decay2"));
    expect(focused().id).toBe(id);
    expect(byId(id).title).toBe("decay2.csv");
    expect(byId(id).document?.name).toBe("decay2.csv");
    // The figure saved from it is named for the data it shows.
    const figureId = act().saveFigure(id);
    expect(act().editableFigures.find((f) => f.id === figureId)?.name).toBe("decay2.csv");
  });

  it("a Library open and an explicit drop retitle a default title too", () => {
    act().addDataset(ds("a"));
    act().addDataset(ds("b"));
    act().addDataset(ds("c"));
    const id = act().createWindow("a");
    act().focusWindow(id);
    act().activateFromLibrary("b");
    expect(byId(id).title).toBe("b.csv");
    act().rebindWindow(id, "c");
    expect(byId(id).title).toBe("c.csv (2)"); // the main window already shows c.csv
  });

  it("a title the user typed is kept across a rebind", () => {
    act().addDataset(ds("a"));
    act().addDataset(ds("b"));
    const id = focused().id;
    act().renameWindow(id, "Figure 2");
    act().rebindWindow(id, "a");
    expect(byId(id).title).toBe("Figure 2");
  });

  it("a renamed window counts as edited, so an import does not take it over", () => {
    act().addDataset(ds("a"));
    act().renameWindow(focused().id, "Figure 2");
    act().addDataset(ds("b"));
    expect(act().plotWindows).toHaveLength(2);
    expect(act().plotWindows[0].datasetId).toBe("a");
  });
});

describe("what counts as an edit", () => {
  it("a fresh bind's own technique defaults (a SIMS log axis) are not an edit", () => {
    const sims = ds("s", "s.csv", "sims");
    act().addDataset(sims);
    expect(act().yScale).toBe("log");
    expect(windowHasUserEdits(act(), focused())).toBe(false);
  });

  it("the Statistics plot mode is an edit, its auto-written picks are not", () => {
    const d = ds("d");
    // The dataset's own fresh view (its "dM" is a detected error column).
    const fresh = { ...defaultPlotView(), ...datasetViewDefaults(d), statPicks: { mode: "bar" as const } };
    expect(viewHasUserEdits(fresh, d)).toBe(false);
    expect(viewHasUserEdits({ ...fresh, statMode: true }, d)).toBe(true);
  });

  it("guards a whole-view open only against OTHER data", () => {
    act().addDataset(ds("a"));
    styleFocusedWindow();
    expect(focusedWindowGuardsAgainst(act(), ["b"])).toBe(true);
    expect(focusedWindowGuardsAgainst(act(), ["a", "b"])).toBe(false);
  });
});

describe("plot mode is per window (#9)", () => {
  it("New Graph Window clones the view but not the Statistics or polar mode", () => {
    const seed = newGraphWindowView({ ...defaultPlotView(), statMode: true, polarMode: true, plotTitle: "kept" });
    expect(seed.statMode).toBe(false);
    expect(seed.polarMode).toBe(false);
    expect(seed.plotTitle).toBe("kept");
  });

  it("a rebound dataset leaves Statistics mode", () => {
    act().addDataset(ds("a"));
    act().addDataset(ds("b"));
    act().setStatMode(true);
    act().rebindWindow(focused().id, "a");
    expect(act().statMode).toBe(false);
  });
});
