// GUI_INTERACTION_PLAN #12 Slice 5 — applySpecBlocks unit tests. Uses a
// small REALISTIC fake store (not bare vi.fn() stubs) so the setY2Keys
// clearing side effect (see useApp.ts's own setY2Keys) is actually
// reproduced — that's what makes the ordering test below meaningful, not
// just "was this function called".

import { describe, expect, it, vi } from "vitest";

import type { StoreGet } from "./exportActive";
import { applySpecBlocks } from "./plotspecApply";
import type { PlotSpec } from "./plotspec";
import type { AxisFormat, SeriesStyle } from "./types";

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
    seriesOrder: number[] | null;
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
    seriesOrder: null,
  };
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
  };
  Object.assign(state, fns);
  const s = (() => state) as unknown as StoreGet;
  return { s, state, fns };
}

describe("applySpecBlocks — absent blocks", () => {
  it("makes zero store calls for a v1 spec (no display, no axes)", () => {
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

  it("never calls setY2Fmt/setXStep-shaped actions — no such setters exist (documented gap)", () => {
    // axes.y2 has no `fmt` field at all in AxisSpecV2 today (module doc), and
    // `step` on any axis has no setter — this test just pins that applying a
    // full axes block never THROWS despite those gaps.
    const { s } = makeFakeStore();
    expect(() =>
      applySpecBlocks(
        baseSpec({ axes: { x: { step: 5 }, y: { step: 2 }, y2: { lim: [0, 1] } } }),
        s,
      ),
    ).not.toThrow();
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
