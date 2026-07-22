// GUI_INTERACTION_PLAN #12 Slice 5 — applySpecBlocks unit tests. Uses a
// small REALISTIC fake store (not bare vi.fn() stubs) so the setY2Keys
// clearing side effect (see useApp.ts's own setY2Keys) is actually
// reproduced — that's what makes the ordering test below meaningful, not
// just "was this function called".

import { describe, expect, it, vi } from "vitest";

import type { StoreGet } from "./exportActive";
import { applySpecBlocks } from "./plotspecApply";
import type { PlotSpec } from "./plotspec";
import type { LegendPos } from "./plotview";
import type { PageSetup } from "./pagesetup";
import type { PanelFit } from "./panelLayout";
import type { Annotation, AxisFormat, SeriesStyle, Shape } from "./types";

const ZONES = { x: null, y: [], group: null, facet: null };

function baseSpec(overrides: Partial<PlotSpec>): PlotSpec {
  return { version: 2, zones: ZONES, mark: "scatter", ...overrides };
}

/** A fake store that actually behaves like useApp's real actions for the
 *  fields applySpecBlocks touches — mirrors setY2Keys's real clearing
 *  side-effect (`y2Keys ? {} : { y2Lim: null, y2Scale: null, y2AxisLabel: "" }`)
 *  so the ordering guarantee (display before axes) is genuinely exercised.
 *  `state` and the actions are the SAME object (as they are in the real
 *  store) so a test mutating `state.hiddenChannels` directly is visible to
 *  `s()` — a separate "combined" snapshot object would go stale the moment a
 *  test set a field after construction. */
function makeFakeStore() {
  const state: {
    hiddenChannels: number[];
    seriesStyles: Record<number, SeriesStyle>;
    y2Keys: number[] | null;
    y2Lim: [number, number] | null;
    y2Scale: string | null;
    y2AxisLabel: string;
    xLim: [number, number] | null;
    yLim: [number, number] | null;
    xAxisLabel: string;
    yAxisLabel: string;
    plotTitle: string;
    xScale: string;
    yScale: string;
    xFmt: AxisFormat;
    yFmt: AxisFormat;
    y2Fmt: AxisFormat | null;
    seriesOrder: number[] | null;
    annotations: Annotation[];
    shapes: Shape[];
    legendPos: LegendPos;
    legendXY: [number, number] | null;
    stackMode: boolean;
    panelFit: PanelFit;
    pageSetup: PageSetup | null;
    // Read by applyDisplayBlock to re-key saved styles by column label.
    datasets: { id: string; data: { labels: string[] } }[];
    activeId: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [action: string]: any;
  } = {
    hiddenChannels: [],
    seriesStyles: {},
    y2Keys: null,
    y2Lim: null,
    y2Scale: null,
    y2AxisLabel: "",
    xLim: null,
    yLim: null,
    xAxisLabel: "",
    yAxisLabel: "",
    plotTitle: "",
    xScale: "linear",
    yScale: "linear",
    xFmt: { mode: "auto", digits: 2 },
    yFmt: { mode: "auto", digits: 2 },
    y2Fmt: null,
    seriesOrder: null,
    annotations: [],
    shapes: [],
    legendPos: "ne",
    legendXY: null,
    stackMode: false,
    panelFit: "frames",
    pageSetup: null,
    datasets: [],
    activeId: null,
  };
  let _annSeq = 0;
  let _shapeSeq = 0;
  const fns = {
    resetSeriesStyle: vi.fn((ch: number) => {
      delete state.seriesStyles[ch];
    }),
    setSeriesStyle: vi.fn((ch: number, patch: Partial<SeriesStyle>) => {
      state.seriesStyles[ch] = { ...state.seriesStyles[ch], ...patch };
    }),
    toggleHidden: vi.fn((ch: number) => {
      state.hiddenChannels = state.hiddenChannels.includes(ch)
        ? state.hiddenChannels.filter((c) => c !== ch)
        : [...state.hiddenChannels, ch];
    }),
    setY2Keys: vi.fn((y2Keys: number[] | null) => {
      state.y2Keys = y2Keys;
      if (!y2Keys) {
        state.y2Lim = null;
        state.y2Scale = null;
        state.y2AxisLabel = "";
      }
    }),
    setSeriesOrder: vi.fn((order: number[] | null) => {
      state.seriesOrder = order;
    }),
    setPlotTitle: vi.fn((t: string) => {
      state.plotTitle = t;
    }),
    setXAxisLabel: vi.fn((l: string) => {
      state.xAxisLabel = l;
    }),
    setYAxisLabel: vi.fn((l: string) => {
      state.yAxisLabel = l;
    }),
    setY2AxisLabel: vi.fn((l: string) => {
      state.y2AxisLabel = l;
    }),
    setXLim: vi.fn((lim: [number, number] | null) => {
      state.xLim = lim;
    }),
    setYLim: vi.fn((lim: [number, number] | null) => {
      state.yLim = lim;
    }),
    setY2Lim: vi.fn((lim: [number, number] | null) => {
      state.y2Lim = lim;
    }),
    setXScale: vi.fn((sc: string) => {
      state.xScale = sc;
    }),
    setYScale: vi.fn((sc: string) => {
      state.yScale = sc;
    }),
    setY2Scale: vi.fn((sc: string | null) => {
      state.y2Scale = sc;
    }),
    setXFmt: vi.fn((f: AxisFormat) => {
      state.xFmt = f;
    }),
    setYFmt: vi.fn((f: AxisFormat) => {
      state.yFmt = f;
    }),
    setY2Fmt: vi.fn((f: AxisFormat | null) => {
      state.y2Fmt = f;
    }),
    // Decor ("part C") — mirrors the REAL actions' shapes closely enough for
    // the REPLACE-semantics tests below to be meaningful, same rationale as
    // setY2Keys's clearing side effect above.
    addAnnotation: vi.fn((x: number, y: number, text: string) => {
      const id = `ann-${++_annSeq}`;
      state.annotations = [...state.annotations, { id, x, y, text }];
      return id;
    }),
    removeAnnotation: vi.fn((id: string) => {
      state.annotations = state.annotations.filter((a: Annotation) => a.id !== id);
    }),
    updateAnnotation: vi.fn((id: string, patch: Partial<Annotation>) => {
      state.annotations = state.annotations.map((a: Annotation) => (a.id === id ? { ...a, ...patch } : a));
    }),
    addShape: vi.fn((shape: Omit<Shape, "id">) => {
      const id = `shape-${++_shapeSeq}`;
      state.shapes = [...state.shapes, { ...shape, id }];
      return id;
    }),
    clearShapes: vi.fn(() => {
      state.shapes = [];
    }),
    setLegendPos: vi.fn((pos: LegendPos) => {
      state.legendPos = pos;
    }),
    setLegendXY: vi.fn((xy: [number, number] | null) => {
      state.legendXY = xy;
    }),
    // #54 pass C. setStackMode mirrors the real action's composition-clearing
    // side effect (store/useApp.ts) so the page block's interaction with a
    // later facetByColumn stays honestly modelled.
    setStackMode: vi.fn((stackMode: boolean) => {
      state.stackMode = stackMode;
      state.composition = null;
    }),
    setPanelFit: vi.fn((panelFit: PanelFit) => {
      state.panelFit = panelFit;
    }),
    setPageSetup: vi.fn((pageSetup: PageSetup | null) => {
      state.pageSetup = pageSetup;
    }),
  };
  Object.assign(state, fns);
  const s = (() => state) as unknown as StoreGet;
  return { s, state, fns };
}

describe("applySpecBlocks — absent blocks", () => {
  it("makes zero store calls for a v1 spec (no display, no axes, no decor)", () => {
    const { s, fns } = makeFakeStore();
    applySpecBlocks(baseSpec({}), s);
    for (const fn of Object.values(fns)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("applySpecBlocks — display block", () => {
  it("maps a series entry's style fields through resetSeriesStyle + setSeriesStyle", () => {
    const { s, state, fns } = makeFakeStore();
    applySpecBlocks(
      baseSpec({ display: { series: { 1: { color: "#ff0000", width: 2, marker: true, markerShape: "square", line: "dashed" } } } }),
      s,
    );
    expect(fns.resetSeriesStyle).toHaveBeenCalledWith(1);
    expect(fns.setSeriesStyle).toHaveBeenCalledWith(1, {
      color: "#ff0000",
      width: 2,
      marker: true,
      markerShape: "square",
      line: "dashed",
    });
    expect(state.seriesStyles[1]).toEqual({
      color: "#ff0000",
      width: 2,
      marker: true,
      markerShape: "square",
      line: "dashed",
    });
  });

  it("resets but does not call setSeriesStyle when a channel has no style fields (hidden-only entry)", () => {
    const { fns, s } = makeFakeStore();
    applySpecBlocks(baseSpec({ display: { series: { 2: { hidden: true } } } }), s);
    expect(fns.resetSeriesStyle).toHaveBeenCalledWith(2);
    expect(fns.setSeriesStyle).not.toHaveBeenCalled();
  });

  it("toggles hidden ON only when the target disagrees with the current state", () => {
    const { s, fns, state } = makeFakeStore();
    state.hiddenChannels = [5]; // already hidden — entry says hidden:true too
    applySpecBlocks(
      baseSpec({ display: { series: { 5: { hidden: true }, 6: { hidden: true } } } }),
      s,
    );
    expect(fns.toggleHidden).toHaveBeenCalledTimes(1);
    expect(fns.toggleHidden).toHaveBeenCalledWith(6); // 5 was already hidden — left alone
  });

  it("toggles hidden OFF when a captured entry has no hidden flag but the channel is currently hidden", () => {
    const { s, fns, state } = makeFakeStore();
    state.hiddenChannels = [3];
    applySpecBlocks(baseSpec({ display: { series: { 3: { color: "#abc" } } } }), s);
    expect(fns.toggleHidden).toHaveBeenCalledWith(3);
    expect(state.hiddenChannels).toEqual([]);
  });

  it("axis:1 members become setY2Keys' target array; a block with none clears to null", () => {
    const { s, fns } = makeFakeStore();
    applySpecBlocks(
      baseSpec({ display: { series: { 1: { color: "#fff" }, 2: { axis: 1 }, 3: { axis: 1 } } } }),
      s,
    );
    expect(fns.setY2Keys).toHaveBeenCalledWith([2, 3]);

    const { s: s2, fns: fns2 } = makeFakeStore();
    applySpecBlocks(baseSpec({ display: { series: { 1: { color: "#fff" } } } }), s2);
    expect(fns2.setY2Keys).toHaveBeenCalledWith(null);
  });

  it("order maps straight to setSeriesOrder; an absent/empty order resets to null", () => {
    const { s, fns } = makeFakeStore();
    applySpecBlocks(baseSpec({ display: { order: [2, 0, 1] } }), s);
    expect(fns.setSeriesOrder).toHaveBeenCalledWith([2, 0, 1]);

    const { s: s2, fns: fns2 } = makeFakeStore();
    applySpecBlocks(baseSpec({ display: { series: { 1: { color: "#fff" } } } }), s2);
    expect(fns2.setSeriesOrder).toHaveBeenCalledWith(null);
  });

  it("ignores a non-integer channel key (defensive against a hand-crafted/malformed spec)", () => {
    const { s, fns } = makeFakeStore();
    const spec = baseSpec({
      display: { series: { abc: { color: "#fff" } } as unknown as Record<number, { color: string }> },
    });
    applySpecBlocks(spec, s);
    expect(fns.resetSeriesStyle).not.toHaveBeenCalled();
    expect(fns.setSeriesStyle).not.toHaveBeenCalled();
  });
});

describe("applySpecBlocks — display block re-keys by column label", () => {
  // Helper: point the fake store at an active dataset with the given labels.
  function withDataset(labels: string[]) {
    const store = makeFakeStore();
    store.state.datasets = [{ id: "d1", data: { labels } }];
    store.state.activeId = "d1";
    return store;
  }

  it("re-applies a saved style to the label's NEW index after a column shift", () => {
    // Saved against labels [A, B, C]: channel 1 = "B", red. A new column "T" was
    // inserted at the front, so "B" now lives at index 2. The red style must
    // follow "B" to index 2 — NOT hit whatever now sits at the stale index 1.
    const { s, fns, state } = withDataset(["T", "A", "B", "C"]);
    applySpecBlocks(
      baseSpec({ display: { series: { 1: { color: "#ff0000" } }, labels: { 1: "B" } } }),
      s,
    );
    expect(fns.setSeriesStyle).toHaveBeenCalledWith(2, { color: "#ff0000" });
    expect(fns.setSeriesStyle).not.toHaveBeenCalledWith(1, expect.anything());
    expect(state.seriesStyles[2]).toEqual({ color: "#ff0000" });
    expect(state.seriesStyles[1]).toBeUndefined();
  });

  it("drops a saved style whose column label no longer exists", () => {
    // "B" was deleted; the saved style for it must NOT land on a random column.
    const { s, fns } = withDataset(["A", "C"]);
    applySpecBlocks(
      baseSpec({ display: { series: { 1: { color: "#ff0000" } }, labels: { 1: "B" } } }),
      s,
    );
    expect(fns.resetSeriesStyle).not.toHaveBeenCalled();
    expect(fns.setSeriesStyle).not.toHaveBeenCalled();
  });

  it("keeps the index when the label is unchanged at that position (identity, duplicate-safe)", () => {
    const { s, fns } = withDataset(["A", "B", "C"]);
    applySpecBlocks(
      baseSpec({ display: { series: { 1: { color: "#00ff00" } }, labels: { 1: "B" } } }),
      s,
    );
    expect(fns.setSeriesStyle).toHaveBeenCalledWith(1, { color: "#00ff00" });
  });

  it("falls back to by-index when the spec carries no labels (legacy spec)", () => {
    const { s, fns } = withDataset(["T", "A", "B", "C"]);
    applySpecBlocks(baseSpec({ display: { series: { 1: { color: "#0000ff" } } } }), s);
    expect(fns.setSeriesStyle).toHaveBeenCalledWith(1, { color: "#0000ff" }); // unchanged behavior
  });

  it("remaps the display order through the same resolver and drops gone columns", () => {
    // Saved order [2,1,0] against labels [A,B,C]; a front insert shifts each by
    // one (A→1, B→2, C→3), and index 0's label isn't captured so it stays 0.
    const { s, fns } = withDataset(["T", "A", "B", "C"]);
    applySpecBlocks(
      baseSpec({ display: { order: [2, 1, 0], labels: { 2: "C", 1: "B", 0: "A" } } }),
      s,
    );
    expect(fns.setSeriesOrder).toHaveBeenCalledWith([3, 2, 1]);
  });

  it("re-keys y2 membership by label too", () => {
    const { s, fns } = withDataset(["T", "A", "B"]);
    applySpecBlocks(
      baseSpec({ display: { series: { 1: { axis: 1 } }, labels: { 1: "B" } } }),
      s,
    );
    expect(fns.setY2Keys).toHaveBeenCalledWith([2]); // "B" moved 1 → 2
  });
});

describe("applySpecBlocks — axes block", () => {
  it("maps title + per-axis label/lim/scale/fmt to their setters", () => {
    const { s, fns } = makeFakeStore();
    const fmt: AxisFormat = { mode: "fixed", digits: 3 };
    applySpecBlocks(
      baseSpec({
        axes: {
          title: "My Plot",
          x: { label: "Field (Oe)", lim: [0, 10], scale: "log", fmt },
          y: { label: "Moment (emu)", lim: [-1, 1], scale: "linear", fmt },
        },
      }),
      s,
    );
    expect(fns.setPlotTitle).toHaveBeenCalledWith("My Plot");
    expect(fns.setXAxisLabel).toHaveBeenCalledWith("Field (Oe)");
    expect(fns.setXLim).toHaveBeenCalledWith([0, 10]);
    expect(fns.setXScale).toHaveBeenCalledWith("log");
    expect(fns.setXFmt).toHaveBeenCalledWith(fmt);
    expect(fns.setYAxisLabel).toHaveBeenCalledWith("Moment (emu)");
    expect(fns.setYLim).toHaveBeenCalledWith([-1, 1]);
    expect(fns.setYScale).toHaveBeenCalledWith("linear");
    expect(fns.setYFmt).toHaveBeenCalledWith(fmt);
  });

  it("never calls setXStep-shaped actions — no such setters exist (documented gap)", () => {
    // `step` on any axis has no setter — this test just pins that applying a
    // full axes block never THROWS despite that gap.
    const { s } = makeFakeStore();
    expect(() =>
      applySpecBlocks(
        baseSpec({ axes: { x: { step: 5 }, y: { step: 2 }, y2: { lim: [0, 1] } } }),
        s,
      ),
    ).not.toThrow();
  });

  it("maps axes.y2.fmt to setY2Fmt", () => {
    const { s, fns, state } = makeFakeStore();
    const fmt: AxisFormat = { mode: "sci", digits: 1 };
    applySpecBlocks(baseSpec({ axes: { y2: { lim: [0, 5], fmt } } }), s);
    expect(fns.setY2Fmt).toHaveBeenCalledWith(fmt);
    expect(state.y2Fmt).toEqual(fmt);
  });

  it("applies axes.y2 AFTER display's setY2Keys, so real y2 values always win over the clearing side effect", () => {
    const { s, state } = makeFakeStore();
    // No axis:1 members in the display block → applyDisplayBlock calls
    // setY2Keys(null), which (per the REAL store) clears y2Lim/y2Scale/
    // y2AxisLabel. The axes.y2 block below must still win.
    applySpecBlocks(
      baseSpec({
        display: { series: {} },
        axes: { y2: { lim: [0, 5], scale: "log", label: "Y2 (A)" } },
      }),
      s,
    );
    expect(state.y2Lim).toEqual([0, 5]);
    expect(state.y2Scale).toBe("log");
    expect(state.y2AxisLabel).toBe("Y2 (A)");
  });
});

describe("applySpecBlocks — decor block ('part C')", () => {
  it("REPLACEs live annotations: clears every existing one, then re-adds the captured set", () => {
    const { s, fns, state } = makeFakeStore();
    state.annotations = [{ id: "stale-1", x: 9, y: 9, text: "stale" }];
    applySpecBlocks(
      baseSpec({ decor: { annotations: [{ id: "a1", x: 1, y: 2, text: "peak" }] } }),
      s,
    );
    expect(fns.removeAnnotation).toHaveBeenCalledWith("stale-1");
    expect(fns.addAnnotation).toHaveBeenCalledWith(1, 2, "peak");
    expect(state.annotations).toHaveLength(1);
    expect(state.annotations[0]).toMatchObject({ x: 1, y: 2, text: "peak" });
  });

  it("applies an annotation's size/anchor/frame via updateAnnotation, but never touches axis (no setter)", () => {
    const { s, fns } = makeFakeStore();
    applySpecBlocks(
      baseSpec({
        decor: {
          annotations: [
            { id: "a1", x: 1, y: 2, text: "peak", size: 14, anchor: "page", frame: { fill: "#fff" }, axis: 1 },
          ],
        },
      }),
      s,
    );
    expect(fns.updateAnnotation).toHaveBeenCalledWith(expect.any(String), {
      size: 14,
      anchor: "page",
      frame: { fill: "#fff" },
    });
  });

  it("skips updateAnnotation when a captured entry has no size/anchor/frame", () => {
    const { s, fns } = makeFakeStore();
    applySpecBlocks(baseSpec({ decor: { annotations: [{ id: "a1", x: 1, y: 2, text: "peak" }] } }), s);
    expect(fns.updateAnnotation).not.toHaveBeenCalled();
  });

  it("REPLACEs live shapes via clearShapes + addShape, carrying every field but the original id", () => {
    const { s, fns, state } = makeFakeStore();
    state.shapes = [{ id: "stale-1", kind: "rect", x1: 9, y1: 9, x2: 9, y2: 9 }];
    applySpecBlocks(
      baseSpec({
        decor: {
          shapes: [
            { id: "captured-1", kind: "arrow", x1: 0, y1: 0, x2: 1, y2: 1, stroke: "#f00", width: 2 },
          ],
        },
      }),
      s,
    );
    expect(fns.clearShapes).toHaveBeenCalledTimes(1);
    expect(fns.addShape).toHaveBeenCalledWith({
      kind: "arrow",
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
      stroke: "#f00",
      width: 2,
    });
    expect(state.shapes).toHaveLength(1);
    expect(state.shapes[0]).toMatchObject({ kind: "arrow", x1: 0, y1: 0, x2: 1, y2: 1, stroke: "#f00", width: 2 });
    expect(state.shapes[0].id).not.toBe("captured-1"); // a fresh id, not the captured one
  });

  it("maps legend.pos/xy to their real setters; legend.title has no setter (documented gap)", () => {
    const { s, fns, state } = makeFakeStore();
    applySpecBlocks(baseSpec({ decor: { legend: { pos: "sw", xy: [0.2, 0.8], title: "Nb/Au" } } }), s);
    expect(fns.setLegendPos).toHaveBeenCalledWith("sw");
    expect(fns.setLegendXY).toHaveBeenCalledWith([0.2, 0.8]);
    expect(state.legendPos).toBe("sw");
    expect(state.legendXY).toEqual([0.2, 0.8]);
    // No setLegendTitle action exists at all — nothing in `fns` should have
    // been called with "Nb/Au" as a bare title-setting call.
    expect(fns.setLegendPos).not.toHaveBeenCalledWith("Nb/Au");
  });

  it("touches only the fields present on decor.legend (pos-only never calls setLegendXY)", () => {
    const { s, fns } = makeFakeStore();
    applySpecBlocks(baseSpec({ decor: { legend: { pos: "sw" } } }), s);
    expect(fns.setLegendPos).toHaveBeenCalledWith("sw");
    expect(fns.setLegendXY).not.toHaveBeenCalled();
  });

  it("makes zero decor-related calls when decor is absent, even with display/axes present", () => {
    const { s, fns } = makeFakeStore();
    applySpecBlocks(baseSpec({ axes: { title: "T" } }), s);
    expect(fns.removeAnnotation).not.toHaveBeenCalled();
    expect(fns.addAnnotation).not.toHaveBeenCalled();
    expect(fns.clearShapes).not.toHaveBeenCalled();
    expect(fns.addShape).not.toHaveBeenCalled();
    expect(fns.setLegendPos).not.toHaveBeenCalled();
    expect(fns.setLegendXY).not.toHaveBeenCalled();
  });
});

describe("applySpecBlocks — page block (#54 pass C)", () => {
  const PAGE: PageSetup = {
    width: 8.5,
    height: 11,
    unit: "in",
    margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 },
    aspectDerived: false,
  };

  it("pushes stack/fit/setup through the existing store actions", () => {
    const { s, fns, state } = makeFakeStore();
    applySpecBlocks(baseSpec({ page: { stack: true, fit: "page", setup: PAGE } }), s);
    expect(fns.setStackMode).toHaveBeenCalledWith(true);
    expect(fns.setPanelFit).toHaveBeenCalledWith("page");
    expect(fns.setPageSetup).toHaveBeenCalledWith(PAGE);
    expect(state.stackMode).toBe(true);
    expect(state.panelFit).toBe("page");
    expect(state.pageSetup).toEqual(PAGE);
  });

  it("touches only the fields present on the block", () => {
    const { s, fns } = makeFakeStore();
    applySpecBlocks(baseSpec({ page: { fit: "window" } }), s);
    expect(fns.setPanelFit).toHaveBeenCalledWith("window");
    expect(fns.setStackMode).not.toHaveBeenCalled();
    expect(fns.setPageSetup).not.toHaveBeenCalled();
  });

  it("applies an explicit stack:false (a captured un-stacked page is not a no-op)", () => {
    const { s, fns, state } = makeFakeStore();
    state.stackMode = true;
    applySpecBlocks(baseSpec({ page: { stack: false } }), s);
    expect(fns.setStackMode).toHaveBeenCalledWith(false);
    expect(state.stackMode).toBe(false);
  });

  it("makes zero page-related calls when page is absent, even with other blocks present", () => {
    const { s, fns } = makeFakeStore();
    applySpecBlocks(baseSpec({ axes: { title: "T" }, decor: { legend: { pos: "sw" } } }), s);
    expect(fns.setStackMode).not.toHaveBeenCalled();
    expect(fns.setPanelFit).not.toHaveBeenCalled();
    expect(fns.setPageSetup).not.toHaveBeenCalled();
  });
});
