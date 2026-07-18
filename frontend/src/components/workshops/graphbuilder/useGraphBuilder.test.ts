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
    expect(useApp.getState().statStageSeed).toEqual({ mode: "box", groupCol: 2, valueCol: 1 });
    expect(useApp.getState().statMode).toBe(true);
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
    // facetByColumn's own setActive resets the LIVE xKey/yKeys to null (same
    // as the App.tsx "Facet by column…" command path), but it read the x/y
    // selection just assigned (channel 0/1, not the time axis / all-channels
    // default) BEFORE that reset, baking it into each panel's payload.
    expect(s.facetPanels?.[0].payload.xLabel).toBe("x");
    expect(s.facetPanels?.[0].payload.series.map((ser) => ser.label)).toEqual(["y"]);
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
