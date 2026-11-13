// An action that changes nothing must not leave an undo step (review
// finding, pre-existing): a Library rename to the same name, and Tile /
// Cascade with nothing to arrange, each pushed a no-op entry, so the next
// Ctrl+Z appeared to do nothing.

import { beforeEach, describe, expect, it } from "vitest";

import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import type { DataStruct } from "../lib/types";
import { useApp } from "./useApp";

const raw: DataStruct = { time: [1, 2], values: [[1], [2]], labels: ["m"], units: ["emu"], metadata: {} };

const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
  id: "w1",
  kind: "plot",
  title: "",
  datasetId: null,
  geometry: { x: 0, y: 0, w: 480, h: 360 },
  z: 1,
  winState: "maximized",
  view: defaultPlotView(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
  ...over,
});

// Minimal entities: only `id`/`name` matter to a rename.
const named = (id: string, name: string) => ({ id, name }) as never;

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "Sample A", raw, parsed: raw } as never],
    folders: [named("f1", "Runs")],
    reports: [named("r1", "Report")],
    figureDocs: [named("fd1", "Fig")],
    collections: [named("c1", "Hot")],
    workbooks: [named("wb1", "Book")],
    editableFigures: [named("ef1", "Edit fig")],
    pages: [named("p1", "Page")],
    history: [],
    future: [],
    plotWindows: [win()],
    focusedWindowId: "w1",
    plotCanvasBounds: { width: 1200, height: 800 },
  });
});

const steps = () => useApp.getState().history.length;

describe("no-op actions record no undo step", () => {
  it.each([
    ["dataset", () => useApp.getState().renameDataset("d1", "Sample A")],
    ["dataset (blank keeps the name)", () => useApp.getState().renameDataset("d1", "   ")],
    ["folder", () => useApp.getState().renameFolder("f1", " Runs ")],
    ["report", () => useApp.getState().renameReport("r1", "Report")],
    ["figure doc", () => useApp.getState().renameFigureDoc("fd1", "Fig")],
    ["collection", () => useApp.getState().renameCollection("c1", "Hot")],
    ["workbook", () => useApp.getState().renameWorkbook("wb1", "Book")],
    ["editable figure", () => useApp.getState().renameEditableFigure("ef1", "Edit fig")],
    ["page", () => useApp.getState().renamePageDocument("p1", "Page")],
  ])("renaming a %s to its own name", (_what, rename) => {
    rename();
    expect(steps()).toBe(0);
  });

  it("a real rename still records exactly one step", () => {
    useApp.getState().renameDataset("d1", "Sample B");
    useApp.getState().renameFolder("f1", "Runs 2");
    expect(steps()).toBe(2);
    expect(useApp.getState().datasets[0].name).toBe("Sample B");
  });

  it("Cascade with one visible window, Tile/Cascade with none visible", () => {
    useApp.getState().cascadeWindows();
    expect(steps()).toBe(0);
    useApp.setState({ plotWindows: [win({ winState: "minimized" })] });
    useApp.getState().tileWindows();
    useApp.getState().cascadeWindows();
    expect(steps()).toBe(0);
  });

  it("Tile twice: the second finds the windows already tiled", () => {
    useApp.setState({ plotWindows: [win(), win({ id: "w2", z: 2 })] });
    useApp.getState().tileWindows();
    expect(steps()).toBe(1);
    useApp.getState().tileWindows();
    expect(steps()).toBe(1);
    useApp.getState().cascadeWindows();
    expect(steps()).toBe(2);
  });
});
