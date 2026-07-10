// lib/plotview — the PlotView model + snapshot/hydrate facade helpers
// (MULTI_PLOT_PLAN item 2). The round-trip identity test is the risk
// mitigation the plan calls out explicitly ("facade double-truth").

import { describe, expect, it } from "vitest";

import {
  cascadeGeometry,
  cascadeLayout,
  cycleWindow,
  dedupeWindowTitle,
  defaultPlotView,
  displayedWindowTitle,
  hydrateView,
  nextPlotBg,
  sanitizePlotWindows,
  snapshotView,
  tileLayout,
  zOrderIds,
  type PlotBg,
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
    bg: "theme",
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

  it("round-trips a valid bg override and falls back to 'theme' for a missing/invalid value (item 18)", () => {
    const out = sanitizePlotWindows(
      [
        win({ id: "a", bg: "light" }),
        win({ id: "b", bg: "dark" }),
        win({ id: "c", bg: "sepia" as PlotBg }),
        { ...win({ id: "d" }), bg: undefined },
      ],
      new Set(["d1"]),
    );
    expect(out[0].bg).toBe("light");
    expect(out[1].bg).toBe("dark");
    expect(out[2].bg).toBe("theme");
    expect(out[3].bg).toBe("theme");
  });
});

describe("nextPlotBg (item 18 — per-window background toggle)", () => {
  it("cycles theme -> light -> dark -> theme", () => {
    expect(nextPlotBg("theme")).toBe("light");
    expect(nextPlotBg("light")).toBe("dark");
    expect(nextPlotBg("dark")).toBe("theme");
  });
});

describe("tileLayout (item 6 — Tile Windows)", () => {
  it("returns one cell per window, all fitting inside bounds with no overlap in a 2x1 case", () => {
    const geoms = tileLayout(2, { width: 800, height: 400 });
    expect(geoms).toHaveLength(2);
    const [a, b] = geoms;
    expect(a.x).toBeLessThan(b.x); // side by side
    expect(a.y).toBe(b.y);
    expect(a.x + a.w).toBeLessThanOrEqual(800);
    expect(b.x + b.w).toBeLessThanOrEqual(800);
  });

  it("arranges 4 windows in a 2x2 grid", () => {
    const geoms = tileLayout(4, { width: 800, height: 600 });
    expect(geoms).toHaveLength(4);
    // Rows: 0,1 share y; 2,3 share a lower y. Cols: 0,2 share x; 1,3 share x.
    expect(geoms[0].y).toBe(geoms[1].y);
    expect(geoms[2].y).toBe(geoms[3].y);
    expect(geoms[2].y).toBeGreaterThan(geoms[0].y);
    expect(geoms[0].x).toBe(geoms[2].x);
  });

  it("floors cell size at a sane minimum instead of collapsing to zero", () => {
    const geoms = tileLayout(9, { width: 100, height: 100 });
    for (const g of geoms) {
      expect(g.w).toBeGreaterThanOrEqual(200);
      expect(g.h).toBeGreaterThanOrEqual(140);
    }
  });

  it("returns [] for a non-positive count", () => {
    expect(tileLayout(0, { width: 800, height: 600 })).toEqual([]);
    expect(tileLayout(-1, { width: 800, height: 600 })).toEqual([]);
  });
});

describe("cascadeLayout (item 6 — Cascade Windows)", () => {
  it("matches cascadeGeometry applied to each index in turn", () => {
    const geoms = cascadeLayout(3);
    expect(geoms).toEqual([cascadeGeometry(0), cascadeGeometry(1), cascadeGeometry(2)]);
  });

  it("returns [] for zero windows", () => {
    expect(cascadeLayout(0)).toEqual([]);
  });
});

describe("zOrderIds (item 6 — z-order-aware focus cycling)", () => {
  it("sorts back-to-front by ascending z", () => {
    const wins = [win({ id: "a", z: 5 }), win({ id: "b", z: 1 }), win({ id: "c", z: 3 })];
    expect(zOrderIds(wins)).toEqual(["b", "c", "a"]);
  });

  it("is a stable sort — equal-z windows keep their creation (array) order", () => {
    const wins = [win({ id: "a", z: 0 }), win({ id: "b", z: 0 }), win({ id: "c", z: 0 })];
    expect(zOrderIds(wins)).toEqual(["a", "b", "c"]);
  });
});

describe("displayedWindowTitle / dedupeWindowTitle (item 10 — default titles)", () => {
  const datasets = [{ id: "d1", name: "MyData" }];

  it("prefers the window's own explicit title over its dataset's name", () => {
    expect(displayedWindowTitle(win({ title: "Custom", datasetId: "d1" }), datasets)).toBe("Custom");
  });

  it("falls back to the bound dataset's name, then to 'Untitled graph'", () => {
    expect(displayedWindowTitle(win({ title: "", datasetId: "d1" }), datasets)).toBe("MyData");
    expect(displayedWindowTitle(win({ title: "", datasetId: null }), datasets)).toBe("Untitled graph");
    expect(displayedWindowTitle(win({ title: "", datasetId: "gone" }), datasets)).toBe("Untitled graph");
  });

  it("dedupeWindowTitle leaves a unique name alone and suffixes a taken one", () => {
    expect(dedupeWindowTitle("MyData", ["Other"])).toBe("MyData");
    expect(dedupeWindowTitle("MyData", ["MyData"])).toBe("MyData (2)");
    expect(dedupeWindowTitle("MyData", ["MyData", "MyData (2)"])).toBe("MyData (3)");
  });
});
