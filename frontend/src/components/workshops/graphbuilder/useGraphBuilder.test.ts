import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigure } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useGraphBuilder } from "./useGraphBuilder";

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return { ...actual, exportFigure: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("../../overlays/ParamDialog", () => ({
  askParams: vi.fn().mockResolvedValue({
    fmt: "pdf",
    style: "default",
    dpi: 300,
    title: "",
    x_label: "",
    y_label: "",
  }),
}));

// channel 0 monotonic continuous x, channel 1 continuous y, channel 2 a 2-level
// nominal grouping column (needs ≥12 rows for nominal inference), channel 3 a
// 2-level nominal FACET column (gap #21 residual — same 6/6 split as channel 2
// so a facet send has 2 finite levels to build panels from).
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [1, 10, 0, 0],
    [2, 12, 0, 0],
    [3, 14, 0, 0],
    [4, 16, 0, 0],
    [5, 18, 0, 0],
    [6, 20, 0, 0],
    [7, 30, 1, 1],
    [8, 32, 1, 1],
    [9, 34, 1, 1],
    [10, 36, 1, 1],
    [11, 38, 1, 1],
    [12, 40, 1, 1],
  ],
  labels: ["x", "y", "grp", "fct"],
  units: ["s", "emu", "", ""],
  metadata: { x_column_name: "T" },
};

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    status: "",
    xKey: null,
    yKeys: null,
    y2Keys: null,
    statMode: false,
    statStageSeed: null,
    graphBuilderSeed: null,
    savedPlotSpecs: [],
    activePlotSpecId: null,
    macroRecording: false,
    stackMode: false,
    spatialPanels: null,
    facetPanels: null,
    breakPanels: null,
    figureBuilderOpen: false,
    figureDocSeed: null,
    figureDocs: [],
    // Owner-routing item 1: starts parked on Worksheet so "sendToStage
    // surfaces the Plot tab" assertions below don't need a separate fixture.
    stageTab: "worksheet",
  });
});

describe("useGraphBuilder — morphing", () => {
  it("starts empty with an incomplete hint", () => {
    const { result } = renderHook(() => useGraphBuilder());
    expect(result.current.render.kind).toBe("message");
    expect(result.current.canSend).toBe(false);
  });

  it("two continuous columns yield a scatter", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    expect(result.current.mark).toBe("scatter");
    expect(result.current.family).toBe("xy");
    expect(result.current.render.kind).toBe("xy");
    expect(result.current.chips("y")).toEqual([{ channel: 1, label: "y" }]);
  });

  it("swapping a nominal column onto X morphs to box and cycles box→violin→bar", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("x", 2)); // nominal
    expect(result.current.mark).toBe("box");
    expect(result.current.render.kind).toBe("box");
    act(() => result.current.cycle());
    expect(result.current.mark).toBe("violin");
    act(() => result.current.cycle());
    expect(result.current.mark).toBe("bar");
    act(() => result.current.cycle());
    expect(result.current.mark).toBe("box");
  });

  it("#8i: a BOUND session survives an active-dataset change (Send restores its dataset)", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    expect(result.current.chips("y")).toHaveLength(1);
    act(() => {
      useApp.setState({
        datasets: [
          { id: "d1", name: "run.dat", data: DATA },
          { id: "d2", name: "other.dat", data: DATA },
        ],
        activeId: "d2",
      });
    });
    // The spec's channel refs bind the builder to d1; moving the active
    // dataset elsewhere no longer destroys the session (see the #8i note in
    // useGraphBuilder — the wipe fires only when the BOUND dataset vanishes).
    expect(result.current.chips("y")).toHaveLength(1);
    expect(result.current.datasetId).toBe("d1");
  });

  it("wipes the spec when its bound dataset no longer exists", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    expect(result.current.chips("y")).toHaveLength(1);
    act(() => {
      useApp.setState({
        datasets: [{ id: "d2", name: "other.dat", data: DATA }],
        activeId: "d2",
      });
    });
    expect(result.current.chips("y")).toHaveLength(0);
    expect(result.current.datasetId).toBe("d2"); // empty spec follows active again
  });
});

describe("useGraphBuilder — worksheet seed (MAIN_PLAN #4)", () => {
  const seedFor = (datasetId: string) => ({
    version: 1 as const,
    zones: {
      x: { datasetId, channel: 0 },
      y: [{ datasetId, channel: 1 }],
      group: null,
      facet: null,
    },
    mark: "scatter" as const,
  });

  it("consumes a pending seed on mount: wells prefilled, mark re-inferred, seed cleared", () => {
    // The worksheet handoff sets the seed BEFORE the panel mounts.
    act(() => useApp.getState().openGraphBuilderSeeded(seedFor("d1")));
    const { result } = renderHook(() => useGraphBuilder());
    expect(result.current.chips("x")).toEqual([{ channel: 0, label: "x" }]);
    expect(result.current.chips("y")).toEqual([{ channel: 1, label: "y" }]);
    // Channel 0 is sorted-monotonic → the inferred honest default is a line.
    expect(result.current.mark).toBe("line");
    expect(useApp.getState().graphBuilderSeed).toBeNull(); // one-shot
  });

  it("consumes a seed handed while the panel is already open (even across a rebind)", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "run.dat", data: DATA },
        { id: "d2", name: "other.dat", data: DATA },
      ],
    });
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 2)); // some prior state to overwrite
    act(() => {
      // The worksheet handoff for a NON-active dataset rebinds first, then
      // seeds — the dataset-change wipe and the seed land in the same commit,
      // and the seed (declared after the wipe) must win.
      useApp.setState({ activeId: "d2" });
      useApp.getState().openGraphBuilderSeeded(seedFor("d2"));
    });
    expect(result.current.chips("y")).toEqual([{ channel: 1, label: "y" }]);
    expect(useApp.getState().graphBuilderSeed).toBeNull();
  });

  it("#8i: accepts a seed for an existing NON-active dataset — wells bind to ITS labels", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "run.dat", data: DATA },
        { id: "d2", name: "other.dat", data: { ...DATA, labels: ["t", "sig", "g", "f"] } },
      ],
      activeId: "d1",
    });
    act(() => useApp.getState().openGraphBuilderSeeded(seedFor("d2")));
    const { result } = renderHook(() => useGraphBuilder());
    // Bound to d2: labels resolve from d2, NOT the active d1 — and the
    // handoff never fired setActive's plot-intent side effects.
    expect(result.current.datasetId).toBe("d2");
    expect(result.current.chips("y")).toEqual([{ channel: 1, label: "sig" }]);
    expect(useApp.getState().activeId).toBe("d1");
    expect(useApp.getState().graphBuilderSeed).toBeNull();
  });

  it("drops (and clears) a seed for a dataset that doesn't exist — a stale/misrouted producer", () => {
    act(() => useApp.getState().openGraphBuilderSeeded(seedFor("missing")));
    const { result } = renderHook(() => useGraphBuilder());
    expect(result.current.chips("y")).toEqual([]);
    expect(useApp.getState().graphBuilderSeed).toBeNull();
  });
});

describe("useGraphBuilder — send to stage", () => {
  it("scatter/line applies X/Y through the axis store actions and leaves stat mode", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.sendToStage());
    expect(useApp.getState().xKey).toBe(0);
    expect(useApp.getState().yKeys).toEqual([1]);
    expect(useApp.getState().statMode).toBe(false);
  });

  it("#8i: a builder bound to a NON-active dataset rebinds active at SEND time, not before", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "run.dat", data: DATA },
        { id: "d2", name: "other.dat", data: DATA },
      ],
      activeId: "d1",
    });
    act(() =>
      useApp.getState().openGraphBuilderSeeded({
        version: 1,
        zones: {
          x: { datasetId: "d2", channel: 0 },
          y: [{ datasetId: "d2", channel: 1 }],
          group: null,
          facet: null,
        },
        mark: "scatter",
      }),
    );
    const { result } = renderHook(() => useGraphBuilder());
    expect(useApp.getState().activeId).toBe("d1"); // open moved nothing
    act(() => result.current.sendToStage());
    const s = useApp.getState();
    expect(s.activeId).toBe("d2"); // the plot intent landed with the commit
    expect(s.xKey).toBe(0);
    expect(s.yKeys).toEqual([1]);
  });

  it("box/violin seeds the stat stage pickers and switches stat mode on", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("x", 2)); // nominal → box
    act(() => result.current.sendToStage());
    expect(useApp.getState().statStageSeed).toEqual({ mode: "box", groupCol: 2, valueCol: 1, facetCol: null });
    expect(useApp.getState().statMode).toBe(true);
  });

  // GUI_INTERACTION #11 residual: box/violin/bar now facet too (mirrors the
  // xy family's own facet send above).
  it("box WITH a facet zone seeds facetCol and mentions it in the status", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("x", 2)); // nominal → box
    act(() => result.current.assign("facet", 3)); // 2-level nominal facet column
    act(() => result.current.sendToStage());
    expect(useApp.getState().statStageSeed).toEqual({ mode: "box", groupCol: 2, valueCol: 1, facetCol: 3 });
    expect(useApp.getState().status).toContain("faceted by fct");
  });

  it("bar WITH a facet zone seeds facetCol and mentions it in the status", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("x", 2)); // nominal → box
    act(() => result.current.cycle()); // box -> violin
    act(() => result.current.cycle()); // violin -> bar
    act(() => result.current.assign("facet", 3));
    act(() => result.current.sendToStage());
    expect(useApp.getState().statStageSeed).toEqual({ mode: "bar", groupCol: 2, valueCol: 1, facetCol: 3 });
    expect(useApp.getState().status).toContain("faceted by fct");
  });

  it("scatter/line WITH a facet zone is unaffected by the box/bar facet seed change (regression)", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("facet", 3));
    act(() => result.current.sendToStage());
    // The xy family never touches statStageSeed at all.
    expect(useApp.getState().statStageSeed).toBeNull();
    expect(useApp.getState().status).toContain("faceted by fct");
  });

  // Owner-routing item 1 ("have to remember to toggle up"): every branch of
  // sendToStage renders inside the Plot tab (scatter/line on the canvas,
  // box/violin/bar via StatStage), so it must surface that tab regardless of
  // where the user currently is.
  it("forces the Plot tab even when starting on Worksheet — scatter/line", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.sendToStage());
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("forces the Plot tab even when starting on Worksheet — box/violin", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("x", 2));
    act(() => result.current.sendToStage());
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("scatter/line WITH a facet zone enters the main Stage's facet grid (gap #21 residual)", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("facet", 3)); // 2-level nominal facet column
    act(() => result.current.sendToStage());
    const s = useApp.getState();
    expect(s.stackMode).toBe(true);
    expect(s.facetPanels).toHaveLength(2);
    expect(s.spatialPanels).toBeNull();
    // facetByColumn read the x/y selection just assigned (channel 0/1, not
    // the time axis / all-channels default), baking it into each panel's
    // payload.
    expect(s.facetPanels?.[0].payload.xLabel).toBe("x");
    expect(s.facetPanels?.[0].payload.series.map((ser) => ser.label)).toEqual(["y"]);
    // FIXED (GUI_INTERACTION #12 slice 4b): facetByColumn's own trailing
    // setActive call used to reset the LIVE xKey/yKeys to null even though
    // `ds.id` was already active — store/windows.ts's focusedRebindPatch now
    // only resets channel-keyed defaults on a genuine dataset switch, so the
    // just-assigned selection survives on the live store too (a subsequent
    // export now reflects it instead of the default dense-channel set).
    expect(s.xKey).toBe(0);
    expect(s.yKeys).toEqual([1]);
  });

  it("scatter/line WITHOUT a facet zone does not touch facetPanels/stackMode", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.sendToStage());
    const s = useApp.getState();
    expect(s.facetPanels).toBeNull();
    expect(s.stackMode).toBe(false);
  });
});

describe("useGraphBuilder — open in Figure Builder", () => {
  it("opens an ordinary scatter as an ephemeral point-only FigureDoc", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    expect(result.current.mark).toBe("scatter");
    expect(result.current.canOpenFigureBuilder).toBe(true);

    act(() => result.current.openInFigureBuilder());

    const state = useApp.getState();
    expect(state.figureBuilderOpen).toBe(true);
    expect(state.figureDocs).toEqual([]); // draft is not silently saved
    expect(state.figureDocSeed?.config).toMatchObject({ xKey: 0, yKeys: [1] });
    expect(state.figureDocSeed?.config.seriesStyles?.[0]).toMatchObject({
      line: "none",
      marker: true,
    });
  });

  it("fails closed when a group or facet would be lost", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("group", 2));
    expect(result.current.canOpenFigureBuilder).toBe(false);
    expect(result.current.figureBuilderReason).toContain("Grouped");
    act(() => result.current.openInFigureBuilder());
    expect(useApp.getState().figureBuilderOpen).toBe(false);
    expect(useApp.getState().figureDocSeed).toBeNull();
  });

  it("preserves an explicit Y reorder through save, Stage, and Figure Builder", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("y", 2));
    act(() => result.current.moveY(2, -1));
    expect(result.current.chips("y").map((chip) => chip.channel)).toEqual([2, 1]);

    act(() => result.current.saveAs("Ordered"));
    expect(result.current.activeSpec?.spec.zones.y.map((ref) => ref.channel)).toEqual([2, 1]);
    act(() => result.current.sendToStage());
    expect(useApp.getState().yKeys).toEqual([2, 1]);
    act(() => result.current.openInFigureBuilder());
    expect(useApp.getState().figureDocSeed?.config.yKeys).toEqual([2, 1]);
  });
});

describe("useGraphBuilder — saved PlotSpecs (GUI_INTERACTION_PLAN #11)", () => {
  it("starts with nothing active and not dirty", () => {
    const { result } = renderHook(() => useGraphBuilder());
    expect(result.current.activeSpec).toBeNull();
    expect(result.current.dirty).toBe(false);
    expect(result.current.savedSpecs).toEqual([]);
  });

  it("saveAs creates a saved entry, activates it, and clears dirty", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.saveAs("My scatter"));
    expect(result.current.savedSpecs).toHaveLength(1);
    expect(result.current.activeSpec?.name).toBe("My scatter");
    expect(result.current.dirty).toBe(false);
    expect(useApp.getState().activePlotSpecId).toBe(result.current.activeSpec?.id);
  });

  it("editing a saved graph's wells flips dirty true; saveActive clears it again", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.saveAs("My scatter"));
    expect(result.current.dirty).toBe(false);
    act(() => result.current.assign("y", 2)); // add a second Y — diverges from the saved payload
    expect(result.current.dirty).toBe(true);
    act(() => result.current.saveActive());
    expect(result.current.dirty).toBe(false);
    expect(result.current.activeSpec?.spec.zones.y).toHaveLength(2);
  });

  it("saveActive is a no-op when nothing is active", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.saveActive());
    expect(result.current.savedSpecs).toEqual([]);
  });

  it("openSpec restores the builder state exactly (item 3)", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.saveAs("Saved one"));
    const id = result.current.activeSpec!.id;
    act(() => result.current.reset()); // fresh builder, unbound
    expect(result.current.activeSpec).toBeNull();
    expect(result.current.chips("y")).toHaveLength(0);
    act(() => result.current.openSpec(id));
    expect(result.current.activeSpec?.id).toBe(id);
    expect(result.current.chips("x")).toEqual([{ channel: 0, label: "x" }]);
    expect(result.current.chips("y")).toEqual([{ channel: 1, label: "y" }]);
    expect(result.current.dirty).toBe(false);
  });

  it("duplicateSpec copies the STORED payload under an auto-named copy and opens it", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.saveAs("Original"));
    const origId = result.current.activeSpec!.id;
    act(() => result.current.duplicateSpec(origId));
    expect(result.current.savedSpecs).toHaveLength(2);
    expect(result.current.activeSpec?.name).toBe("Original copy");
    expect(result.current.activeSpec?.id).not.toBe(origId);
    expect(result.current.chips("y")).toEqual([{ channel: 1, label: "y" }]);
  });

  it("renameSpec + deleteSpec pass through to the store", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.saveAs("Old"));
    const id = result.current.activeSpec!.id;
    act(() => result.current.renameSpec(id, "New name"));
    expect(result.current.savedSpecs[0].name).toBe("New name");
    act(() => result.current.deleteSpec(id));
    expect(result.current.savedSpecs).toEqual([]);
    expect(result.current.activeSpec).toBeNull();
  });

  it("Reset unbinds from the active saved spec", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.saveAs("Bound"));
    expect(result.current.activeSpec).not.toBeNull();
    act(() => result.current.reset());
    expect(result.current.activeSpec).toBeNull();
    expect(useApp.getState().activePlotSpecId).toBeNull();
  });

  it("a vanished bound dataset also clears activePlotSpecId", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.saveAs("Bound"));
    act(() => {
      useApp.setState({ datasets: [{ id: "d2", name: "other.dat", data: DATA }], activeId: "d2" });
    });
    expect(useApp.getState().activePlotSpecId).toBeNull();
  });

  it("a worksheet seed starts unbound even if a spec was active before", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.saveAs("Bound"));
    act(() =>
      useApp.getState().openGraphBuilderSeeded({
        version: 1,
        zones: { x: { datasetId: "d1", channel: 0 }, y: [{ datasetId: "d1", channel: 1 }], group: null, facet: null },
        mark: "scatter",
      }),
    );
    expect(useApp.getState().activePlotSpecId).toBeNull();
  });
});

describe("useGraphBuilder — capture on save (GUI_INTERACTION_PLAN #12 Slice 3)", () => {
  // The axis/style singleton fields below aren't touched by the outer
  // beforeEach (no other test in this file reads them) — reset them here so
  // test order relative to other describe blocks can never leak state in.
  beforeEach(() => {
    useApp.setState({
      seriesStyles: {},
      hiddenChannels: [],
      seriesOrder: null,
      y2Keys: null,
      xAxisLabel: "",
      yAxisLabel: "",
      y2AxisLabel: "",
      xLim: null,
      yLim: null,
      y2Lim: null,
      xScale: "linear",
      yScale: "linear",
      y2Scale: null,
      xStep: null,
      yStep: null,
      plotTitle: "",
    });
  });

  it("styled state captures a v2 display block scoped to the spec's plotted channels (zones.y ∪ zones.x)", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => {
      useApp.setState({
        seriesStyles: {
          0: { color: "#111111" }, // the X channel — also "plotted" per zones.y ∪ zones.x
          1: { color: "#ff0000", width: 2 },
          2: { color: "#00ff00" }, // NOT in this spec's zones — must never leak in
        },
      });
    });
    act(() => result.current.saveAs("Styled"));
    const saved = result.current.activeSpec!.spec;
    expect(saved.version).toBe(2);
    expect(saved.display?.series).toEqual({
      0: { color: "#111111" },
      1: { color: "#ff0000", width: 2 },
    });
  });

  it("all-default styling state stays v1 — no blocks captured", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.saveAs("Plain"));
    const saved = result.current.activeSpec!.spec;
    expect(saved.version).toBe(1);
    expect(saved.display).toBeUndefined();
    expect(saved.axes).toBeUndefined();
  });

  it("captures live axis label/limits into a v2 axes block", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => useApp.setState({ xAxisLabel: "Field (Oe)", yLim: [0, 100] }));
    act(() => result.current.saveAs("Axis-styled"));
    const saved = result.current.activeSpec!.spec;
    expect(saved.version).toBe(2);
    expect(saved.axes?.x?.label).toBe("Field (Oe)");
    expect(saved.axes?.y?.lim).toEqual([0, 100]);
  });

  it("a spec bound to a NON-active dataset saves zones-only — no live state to read (#8i)", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "run.dat", data: DATA },
        { id: "d2", name: "other.dat", data: DATA },
      ],
      activeId: "d1",
    });
    act(() =>
      useApp.getState().openGraphBuilderSeeded({
        version: 1,
        zones: { x: { datasetId: "d2", channel: 0 }, y: [{ datasetId: "d2", channel: 1 }], group: null, facet: null },
        mark: "scatter",
      }),
    );
    const { result } = renderHook(() => useGraphBuilder());
    expect(result.current.datasetId).toBe("d2"); // bound, but NOT active (d1 is)
    // The live singleton fields describe whichever dataset/window is
    // actually active (d1) — they have nothing to do with d2's would-be
    // plot, so even real styling here must never leak into a d2-bound save.
    act(() => useApp.setState({ seriesStyles: { 1: { color: "#ff0000" } } }));
    act(() => result.current.saveAs("Non-active bound"));
    const saved = result.current.activeSpec!.spec;
    expect(saved.version).toBe(1);
    expect(saved.display).toBeUndefined();
    expect(saved.axes).toBeUndefined();
  });

  // The subtle bug this slice has to avoid: captureLiveBlocks hands the
  // STORE a spec with fresh blocks, but the live builder `spec` (component
  // state) never gets those blocks back — a full-spec dirty comparison
  // (plotSpecsEqual) would therefore misread this as an unsaved change the
  // instant the save completes. useGraphBuilder's `dirty` now uses
  // plotSpecCoreEqual (zones+mark only) specifically to avoid this.
  it("dirty stays false immediately after a save that captured v2 blocks", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => useApp.setState({ seriesStyles: { 1: { color: "#ff0000" } } }));
    act(() => result.current.saveAs("Styled"));
    expect(result.current.activeSpec?.spec.version).toBe(2); // sanity: really is v2
    expect(result.current.dirty).toBe(false);
  });

  // The mirror case named explicitly in the slice's design: reopening a v2
  // spec must not false-flag dirty either — a regression guard against a
  // plausible-sounding but wrong future "fix" to openSpec (stripping blocks
  // off the live spec on the theory that unapplied blocks shouldn't be
  // carried — they should; see openSpec's own doc, blocks apply in Slice 5).
  it("dirty stays false immediately after reopening a v2 saved spec", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => useApp.setState({ seriesStyles: { 1: { color: "#ff0000" } } }));
    act(() => result.current.saveAs("Styled"));
    const id = result.current.activeSpec!.id;
    act(() => result.current.reset());
    expect(result.current.activeSpec).toBeNull();

    act(() => result.current.openSpec(id));
    expect(result.current.activeSpec?.id).toBe(id);
    expect(result.current.activeSpec?.spec.version).toBe(2); // sanity: really reopened v2
    expect(result.current.dirty).toBe(false);
  });
});

describe("useGraphBuilder — exportPlot (item 6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(exportFigure).mockResolvedValue(undefined);
  });

  it("scatter/line: sends to stage, then exports via the existing Export-figure path", async () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    await act(async () => result.current.exportPlot());
    expect(useApp.getState().xKey).toBe(0);
    expect(useApp.getState().yKeys).toEqual([1]);
    expect(exportFigure).toHaveBeenCalledTimes(1);
  });

  it("box/violin: sends to stage but does NOT call the xy export path", async () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("x", 2)); // nominal → box
    await act(async () => result.current.exportPlot());
    expect(useApp.getState().statMode).toBe(true);
    expect(exportFigure).not.toHaveBeenCalled();
  });

  it("is a no-op when nothing can be sent", async () => {
    const { result } = renderHook(() => useGraphBuilder());
    await act(async () => result.current.exportPlot());
    expect(exportFigure).not.toHaveBeenCalled();
  });
});

describe("useGraphBuilder — apply saved blocks on Send (GUI_INTERACTION_PLAN #12 Slice 5)", () => {
  // Same isolation rationale as the "capture on save" describe block above —
  // these fields aren't touched by the outer beforeEach.
  beforeEach(() => {
    useApp.setState({
      seriesStyles: {},
      hiddenChannels: [],
      seriesOrder: null,
      y2Keys: null,
      y2Lim: null,
      y2Scale: null,
      y2AxisLabel: "",
      xAxisLabel: "",
      yAxisLabel: "",
      xLim: null,
      yLim: null,
      xScale: "linear",
      yScale: "linear",
      xStep: null,
      yStep: null,
      plotTitle: "",
      y2Fmt: null,
    });
  });

  it("regression pin: a v1 spec's sendToStage leaves every style/axis field byte-identical", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() =>
      useApp.setState({
        seriesStyles: { 1: { color: "#ff0000" } },
        hiddenChannels: [2],
        y2Keys: [3],
        seriesOrder: [1, 0],
        xLim: [0, 10],
        plotTitle: "Keep me",
      }),
    );
    const before = useApp.getState();
    const snapshot = {
      seriesStyles: before.seriesStyles,
      hiddenChannels: before.hiddenChannels,
      y2Keys: before.y2Keys,
      seriesOrder: before.seriesOrder,
      xLim: before.xLim,
      plotTitle: before.plotTitle,
    };
    expect(result.current.activeSpec?.spec.version).not.toBe(2); // sanity: nothing saved, this is a plain v1 spec
    act(() => result.current.sendToStage());
    const s = useApp.getState();
    expect(s.seriesStyles).toEqual(snapshot.seriesStyles);
    expect(s.hiddenChannels).toEqual(snapshot.hiddenChannels);
    expect(s.y2Keys).toEqual(snapshot.y2Keys);
    expect(s.seriesOrder).toEqual(snapshot.seriesOrder);
    expect(s.xLim).toEqual(snapshot.xLim);
    expect(s.plotTitle).toEqual(snapshot.plotTitle);
  });

  // THE acceptance test of the #12 campaign so far: save captures the live
  // display/axes state (Slice 3), reopening restores the BUILDER's wells
  // (item 3, pre-#12), and now Send restores the STORE's style/axis state
  // too — the full save → reopen → send loop.
  it("FULL LOOP: save styled → reset → reopen → send → styles/limits/y2 restored", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("y", 2)); // second Y channel — will ride y2
    act(() =>
      useApp.setState({
        seriesStyles: { 1: { color: "#ff0000", width: 2 }, 2: { color: "#00ff00" } },
        y2Keys: [2],
        xAxisLabel: "Field (Oe)",
        yLim: [0, 100],
        plotTitle: "My Plot",
        y2Fmt: { mode: "fixed", digits: 1 },
      }),
    );
    act(() => result.current.saveAs("Styled"));
    const saved = result.current.activeSpec!.spec;
    expect(saved.version).toBe(2);
    expect(saved.display?.series).toEqual({
      1: { color: "#ff0000", width: 2 },
      2: { color: "#00ff00", axis: 1 },
    });
    expect(saved.axes?.x?.label).toBe("Field (Oe)");
    expect(saved.axes?.y?.lim).toEqual([0, 100]);
    expect(saved.axes?.title).toBe("My Plot");
    expect(saved.axes?.y2?.fmt).toEqual({ mode: "fixed", digits: 1 });
    const id = result.current.activeSpec!.id;

    // Simulate the user wandering off and changing everything before
    // reopening — a bare "reset" the way a real session would leave things.
    act(() =>
      useApp.setState({
        seriesStyles: {},
        hiddenChannels: [],
        y2Keys: null,
        y2Lim: null,
        xAxisLabel: "",
        yLim: null,
        plotTitle: "",
        y2Fmt: null,
      }),
    );
    act(() => result.current.reset());
    expect(result.current.activeSpec).toBeNull();
    expect(result.current.chips("y")).toHaveLength(0);

    // Reopen: the builder's wells restore (pre-#12 behavior), but the STORE
    // is still the "wandered off" state — blocks haven't applied yet.
    act(() => result.current.openSpec(id));
    expect(result.current.activeSpec?.id).toBe(id);
    expect(result.current.chips("y").map((c) => c.channel)).toEqual([1, 2]);
    expect(useApp.getState().seriesStyles).toEqual({}); // NOT yet applied — Send does that

    // Send: NOW the blocks apply.
    act(() => result.current.sendToStage());
    const s = useApp.getState();
    expect(s.yKeys).toEqual([1, 2]);
    expect(s.seriesStyles[1]).toMatchObject({ color: "#ff0000", width: 2 });
    expect(s.seriesStyles[2]).toMatchObject({ color: "#00ff00" });
    expect(s.y2Keys).toEqual([2]);
    expect(s.xAxisLabel).toBe("Field (Oe)");
    expect(s.yLim).toEqual([0, 100]);
    expect(s.plotTitle).toBe("My Plot");
    expect(s.y2Fmt).toEqual({ mode: "fixed", digits: 1 });
  });

  it("openSpec's status message flags a saved spec that carries display/axes blocks", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => useApp.setState({ seriesStyles: { 1: { color: "#ff0000" } } }));
    act(() => result.current.saveAs("Styled"));
    const styledId = result.current.activeSpec!.id;
    act(() => result.current.reset());

    act(() => result.current.openSpec(styledId));
    expect(useApp.getState().status).toBe(
      'opened "Styled" (includes saved styles — Send to Stage applies them)',
    );
  });

  it("openSpec's status message is plain for a v1 (blocks-free) saved spec", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.saveAs("Plain"));
    const plainId = result.current.activeSpec!.id;
    act(() => result.current.reset());

    act(() => result.current.openSpec(plainId));
    expect(useApp.getState().status).toBe('opened "Plain"');
  });
});
