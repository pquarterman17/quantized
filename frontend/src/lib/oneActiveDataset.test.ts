// UX audit 10, P0-1 / P0-2: "the command acts on exactly what the UI says".
// A Tree single-click highlights a row without plotting it (L0.25). These pin
// the one rule (lib/commandTarget) every command and analysis tool reads, and
// the end-to-end promise: after a highlight, the tool's input, the focused plot,
// the title bar's active dataset and the visible stage tab all name ONE dataset.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildPlotCommands } from "../commands/plotCommands";
import { seedAnalysisSelection, useAnalysisSelection } from "../store/analysisSelection";
import { useApp } from "../store/useApp";
import { captureAnalysisSelection } from "./analysisSelection";
import { commandTargetId } from "./commandTarget";
import { watchPlotToolOpens } from "./toolTarget";
import type { Dataset } from "./types";

const sheet = (id: string, name: string): Dataset => ({
  id,
  name,
  data: { time: [1, 2, 3, 4], values: [[10], [20], [15], [30]], labels: ["Y"], units: ["V"], metadata: {} },
});
const xrd = sheet("xrd", "xrdml_la2nio4.xrdml");
const mpms = sheet("mpms", "mpms_mvst.dat");
const ppms = sheet("ppms", "ppms_synth.dat");
const datasets = [xrd, mpms, ppms];

describe("commandTargetId: the one rule", () => {
  const rule = (activeId: string | null, selectedIds: string[]) => commandTargetId({ datasets, activeId, selectedIds });
  it("is the plotted dataset when nothing else is highlighted", () => {
    expect(rule("xrd", [])).toBe("xrd");
    expect(rule("xrd", ["xrd"])).toBe("xrd");
  });
  it("is the Tree-highlighted row when it is not the plotted one (the last thing pointed at)", () => {
    expect(rule("xrd", ["mpms"])).toBe("mpms");
  });
  it("keeps the plotted dataset when a multi-selection includes it, else the first selected", () => {
    expect(rule("xrd", ["mpms", "xrd"])).toBe("xrd");
    expect(rule("xrd", ["ppms", "mpms"])).toBe("ppms");
  });
  it("ignores deleted ids and is null with nothing at all", () => {
    expect(rule("gone", ["also-gone"])).toBeNull();
    expect(rule("xrd", ["gone"])).toBe("xrd");
    expect(rule(null, [])).toBeNull();
  });
});

describe("captureAnalysisSelection: a lone highlight is not a batch", () => {
  const capture = (selectedIds: string[]) => ({
    datasets, activeId: "xrd", selectedIds, xKey: null, yKeys: [0], seriesOrder: null, errKeys: {}, selection: null, range: null,
  });
  const ids = (source: Parameters<typeof captureAnalysisSelection>[1], selectedIds: string[]) =>
    captureAnalysisSelection(capture(selectedIds), source).items.map((item) => item.datasetId);
  it("a tool's live capture keeps following the focused plot", () => {
    expect(ids("tool-default", ["mpms"])).toEqual(["xrd"]);
    expect(ids("analysis-center", ["mpms"])).toEqual(["xrd"]);
  });
  it("an explicit Library capture takes the highlighted row", () => {
    expect(ids("library", ["mpms"])).toEqual(["mpms"]);
  });
  it("a real multi-selection is still the batch, plotted dataset first", () => {
    expect(ids("tool-default", ["mpms", "xrd"])).toEqual(["xrd", "mpms"]);
    expect(ids("tool-default", ["mpms", "ppms"])).toEqual(["mpms", "ppms"]);
  });
});

describe("opening a tool after a Tree single-click (P0-1 repro A) and from another page (P0-2)", () => {
  let stop: () => void = () => {};
  beforeEach(() => {
    useApp.setState({
      datasets, activeId: "xrd", selectedIds: ["xrd"], stageTab: "plot",
      curveFitOpen: false, hysteresisOpen: false, peaksOpen: false, baselineOpen: false, distributionOpen: false,
      windowLayout: null,
    });
    useAnalysisSelection.getState().clear();
    stop = watchPlotToolOpens();
  });
  afterEach(() => stop());

  it("Curve fit analyses the highlighted row and shows it on the focused plot", () => {
    useApp.getState().selectIds(["mpms"]); // the Tree single-click: highlight, no plot change
    expect(useApp.getState().activeId).toBe("xrd");
    useApp.setState({ curveFitOpen: true });
    const app = useApp.getState();
    expect(app.activeId).toBe("mpms");
    expect(app.stageTab).toBe("plot");
    // The tool's live capture (what the panel says and the run reads) is the same dataset.
    const seed = seedAnalysisSelection("curvefit", "tool-default");
    expect(seed.items.map((item) => item.datasetId)).toEqual(["mpms"]);
  });

  it("a plot tool opened over the Analysis Center or the Worksheet switches the stage to the plot", () => {
    for (const tab of ["analysis", "technique", "worksheet"] as const) {
      useApp.setState({ stageTab: tab, hysteresisOpen: false });
      useApp.setState({ hysteresisOpen: true });
      expect(useApp.getState().stageTab).toBe("plot");
      expect(useApp.getState().activeId).toBe("xrd");
    }
  });

  it("a reviewed handoff wins over the highlight: its dataset is the one shown", () => {
    useAnalysisSelection.getState().setSelection("peaks", captureAnalysisSelection({
      datasets, activeId: "ppms", selectedIds: ["ppms"], xKey: null, yKeys: [0], seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "analysis-center"));
    useApp.getState().selectIds(["mpms"]);
    useApp.setState({ stageTab: "analysis", peaksOpen: true });
    expect(useApp.getState().activeId).toBe("ppms");
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("a pinned tool keeps its pin and does not rebind the plot", () => {
    useApp.setState({ windowLayout: { pins: { "tool:baseline": "ppms" } } as never });
    useApp.getState().selectIds(["mpms"]);
    useApp.setState({ stageTab: "worksheet", baselineOpen: true });
    expect(useApp.getState().activeId).toBe("xrd");
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("a non-plot analysis tool also targets the highlighted row", () => {
    useApp.getState().selectIds(["mpms"]);
    useApp.setState({ distributionOpen: true });
    expect(useApp.getState().activeId).toBe("mpms");
    expect(useApp.getState().selectedIds).toEqual(["mpms"]);
  });
});

describe("Plot ▸ Plot in new window (P0-1 repro B)", () => {
  it("plots the highlighted row, not the dataset already on the plot", () => {
    useApp.setState({ datasets, activeId: "mpms", selectedIds: ["mpms"], stageTab: "plot" });
    useApp.getState().selectIds(["ppms"]);
    const command = buildPlotCommands(useApp.getState).find((action) => action.id === "plot-in-new-window")!;
    command.run();
    const app = useApp.getState();
    expect(app.plotWindows.find((w) => w.id === app.focusedWindowId)?.datasetId).toBe("ppms");
    expect(app.activeId).toBe("ppms");
  });
});
