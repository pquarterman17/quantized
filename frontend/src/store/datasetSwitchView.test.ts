// Plot audit round 2: what a GENUINE dataset switch does to the view's
// coordinate-tied decorations, tick formats and (for a generic dataset) axis
// scales. Ref lines, region shades, data-anchored annotations/shapes and the
// tick formats describe the dataset that just left the window, so they reset;
// window style (title, grid, legend, template) and page-anchored marks stay.
import { beforeEach, describe, expect, it } from "vitest";

import { defaultPlotView, type PlotView, type PlotWindow } from "../lib/plotview";
import type { Annotation, DataStruct, Dataset, Shape } from "../lib/types";
import { parseWorkspace } from "../lib/workspace";
import { serializeWorkspace } from "../lib/workspaceSerialize";
import { useApp } from "./useApp";
import { plotWindowView } from "./windowDocuments";

function data(technique: string): DataStruct {
  return {
    time: [1, 2, 3],
    values: [
      [10, 1],
      [20, 2],
      [30, 3],
    ],
    labels: ["A", "B"],
    units: ["", ""],
    metadata: { technique },
  };
}
const ds = (id: string, technique = "generic"): Dataset => ({ id, name: id, data: data(technique) });

const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
  id: "w1",
  kind: "plot",
  title: "",
  datasetId: "d1",
  geometry: { x: 0, y: 0, w: 480, h: 360 },
  z: 0,
  winState: "normal",
  view: defaultPlotView(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
  ...over,
});

const dataNote: Annotation = { id: "a1", x: 2, y: 20, text: "Hc" };
const pageNote: Annotation = { id: "a2", x: 0.1, y: 0.1, text: "Sample A", anchor: "page" };
const dataBox: Shape = { id: "s1", kind: "rect", x1: 1, y1: 10, x2: 2, y2: 20 };
const pageArrow: Shape = { id: "s2", kind: "arrow", x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2, anchor: "page" };

const DECORATED: Partial<PlotView> = {
  refLines: [{ id: "r1", axis: "x", value: 2 }],
  regionShades: [{ id: "g1", x1: 1, x2: 2, y1: 10, y2: 20, fill: "#336699" }],
  annotations: [dataNote, pageNote],
  shapes: [dataBox, pageArrow],
  xFmt: { mode: "sci", digits: 3 },
  yFmt: { mode: "fixed", digits: 1 },
  y2Fmt: { mode: "eng", digits: 2 },
  plotTitle: "kept",
  showGrid: false,
};

function seed(activeTechnique = "generic"): void {
  useApp.setState({
    datasets: [ds("d1", activeTechnique), ds("d2"), ds("d3", "sims")],
    activeId: "d1",
    selectedIds: ["d1"],
    plotWindows: [win({ id: "w1", datasetId: "d1" }), win({ id: "w2", datasetId: "d1", z: 1, view: { ...defaultPlotView(), ...DECORATED } })],
    focusedWindowId: "w1",
    history: [],
    future: [],
    ...DECORATED,
  });
}

function expectSwitched(v: Pick<PlotView, keyof typeof DECORATED>): void {
  expect(v.refLines).toEqual([]);
  expect(v.regionShades).toEqual([]);
  expect(v.annotations).toEqual([pageNote]);
  expect(v.shapes).toEqual([pageArrow]);
  expect(v.xFmt).toEqual(defaultPlotView().xFmt);
  expect(v.yFmt).toEqual(defaultPlotView().yFmt);
  expect(v.y2Fmt).toBeNull();
  // Window style is not dataset-bound.
  expect(v.plotTitle).toBe("kept");
  expect(v.showGrid).toBe(false);
}

beforeEach(() => {
  useApp.setState(useApp.getInitialState(), true);
});

describe("genuine dataset switch — coordinate-tied decorations and tick formats", () => {
  it("setActive to a different dataset resets them in the live view and the focused window record", () => {
    seed();
    useApp.getState().setActive("d2");
    const s = useApp.getState();
    expectSwitched(s);
    expectSwitched(plotWindowView(s.plotWindows.find((w) => w.id === "w1")!));
  });

  it("re-activating the already-active dataset keeps them", () => {
    seed();
    useApp.getState().setActive("d1");
    const s = useApp.getState();
    expect(s.refLines).toHaveLength(1);
    expect(s.annotations).toEqual([dataNote, pageNote]);
    expect(s.xFmt).toEqual({ mode: "sci", digits: 3 });
  });

  it("undo restores the decorations the switch dropped", () => {
    seed();
    useApp.getState().setActive("d2");
    useApp.getState().undo();
    const s = useApp.getState();
    expect(s.activeId).toBe("d1");
    expect(s.refLines).toHaveLength(1);
    expect(s.regionShades).toHaveLength(1);
    expect(s.annotations).toEqual([dataNote, pageNote]);
    expect(s.shapes).toEqual([dataBox, pageArrow]);
    expect(s.yFmt).toEqual({ mode: "fixed", digits: 1 });
  });

  it("an import (addDataset) resets them", () => {
    seed();
    useApp.getState().addDataset(ds("d9"));
    expectSwitched(useApp.getState());
  });

  it("rebinding a BACKGROUND window resets its stored view only", () => {
    seed();
    useApp.getState().rebindWindow("w2", "d2");
    const s = useApp.getState();
    expectSwitched(plotWindowView(s.plotWindows.find((w) => w.id === "w2")!));
    expect(s.refLines).toHaveLength(1); // the focused live view is untouched
  });

  it("the reset view round-trips through a .dwk save and reopen", () => {
    seed();
    useApp.getState().setActive("d2");
    const st = useApp.getState();
    const text = serializeWorkspace({ ...st, plotWindows: st.windowsForSave() });
    useApp.setState(useApp.getInitialState(), true);
    useApp.getState().loadWorkspace(parseWorkspace(text));
    const back = useApp.getState();
    expect(back.activeId).toBe("d2");
    expectSwitched(back);
  });
});

describe("genuine dataset switch — a generic dataset gets linear axes", () => {
  it("a generic dataset after a log-y SIMS profile resets both scales to linear", () => {
    seed("sims");
    useApp.setState({ yScale: "log", xScale: "log" });
    useApp.getState().setActive("d2");
    expect(useApp.getState().yScale).toBe("linear");
    expect(useApp.getState().xScale).toBe("linear");
  });

  it("a generic import onto a log view resets to linear", () => {
    seed("sims");
    useApp.setState({ yScale: "log" });
    useApp.getState().addDataset(ds("d9"));
    expect(useApp.getState().yScale).toBe("linear");
  });

  it("a generic-to-generic switch keeps a user's log axis (same-technique contract)", () => {
    seed("generic");
    useApp.setState({ yScale: "log" });
    useApp.getState().setActive("d2");
    expect(useApp.getState().yScale).toBe("log");
  });

  it("a technique dataset still gets its own default", () => {
    seed("generic");
    useApp.getState().setActive("d3");
    expect(useApp.getState().yScale).toBe("log");
  });
});
