// lib/plotview — the PlotView model + snapshot/hydrate facade helpers
// (MULTI_PLOT_PLAN item 2). The round-trip identity test is the risk
// mitigation the plan calls out explicitly ("facade double-truth").

import { describe, expect, it } from "vitest";

import {
  cascadeGeometry,
  cycleWindow,
  defaultPlotView,
  hydrateView,
  sanitizePlotWindows,
  snapshotView,
  type PlotView,
  type PlotWindow,
} from "./plotview";

describe("defaultPlotView", () => {
  it("matches the store's own initial singleton-field values", () => {
    const v = defaultPlotView();
    expect(v.xKey).toBeNull();
    expect(v.yKeys).toBeNull();
    expect(v.seriesStyles).toEqual({});
    expect(v.hiddenChannels).toEqual([]);
    expect(v.legendPos).toBe("ne");
    expect(v.plotTemplate).toBe("screen");
    expect(v.waterfall).toBe(0);
  });
});

describe("snapshotView / hydrateView round-trip", () => {
  it("hydrate(snapshot(view)) is identical to the original view", () => {
    const view: PlotView = {
      ...defaultPlotView(),
      xKey: 2,
      yKeys: [0, 1],
      plotTitle: "M vs H",
      seriesStyles: { 0: { color: "#fff" } },
      refLines: [{ id: "r1", axis: "y", value: 1.5 }] as PlotView["refLines"],
    };
    expect(hydrateView(snapshotView(view))).toEqual(view);
  });

  it("snapshot picks ONLY the PlotView fields off a larger superset object", () => {
    const superset = { ...defaultPlotView(), plotTool: "zoom", qfitRoi: [1, 2], activeId: "d1" };
    const snap = snapshotView(superset as unknown as PlotView);
    expect(snap).toEqual(defaultPlotView());
    expect(Object.keys(snap)).not.toContain("plotTool");
    expect(Object.keys(snap)).not.toContain("activeId");
  });

  it("hydrateView returns a fresh copy, not the same reference", () => {
    const view = defaultPlotView();
    const hydrated = hydrateView(view);
    expect(hydrated).toEqual(view);
    expect(hydrated).not.toBe(view);
  });
});

describe("cascadeGeometry", () => {
  it("offsets successive windows so they don't stack exactly on top of one another", () => {
    const g0 = cascadeGeometry(0);
    const g1 = cascadeGeometry(1);
    expect(g1.x).toBeGreaterThan(g0.x);
    expect(g1.y).toBeGreaterThan(g0.y);
    expect(g0.w).toBe(g1.w);
    expect(g0.h).toBe(g1.h);
  });

  it("never returns a negative offset for a negative index", () => {
    const g = cascadeGeometry(-5);
    expect(g.x).toBeGreaterThanOrEqual(0);
    expect(g.y).toBeGreaterThanOrEqual(0);
  });
});

describe("cycleWindow (item 5 — Focus Next/Previous)", () => {
  const ids = ["a", "b", "c"];

  it("cycles forward and wraps past the end", () => {
    expect(cycleWindow(ids, "a", 1)).toBe("b");
    expect(cycleWindow(ids, "c", 1)).toBe("a");
  });

  it("cycles backward and wraps past the start", () => {
    expect(cycleWindow(ids, "b", -1)).toBe("a");
    expect(cycleWindow(ids, "a", -1)).toBe("c");
  });

  it("returns null with fewer than 2 windows, a null current id, or an unknown current id", () => {
    expect(cycleWindow(["a"], "a", 1)).toBeNull();
    expect(cycleWindow([], null, 1)).toBeNull();
    expect(cycleWindow(ids, null, 1)).toBeNull();
    expect(cycleWindow(ids, "ghost", 1)).toBeNull();
  });
});

function win(over: Partial<PlotWindow> = {}): PlotWindow {
  return {
    id: "win-1",
    kind: "plot",
    title: "",
    datasetId: "d1",
    geometry: { x: 10, y: 10, w: 480, h: 360 },
    z: 0,
    winState: "normal",
    view: defaultPlotView(),
    ...over,
  };
}

describe("sanitizePlotWindows", () => {
  it("round-trips a valid window and clamps a dead dataset ref to null", () => {
    const out = sanitizePlotWindows(
      [win(), win({ id: "win-2", datasetId: "gone" })],
      new Set(["d1"]),
    );
    expect(out).toHaveLength(2);
    expect(out[0].datasetId).toBe("d1");
    expect(out[1].datasetId).toBeNull();
  });

  it("drops malformed entries without throwing", () => {
    const out = sanitizePlotWindows(
      [win(), { id: "bad" }, null, "nope", { kind: "worksheet", id: "w3" }],
      new Set(["d1"]),
    );
    expect(out).toHaveLength(1);
  });

  it("clamps non-finite/negative geometry to sane defaults", () => {
    const out = sanitizePlotWindows(
      [win({ geometry: { x: NaN, y: -5, w: -10, h: 0 } as PlotWindow["geometry"] })],
      new Set(["d1"]),
    );
    expect(out[0].geometry.x).toBe(0);
    expect(out[0].geometry.y).toBe(-5); // y has no positivity requirement, only finiteness
    expect(out[0].geometry.w).toBeGreaterThan(0);
    expect(out[0].geometry.h).toBeGreaterThan(0);
  });

  it("falls back to a default view for a malformed `view` field", () => {
    const out = sanitizePlotWindows([win({ view: { bogus: true } as unknown as PlotView })], new Set(["d1"]));
    expect(out[0].view).toEqual(defaultPlotView());
  });

  it("falls back to winState 'normal' for an invalid value and returns [] for non-array input", () => {
    expect(sanitizePlotWindows([win({ winState: "floating" as PlotWindow["winState"] })], new Set(["d1"]))[0].winState).toBe(
      "normal",
    );
    expect(sanitizePlotWindows(null, new Set())).toEqual([]);
    expect(sanitizePlotWindows(undefined, new Set())).toEqual([]);
  });
});
