import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigure } from "../../../lib/api";
import { facetPanelsOf, spatialPanelsOf } from "../../../lib/composition";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useToasts } from "../../../store/toasts";
import { askConfirm } from "../../overlays/ConfirmDialog";
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

vi.mock("../../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

// channel 0 monotonic continuous x, channel 1 continuous y, channel 2 a 2-level
// nominal grouping column (needs ≥12 rows for nominal inference), channel 3 a
// 2-level nominal FACET column (gap #21 residual — same 6/6 split as channel 2
// so a facet application has 2 finite levels to build panels from).
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

const INITIAL_WINDOWS = useApp.getState().plotWindows;
const INITIAL_FOCUSED_WINDOW_ID = useApp.getState().focusedWindowId;

beforeEach(() => {
  vi.mocked(askConfirm).mockReset();
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    status: "",
    xKey: null,
    yKeys: null,
    groupKey: null,
    y2Keys: null,
    statMode: false,
    statStageSeed: null,
    graphBuilderSeed: null,
    savedPlotSpecs: [],
    activePlotSpecId: null,
    macroRecording: false,
    stackMode: false,
    composition: null,
    figureBuilderOpen: false,
    figureDocSeed: null,
    figurePublicationSession: null,
    editableFigures: [],
    figureDocs: [],
    seriesStyles: {},
    // Undo history is otherwise a growing, capped (HISTORY_DEPTH=50) stack
    // shared across every test in this file — without resetting it here, an
    // EARLIER test's history-generating actions (setSeriesStyle, etc.) can
    // saturate the cap before a LATER test's own "+1 after one action"
    // assertion runs, making that assertion's outcome depend on test order/
    // count rather than its own behavior.
    history: [],
    future: [],
    // Owner-routing item 1: starts parked on Worksheet so "applyToCurrent
    // surfaces the Plot tab" assertions below don't need a separate fixture.
    stageTab: "worksheet",
    plotWindows: INITIAL_WINDOWS,
    focusedWindowId: INITIAL_FOCUSED_WINDOW_ID,
  });
});

describe("useGraphBuilder — morphing", () => {
  it("starts empty with an incomplete hint", () => {
    const { result } = renderHook(() => useGraphBuilder());
    expect(result.current.render.kind).toBe("message");
    expect(result.current.canPlot).toBe(false);
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

  it("#8i: a BOUND session survives an active-dataset change (a plot action restores its dataset)", () => {
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
      yErr: [],
      xErr: null,
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

describe("useGraphBuilder — explicit plot destinations", () => {
  it("creates and focuses a fresh editable plot by default", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    const before = useApp.getState();

    act(() => result.current.createNewPlot());

    const after = useApp.getState();
    expect(after.plotWindows).toHaveLength(before.plotWindows.length + 1);
    expect(after.focusedWindowId).not.toBe(before.focusedWindowId);
    expect(after.plotWindows.find((window) => window.id === after.focusedWindowId)).toMatchObject({
      kind: "plot",
      datasetId: "d1",
    });
    expect(after.xKey).toBe(0);
    expect(after.yKeys).toEqual([1]);
    expect(after.status).toBe("created scatter plot");
  });

  it("applies to the focused editable plot without creating another window", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    const before = useApp.getState();

    act(() => result.current.applyToCurrent());

    const after = useApp.getState();
    expect(result.current.canApplyToCurrent).toBe(true);
    expect(after.plotWindows).toHaveLength(before.plotWindows.length);
    expect(after.focusedWindowId).toBe(before.focusedWindowId);
    expect(after.xKey).toBe(0);
    expect(after.yKeys).toEqual([1]);
    expect(after.status).toBe("applied scatter to the current plot");
  });

  it("disables Apply to Current Plot when no editable plot is focused", () => {
    useApp.setState({ focusedWindowId: null });
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));

    expect(result.current.canPlot).toBe(true);
    expect(result.current.canApplyToCurrent).toBe(false);
  });

  it("scatter/line applies X/Y through the axis store actions and leaves stat mode", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.applyToCurrent());
    expect(useApp.getState().xKey).toBe(0);
    expect(useApp.getState().yKeys).toEqual([1]);
    expect(useApp.getState().statMode).toBe(false);
  });

  it("#8i: Apply explicitly rebinds the focused plot at commit time, even when pinned", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "run.dat", data: DATA },
        { id: "d2", name: "other.dat", data: DATA },
      ],
      activeId: "d1",
      plotWindows: INITIAL_WINDOWS.map((window) => ({
        ...window,
        datasetId: "d1",
        pinned: true,
      })),
    });
    act(() =>
      useApp.getState().openGraphBuilderSeeded({
        version: 1,
        zones: {
          x: { datasetId: "d2", channel: 0 },
          y: [{ datasetId: "d2", channel: 1 }],
          group: null,
          facet: null,
          yErr: [],
          xErr: null,
        },
        mark: "scatter",
      }),
    );
    const { result } = renderHook(() => useGraphBuilder());
    const focusedBefore = useApp.getState().focusedWindowId;
    const countBefore = useApp.getState().plotWindows.length;
    expect(useApp.getState().activeId).toBe("d1"); // open moved nothing
    act(() => result.current.applyToCurrent());
    const s = useApp.getState();
    expect(s.activeId).toBe("d2"); // the plot intent landed with the commit
    expect(s.focusedWindowId).toBe(focusedBefore);
    expect(s.plotWindows).toHaveLength(countBefore);
    expect(s.plotWindows.find((window) => window.id === focusedBefore)).toMatchObject({
      datasetId: "d2",
      pinned: true,
    });
    expect(s.xKey).toBe(0);
    expect(s.yKeys).toEqual([1]);
  });

  it("box/violin seeds the stat stage pickers and switches stat mode on", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("x", 2)); // nominal → box
    act(() => result.current.applyToCurrent());
    expect(useApp.getState().statStageSeed).toEqual({ mode: "box", groupCol: 2, valueCol: 1, facetCol: null });
    expect(useApp.getState().statMode).toBe(true);
  });

  // GUI_INTERACTION #11 residual: box/violin/bar now facet too (mirrors the
  // xy family's own facet application above).
  it("box WITH a facet zone seeds facetCol and mentions it in the status", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("x", 2)); // nominal → box
    act(() => result.current.assign("facet", 3)); // 2-level nominal facet column
    act(() => result.current.applyToCurrent());
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
    act(() => result.current.applyToCurrent());
    expect(useApp.getState().statStageSeed).toEqual({ mode: "bar", groupCol: 2, valueCol: 1, facetCol: 3 });
    expect(useApp.getState().status).toContain("faceted by fct");
  });

  it("scatter/line WITH a facet zone is unaffected by the box/bar facet seed change (regression)", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("facet", 3));
    act(() => result.current.applyToCurrent());
    // The xy family never touches statStageSeed at all.
    expect(useApp.getState().statStageSeed).toBeNull();
    expect(useApp.getState().status).toContain("faceted by fct");
  });

  // Owner-routing item 1 ("have to remember to toggle up"): every branch of
  // applying renders inside the Plot tab (scatter/line on the canvas,
  // box/violin/bar via StatStage), so it must surface that tab regardless of
  // where the user currently is.
  it("forces the Plot tab even when starting on Worksheet — scatter/line", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.applyToCurrent());
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("forces the Plot tab even when starting on Worksheet — box/violin", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("x", 2));
    act(() => result.current.applyToCurrent());
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("scatter/line WITH a facet zone enters the main Stage's facet grid (gap #21 residual)", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("facet", 3)); // 2-level nominal facet column
    act(() => result.current.applyToCurrent());
    const s = useApp.getState();
    expect(s.stackMode).toBe(true);
    expect(facetPanelsOf(s.composition)).toHaveLength(2);
    expect(spatialPanelsOf(s.composition)).toBeNull();
    // facetByColumn read the x/y selection just assigned (channel 0/1, not
    // the time axis / all-channels default), baking it into each panel's
    // payload.
    expect(facetPanelsOf(s.composition)?.[0].payload.xLabel).toBe("x");
    expect(facetPanelsOf(s.composition)?.[0].payload.series.map((ser) => ser.label)).toEqual(["y"]);
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
    act(() => result.current.applyToCurrent());
    const s = useApp.getState();
    expect(facetPanelsOf(s.composition)).toBeNull();
    expect(s.stackMode).toBe(false);
  });
});

// P1.5 (PRIMARY_SOFTWARE_AUDIT_PLAN): "durable live grouped series" -- a
// Group-well drop used to only drive the Graph Builder's OWN offline
// preview; committing to the actual Stage window silently dropped it behind
// a "preview-only" toast (this describe's RED-first baseline). It's now a
// first-class live window binding (store.groupKey), the same durability
// facetByColumn already had.
describe("useGraphBuilder — Group well reaches the live Stage (P1.5)", () => {
  it("scatter/line WITH a group zone sets the live groupKey on commit", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("group", 2)); // 2-level nominal grouping column
    act(() => result.current.applyToCurrent());
    expect(useApp.getState().groupKey).toBe(2);
  });

  it("does NOT show a preview-only toast anymore", () => {
    useToasts.setState({ toasts: [] });
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("group", 2));
    act(() => result.current.applyToCurrent());
    expect(useToasts.getState().toasts.some((t) => /preview-only/i.test(t.msg))).toBe(false);
  });

  it("scatter/line WITHOUT a group zone clears any stale live groupKey", () => {
    useApp.setState({ groupKey: 2 }); // a stale binding from a PRIOR grouped commit
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.applyToCurrent());
    expect(useApp.getState().groupKey).toBeNull();
  });

  it("createNewPlot on a fresh window also carries the group binding", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("group", 2));
    act(() => result.current.createNewPlot());
    expect(useApp.getState().groupKey).toBe(2);
  });
});

// GAP_PLOTTYPES: the mark used to NEVER reach the Stage — a committed
// scatter/step recipe rendered however the window was last styled (or the
// ambient "Preferences ▸ Plot ▸ Default trace"), not what the user built in
// Graph Builder. This is the failing-first regression coverage for that gap
// plus the new "step" mark / showMarkers / stepMode surface.
describe("useGraphBuilder — mark reaches the Stage (GAP_PLOTTYPES)", () => {
  beforeEach(() => {
    useApp.setState({ seriesStyles: {} });
  });

  it("gap #3: a scatter spec committed to a fresh window yields marker-visible styles", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    expect(result.current.mark).toBe("scatter"); // sanity: this assign sequence's sticky default
    act(() => result.current.createNewPlot());
    expect(useApp.getState().seriesStyles[1]).toEqual({ width: 0, marker: true });
  });

  it("applies the same override to EVERY plotted Y channel", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("y", 2));
    act(() => result.current.applyToCurrent());
    const s = useApp.getState().seriesStyles;
    expect(s[1]).toEqual({ width: 0, marker: true });
    expect(s[2]).toEqual({ width: 0, marker: true });
  });

  it("a plain line mark (no showMarkers) makes no seriesStyles call at all", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.cycle()); // scatter -> line
    expect(result.current.mark).toBe("line");
    act(() => result.current.applyToCurrent());
    expect(useApp.getState().seriesStyles).toEqual({});
  });

  it("line + showMarkers (Origin's Line + Symbol): markers on, no forced zero width", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.cycle()); // scatter -> line
    act(() => result.current.setShowMarkers(true));
    act(() => result.current.applyToCurrent());
    expect(useApp.getState().seriesStyles[1]).toEqual({ marker: true });
  });

  it("step mark: defaults to post with no markers", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.cycle()); // scatter -> line
    act(() => result.current.cycle()); // line -> step
    expect(result.current.mark).toBe("step");
    expect(result.current.stepMode).toBe("post");
    act(() => result.current.applyToCurrent());
    expect(useApp.getState().seriesStyles[1]).toEqual({ step: "post" });
  });

  it("step mark honors an explicit stepMode + showMarkers", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.cycle());
    act(() => result.current.cycle());
    act(() => result.current.setStepMode("mid"));
    act(() => result.current.setShowMarkers(true));
    act(() => result.current.applyToCurrent());
    expect(useApp.getState().seriesStyles[1]).toEqual({ step: "mid", marker: true });
  });

  it("a saved spec's own captured per-series style still wins over the mark default", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    // Hand-style channel 1 (a color the mark override must not clobber),
    // then save — this captures a v2 display block for channel 1.
    act(() => useApp.setState({ seriesStyles: { 1: { color: "#ff0000", width: 5 } } }));
    act(() => result.current.saveAs("Styled scatter"));
    const id = result.current.activeSpec!.id;
    // Wander off, reopen, apply — the captured display block's width:5 must
    // survive even though markSeriesStyle runs first and sets width:0.
    act(() => useApp.setState({ seriesStyles: {} }));
    act(() => result.current.openSpec(id));
    act(() => result.current.applyToCurrent());
    expect(useApp.getState().seriesStyles[1]).toMatchObject({ color: "#ff0000", width: 5 });
  });

  it("showMarkers/setShowMarkers and stepMode/setStepMode read/write the live spec", () => {
    const { result } = renderHook(() => useGraphBuilder());
    expect(result.current.showMarkers).toBe(false); // default when unset
    expect(result.current.stepMode).toBe("post"); // default when unset
    act(() => result.current.setShowMarkers(true));
    expect(result.current.showMarkers).toBe(true);
    act(() => result.current.setStepMode("pre"));
    expect(result.current.stepMode).toBe("pre");
  });

  it("saving a step spec captures stepMode/showMarkers and reopening restores them, staying v1", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.cycle());
    act(() => result.current.cycle());
    act(() => result.current.setStepMode("pre"));
    act(() => result.current.setShowMarkers(true));
    act(() => result.current.saveAs("Step recipe"));
    const saved = result.current.activeSpec!.spec;
    const id = result.current.activeSpec!.id;
    expect(saved.mark).toBe("step");
    expect(saved.stepMode).toBe("pre");
    expect(saved.showMarkers).toBe(true);
    expect(saved.version).toBe(1); // a v1 sibling of mark, never a v2 block

    act(() => result.current.reset());
    act(() => result.current.openSpec(id));
    expect(result.current.mark).toBe("step");
    expect(result.current.stepMode).toBe("pre");
    expect(result.current.showMarkers).toBe(true);
  });
});

// ── Error wells (ORIGIN_GAP_PLAN #51 phase 3 — the COLUMN-DESIGNATION model)
// ─────────────────────────────────────────────────────────────────────────
// channel 0 "R" / channel 1 "dR" (its error, leading-d convention) and
// channel 2 "S" / channel 3 "dS" (its error) -- two independent Y/error
// pairs so a reorder/regression test can prove yErr[1] pairs to y[1], not
// y[0]. channel 4 "xerr" is a dataset-wide X error.
const ERR_DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [1, 0.1, 5, 0.5, 0.01],
    [2, 0.2, 6, 0.6, 0.02],
    [3, 0.3, 7, 0.7, 0.03],
    [4, 0.4, 8, 0.8, 0.04],
  ],
  labels: ["R", "dR", "S", "dS", "xerr"],
  units: ["", "", "", "", ""],
  metadata: {},
};

describe("useGraphBuilder — error wells (#51 phase 3)", () => {
  it("auto-prefills yErr from an unambiguous inferred column when a fresh Y is dropped", () => {
    useApp.setState({ datasets: [{ id: "de", name: "err.dat", data: ERR_DATA }], activeId: "de" });
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 0)); // R
    expect(result.current.chips("yErr")).toEqual([{ channel: 1, label: "dR" }]);
  });

  it("does not prefill from a dataset with no recognizable error columns (ambiguous/none)", () => {
    const { result } = renderHook(() => useGraphBuilder()); // default DATA fixture, no error columns
    act(() => result.current.assign("y", 1));
    expect(result.current.chips("yErr")).toEqual([]);
    expect(result.current.chips("xErr")).toEqual([]);
  });

  it("never overwrites wells the user has touched, even when a later Y drop would be unambiguous", () => {
    useApp.setState({ datasets: [{ id: "de", name: "err.dat", data: ERR_DATA }], activeId: "de" });
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 0)); // R -> auto-prefills yErr [dR]
    expect(result.current.chips("yErr")).toEqual([{ channel: 1, label: "dR" }]);
    act(() => result.current.remove("yErr", 1)); // the user explicitly clears it -> touched
    expect(result.current.chips("yErr")).toEqual([]);
    act(() => result.current.assign("y", 2)); // S has an equally unambiguous dS
    // Still empty: touching the well once locks out every future auto-fill
    // for this session, not just the one column that was cleared.
    expect(result.current.chips("yErr")).toEqual([]);
  });

  it("a direct drop into the Y-error well also counts as touched", () => {
    useApp.setState({ datasets: [{ id: "de", name: "err.dat", data: ERR_DATA }], activeId: "de" });
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 0)); // R
    act(() => result.current.remove("yErr", 1)); // clear the auto-fill, touched=true
    act(() => result.current.assign("yErr", 3)); // user explicitly picks dS instead
    expect(result.current.chips("yErr")).toEqual([{ channel: 3, label: "dS" }]);
    act(() => result.current.assign("y", 2)); // adding S must not re-run inference over this
    expect(result.current.chips("yErr")).toEqual([{ channel: 3, label: "dS" }]);
  });

  it("commit position-pairs yErr with y through setErrorRoles (regression: y[1]'s error pairs to y[1], not y[0])", () => {
    useApp.setState({ datasets: [{ id: "de", name: "err.dat", data: ERR_DATA }], activeId: "de" });
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 2)); // S first -> yErr auto-fills [dS]
    act(() => result.current.assign("y", 0)); // then R -> yErr extends to [dS, dR]
    expect(result.current.chips("yErr")).toEqual([
      { channel: 3, label: "dS" },
      { channel: 1, label: "dR" },
    ]);
    act(() => result.current.applyToCurrent());
    const ds = useApp.getState().datasets.find((d) => d.id === "de")!;
    // xErr auto-prefills too (ERR_DATA's "xerr" column, dataset-wide,
    // independent of which Y channels are selected) -- not the focus of
    // this regression, but part of the honest commit output.
    expect(ds.errorRoles).toEqual([
      { channel: 3, target: 2, axis: "y", side: "both" }, // dS -> S (y[0])
      { channel: 1, target: 0, axis: "y", side: "both" }, // dR -> R (y[1])
      { channel: 4, target: -1, axis: "x", side: "both" },
    ]);
  });

  it("commit binds xErr to the x-axis sentinel target -1", () => {
    useApp.setState({ datasets: [{ id: "de", name: "err.dat", data: ERR_DATA }], activeId: "de" });
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 0));
    act(() => result.current.assign("xErr", 4)); // explicit, mirrors auto-prefill's own choice
    expect(result.current.chips("xErr")).toEqual([{ channel: 4, label: "xerr" }]);
    act(() => result.current.applyToCurrent());
    const ds = useApp.getState().datasets.find((d) => d.id === "de")!;
    expect(ds.errorRoles).toContainEqual({ channel: 4, target: -1, axis: "x", side: "both" });
  });

  it("an empty-wells commit leaves the dataset's existing error roles untouched", () => {
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "run.dat",
          data: DATA,
          errorRoles: [{ channel: 2, target: 1, axis: "y" as const, side: "both" as const }],
        },
      ],
      activeId: "d1",
    });
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1)); // DATA has no inferable errors -> wells stay empty
    expect(result.current.chips("yErr")).toEqual([]);
    act(() => result.current.applyToCurrent());
    const ds = useApp.getState().datasets.find((d) => d.id === "d1")!;
    expect(ds.errorRoles).toEqual([{ channel: 2, target: 1, axis: "y", side: "both" }]);
  });

  it("box/violin/bar commit ignores the error wells entirely (categorical marks never read them)", () => {
    // DATA's channel 2 ("grp") is nominal -- assigning it to X morphs the
    // mark to box. Wells CAN still hold content for a categorical spec
    // (validation keeps it, per plotspec.ts's doc) -- only commit/render
    // ignore it, which is exactly what this test pins.
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1)); // continuous
    act(() => result.current.assign("x", 2)); // nominal -> morphs to box
    expect(result.current.mark).toBe("box");
    act(() => result.current.assign("yErr", 0)); // wells still accept a drop
    expect(result.current.chips("yErr")).toEqual([{ channel: 0, label: "x" }]);
    act(() => result.current.applyToCurrent());
    const ds = useApp.getState().datasets.find((d) => d.id === "d1")!;
    expect(ds.errorRoles).toBeUndefined(); // setErrorRoles was never called
  });
});

describe("useGraphBuilder — open in Figure Builder", () => {
  it("opens an ordinary scatter as an ephemeral point-only FigureDoc", async () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    expect(result.current.mark).toBe("scatter");
    expect(result.current.canOpenFigureBuilder).toBe(true);

    await act(async () => result.current.openInFigureBuilder());

    const state = useApp.getState();
    expect(state.figureBuilderOpen).toBe(true);
    expect(state.figureDocs).toEqual([]); // draft is not silently saved
    expect(state.figureDocSeed).toBeNull();
    expect(state.figurePublicationSession).toMatchObject({
      target: "new-editable",
      windowId: null,
      draft: { bindings: { xKey: 0, yKeys: [1] } },
    });
    expect(state.figurePublicationSession?.draft.publication?.seriesStyles?.[0]).toMatchObject({
      line: "none",
      marker: true,
    });
  });

  it("keeps a saved PlotSpec unchanged and assigns a fresh canonical id for each detached preview", async () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.saveAs("Reusable recipe"));
    const recipe = structuredClone(useApp.getState().savedPlotSpecs);

    await act(async () => result.current.openInFigureBuilder());
    const firstId = useApp.getState().figurePublicationSession?.draft.id;
    expect(firstId).toBeTruthy();
    expect(useApp.getState().savedPlotSpecs).toEqual(recipe);
    expect(useApp.getState().figureDocSeed).toBeNull();

    act(() => useApp.getState().cancelFigurePublicationEdit());
    await act(async () => result.current.openInFigureBuilder());
    expect(useApp.getState().figurePublicationSession?.draft.id).not.toBe(firstId);
    expect(useApp.getState().savedPlotSpecs).toEqual(recipe);
  });

  it("keeps an existing preview and its refusal status when Graph Builder tries to open another", async () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    await act(async () => result.current.openInFigureBuilder());
    act(() => useApp.getState().patchFigurePublicationDraft((draft) => ({ ...draft, name: "Keep this preview" })));
    const session = structuredClone(useApp.getState().figurePublicationSession);

    await act(async () => result.current.openInFigureBuilder());
    expect(useApp.getState().figurePublicationSession).toEqual(session);
    expect(useApp.getState().status).toContain("finish or cancel");
  });

  it("applies a Graph Builder preview once without opening a window and undo removes only its editable figure", async () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.saveAs("Recipe source"));
    const recipe = structuredClone(useApp.getState().savedPlotSpecs);
    const windows = useApp.getState().plotWindows.length;
    const history = useApp.getState().history.length;

    await act(async () => result.current.openInFigureBuilder());
    const previewId = useApp.getState().figurePublicationSession?.draft.id;
    let applied = false;
    act(() => { applied = useApp.getState().applyFigurePublicationEdit(); });
    expect(applied).toBe(true);

    expect(useApp.getState().editableFigures).toMatchObject([{ id: previewId, name: "Recipe source" }]);
    expect(useApp.getState().savedPlotSpecs).toEqual(recipe);
    expect(useApp.getState().figureDocSeed).toBeNull();
    expect(useApp.getState().plotWindows).toHaveLength(windows);
    expect(useApp.getState().history).toHaveLength(history + 1);
    expect(useApp.getState().figurePublicationSession).toBeNull();

    act(() => useApp.getState().undo());
    expect(useApp.getState().editableFigures).toEqual([]);
    expect(useApp.getState().savedPlotSpecs).toEqual(recipe);
  });

  it("fails closed when a facet zone would be lost", async () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("facet", 2));
    expect(result.current.canOpenFigureBuilder).toBe(false);
    expect(result.current.figureBuilderReason).toContain("Faceted");
    await act(async () => result.current.openInFigureBuilder());
    expect(useApp.getState().figureBuilderOpen).toBe(false);
    expect(useApp.getState().figureDocSeed).toBeNull();
    expect(useApp.getState().figurePublicationSession).toBeNull();
  });

  it("requires confirmation before opening a PlotSpec with settings the preview omits", async () => {
    act(() => useApp.getState().openGraphBuilderSeeded({
      version: 2,
      zones: {
        x: { datasetId: "d1", channel: 0 },
        y: [{ datasetId: "d1", channel: 1 }],
        group: null,
        facet: null,
        yErr: [],
        xErr: null,
      },
      mark: "line",
      axes: { x: { step: 2, fmt: { mode: "fixed", digits: 1 } } },
    }));
    const { result } = renderHook(() => useGraphBuilder());
    expect(result.current.canOpenFigureBuilder).toBe(true);
    expect(result.current.figureBuilderLosses).toEqual([
      "axis tick spacing",
      "axis number formats",
    ]);

    vi.mocked(askConfirm).mockResolvedValueOnce(false);
    await act(async () => result.current.openInFigureBuilder());
    expect(useApp.getState().figureBuilderOpen).toBe(false);

    vi.mocked(askConfirm).mockResolvedValueOnce(true);
    await act(async () => result.current.openInFigureBuilder());
    expect(useApp.getState().figureBuilderOpen).toBe(true);
  });

  // GUI_INTERACTION #12 Slice 5: a group zone no longer fails closed --
  // Slice 3 investigated this and left it fail-closed for lack of a
  // group-split wire field; Slice 5 added FigureConfig.groupCol /
  // FigureSpec.group_col, so the doc now opens carrying the split.
  it("opens a grouped scatter as an ephemeral FigureDoc carrying groupCol", async () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("group", 2));
    expect(result.current.canOpenFigureBuilder).toBe(true);

    await act(async () => result.current.openInFigureBuilder());

    const state = useApp.getState();
    expect(state.figureBuilderOpen).toBe(true);
    expect(state.figureDocSeed).toBeNull();
    expect(state.figurePublicationSession?.draft.bindings).toMatchObject({ xKey: 0, yKeys: [1], groupKey: 2 });
  });

  it("preserves an explicit Y reorder through save, Stage, and Figure Builder", async () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("y", 2));
    act(() => result.current.moveY(2, -1));
    expect(result.current.chips("y").map((chip) => chip.channel)).toEqual([2, 1]);

    act(() => result.current.saveAs("Ordered"));
    expect(result.current.activeSpec?.spec.zones.y.map((ref) => ref.channel)).toEqual([2, 1]);
    act(() => result.current.applyToCurrent());
    expect(useApp.getState().yKeys).toEqual([2, 1]);
    await act(async () => result.current.openInFigureBuilder());
    expect(useApp.getState().figureDocSeed).toBeNull();
    expect(useApp.getState().figurePublicationSession?.draft.bindings.yKeys).toEqual([2, 1]);
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
        zones: {
          x: { datasetId: "d1", channel: 0 },
          y: [{ datasetId: "d1", channel: 1 }],
          group: null,
          facet: null,
          yErr: [],
          xErr: null,
        },
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
      // "part C" — same isolation rationale, extended to the decor fields.
      annotations: [],
      shapes: [],
      legendPos: "ne",
      legendXY: null,
      legendTitle: null,
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

  // #54 pass C — the page block. The gap this closes: page size / fit mode /
  // stacking are per-WINDOW state, so a spec (a portable, re-appliable
  // artifact) silently lost them on save/reopen before this.
  it("captures live page state into a v2 page block", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() =>
      useApp.setState({
        stackMode: true,
        panelFit: "page",
        pageSetup: {
          width: 8.5,
          height: 11,
          unit: "in",
          margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 },
          aspectDerived: false,
        },
      }),
    );
    act(() => result.current.saveAs("Paged"));
    const saved = result.current.activeSpec!.spec;
    expect(saved.version).toBe(2);
    expect(saved.page?.stack).toBe(true);
    expect(saved.page?.fit).toBe("page");
    expect(saved.page?.setup?.width).toBe(8.5);
    expect(saved.page?.setup?.unit).toBe("in");
  });

  it("an ordinary flat plot captures no page block (stays v1)", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => useApp.setState({ stackMode: false, panelFit: "frames", pageSetup: null }));
    act(() => result.current.saveAs("Flat"));
    const saved = result.current.activeSpec!.spec;
    expect(saved.version).toBe(1);
    expect(saved.page).toBeUndefined();
  });

  // "part C" — the item's last piece: annotations/shapes/legend placement.
  it("captures live annotations/shapes/legend into a v2 decor block", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => {
      useApp.getState().addAnnotation(1, 2, "peak");
      useApp.getState().addShape({ kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1 });
      useApp.getState().setLegendPos("sw");
    });
    act(() => result.current.saveAs("Decorated"));
    const saved = result.current.activeSpec!.spec;
    expect(saved.version).toBe(2);
    expect(saved.decor?.annotations).toMatchObject([{ x: 1, y: 2, text: "peak" }]);
    expect(saved.decor?.shapes).toMatchObject([{ kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1 }]);
    expect(saved.decor?.legend).toEqual({ pos: "sw" });
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
        zones: {
          x: { datasetId: "d2", channel: 0 },
          y: [{ datasetId: "d2", channel: 1 }],
          group: null,
          facet: null,
          yErr: [],
          xErr: null,
        },
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

  it("scatter/line: applies to the current plot, then uses the existing Export-figure path", async () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    await act(async () => result.current.exportPlot());
    expect(useApp.getState().xKey).toBe(0);
    expect(useApp.getState().yKeys).toEqual([1]);
    expect(exportFigure).toHaveBeenCalledTimes(1);
  });

  it("box/violin: applies to the stat stage but does NOT call the xy export path", async () => {
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

describe("useGraphBuilder — apply saved blocks on a plot action (GUI_INTERACTION_PLAN #12 Slice 5)", () => {
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
      // "part C" — same isolation rationale, extended to the decor fields.
      annotations: [],
      shapes: [],
      legendPos: "ne",
      legendXY: null,
      legendTitle: null,
    });
  });

  // Regression pin for applySpecBlocks specifically (display/axes/decor are
  // still an EXACT no-op for a v1 spec — no display block means
  // applyDisplayBlock never runs). seriesStyles is DELIBERATELY excluded
  // from the byte-identical claim as of GAP_PLOTTYPES: commitToPlot now
  // ALWAYS translates the spec's mark onto the plotted channel's style
  // (see the dedicated "mark reaches the Stage" describe block below) —
  // that's a separate, earlier step than applySpecBlocks, not a display-
  // block regression.
  it("regression pin: applying a v1 spec leaves axis/decor fields byte-identical (applySpecBlocks stays a no-op)", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => {
      useApp.setState({
        seriesStyles: { 1: { color: "#ff0000" } },
        hiddenChannels: [2],
        y2Keys: [3],
        seriesOrder: [1, 0],
        xLim: [0, 10],
        plotTitle: "Keep me",
      });
      useApp.getState().addAnnotation(1, 2, "keep me too");
      useApp.getState().addShape({ kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1 });
      useApp.getState().setLegendPos("sw");
    });
    const before = useApp.getState();
    const snapshot = {
      hiddenChannels: before.hiddenChannels,
      y2Keys: before.y2Keys,
      seriesOrder: before.seriesOrder,
      xLim: before.xLim,
      plotTitle: before.plotTitle,
      annotations: before.annotations,
      shapes: before.shapes,
      legendPos: before.legendPos,
    };
    expect(result.current.activeSpec?.spec.version).not.toBe(2); // sanity: nothing saved, this is a plain v1 spec
    expect(result.current.mark).toBe("scatter"); // sanity: this assign sequence's sticky default
    act(() => result.current.applyToCurrent());
    const s = useApp.getState();
    // GAP_PLOTTYPES: the scatter mark's own style override (width:0,
    // marker:true) MERGES onto channel 1's pre-existing color — never a
    // full-record replace (setSeriesStyle patches per-field).
    expect(s.seriesStyles).toEqual({ 1: { color: "#ff0000", width: 0, marker: true } });
    expect(s.hiddenChannels).toEqual(snapshot.hiddenChannels);
    expect(s.y2Keys).toEqual(snapshot.y2Keys);
    expect(s.seriesOrder).toEqual(snapshot.seriesOrder);
    expect(s.xLim).toEqual(snapshot.xLim);
    expect(s.plotTitle).toEqual(snapshot.plotTitle);
    expect(s.annotations).toEqual(snapshot.annotations);
    expect(s.shapes).toEqual(snapshot.shapes);
    expect(s.legendPos).toEqual(snapshot.legendPos);
  });

  // THE acceptance test of the #12 campaign so far: save captures the live
  // display/axes/decor state (Slice 3 + "part C"), reopening restores the
  // BUILDER's wells (item 3, pre-#12), and now applying restores the STORE's
  // style/axis/decor state too — the full save → reopen → apply loop.
  it("FULL LOOP: save styled → reset → reopen → apply → styles/limits/y2/decor restored", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("y", 2)); // second Y channel — will ride y2
    act(() => {
      useApp.setState({
        seriesStyles: { 1: { color: "#ff0000", width: 2 }, 2: { color: "#00ff00" } },
        y2Keys: [2],
        xAxisLabel: "Field (Oe)",
        yLim: [0, 100],
        plotTitle: "My Plot",
        y2Fmt: { mode: "fixed", digits: 1 },
      });
      useApp.getState().addAnnotation(1, 2, "peak");
      useApp.getState().addShape({ kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1 });
      useApp.getState().setLegendPos("sw");
    });
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
    expect(saved.decor?.annotations).toMatchObject([{ x: 1, y: 2, text: "peak" }]);
    expect(saved.decor?.shapes).toMatchObject([{ kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1 }]);
    expect(saved.decor?.legend).toEqual({ pos: "sw" });
    const id = result.current.activeSpec!.id;

    // Simulate the user wandering off and changing everything before
    // reopening — a bare "reset" the way a real session would leave things,
    // including a DIFFERENT annotation/shape/legend so the restore below is
    // provably a REPLACE, not a merge.
    act(() => {
      useApp.setState({
        seriesStyles: {},
        hiddenChannels: [],
        y2Keys: null,
        y2Lim: null,
        xAxisLabel: "",
        yLim: null,
        plotTitle: "",
        y2Fmt: null,
        annotations: [],
        shapes: [],
        legendPos: "ne",
      });
      useApp.getState().addAnnotation(9, 9, "stale");
      useApp.getState().setLegendPos("nw");
    });
    act(() => result.current.reset());
    expect(result.current.activeSpec).toBeNull();
    expect(result.current.chips("y")).toHaveLength(0);

    // Reopen: the builder's wells restore (pre-#12 behavior), but the STORE
    // is still the "wandered off" state — blocks haven't applied yet.
    act(() => result.current.openSpec(id));
    expect(result.current.activeSpec?.id).toBe(id);
    expect(result.current.chips("y").map((c) => c.channel)).toEqual([1, 2]);
    expect(useApp.getState().seriesStyles).toEqual({}); // NOT yet applied — a plot action does that
    expect(useApp.getState().annotations).toMatchObject([{ text: "stale" }]); // still the wandered-off state

    // Apply: NOW the blocks land.
    act(() => result.current.applyToCurrent());
    const s = useApp.getState();
    expect(s.yKeys).toEqual([1, 2]);
    expect(s.seriesStyles[1]).toMatchObject({ color: "#ff0000", width: 2 });
    expect(s.seriesStyles[2]).toMatchObject({ color: "#00ff00" });
    expect(s.y2Keys).toEqual([2]);
    expect(s.xAxisLabel).toBe("Field (Oe)");
    expect(s.yLim).toEqual([0, 100]);
    expect(s.plotTitle).toBe("My Plot");
    expect(s.y2Fmt).toEqual({ mode: "fixed", digits: 1 });
    // The stale "wandered off" annotation is GONE (REPLACE, not append) and
    // the captured one is back; same for the shape and legend position.
    expect(s.annotations).toHaveLength(1);
    expect(s.annotations[0]).toMatchObject({ x: 1, y: 2, text: "peak" });
    expect(s.shapes).toHaveLength(1);
    expect(s.shapes[0]).toMatchObject({ kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(s.legendPos).toBe("sw");
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
      'opened "Styled" (includes saved styles — a plot action applies them)',
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
