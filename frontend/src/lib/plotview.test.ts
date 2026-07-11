// lib/plotview — the PlotView model + snapshot/hydrate facade helpers
// (MULTI_PLOT_PLAN item 2). The round-trip identity test is the risk
// mitigation the plan calls out explicitly ("facade double-truth").

import { describe, expect, it } from "vitest";

import type { FrozenPlotBundle } from "./plotsnapshot";
import {
  cascadeGeometry,
  cascadeLayout,
  cycleAxisScale,
  cycleWindow,
  dedupeWindowTitle,
  defaultPlotView,
  displayedWindowTitle,
  dropGeometry,
  hydrateView,
  isAxisScale,
  nearestLegendCorner,
  nextLinkGroup,
  nextPlotBg,
  sanitizePlotWindows,
  scaleFromLog,
  SNAP_THRESHOLD,
  snapMovePosition,
  snapResizeSize,
  snapshotView,
  tileLayout,
  zOrderIds,
  type PlotBg,
  type PlotView,
  type PlotWindow,
  type WindowGeometry,
} from "./plotview";

describe("defaultPlotView", () => {
  it("matches the store's own initial singleton-field values", () => {
    const v = defaultPlotView();
    expect(v.xKey).toBeNull();
    expect(v.yKeys).toBeNull();
    expect(v.seriesStyles).toEqual({});
    expect(v.hiddenChannels).toEqual([]);
    expect(v.legendPos).toBe("ne");
    expect(v.legendXY).toBeNull();
    expect(v.plotTemplate).toBe("screen");
    expect(v.waterfall).toBe(0);
    expect(v.xScale).toBe("linear");
    expect(v.yScale).toBe("linear");
    expect(v.y2Scale).toBeNull();
  });
});

describe("scaleFromLog / isAxisScale / cycleAxisScale (MAIN #12)", () => {
  it("scaleFromLog maps the old boolean flags 1:1", () => {
    expect(scaleFromLog(true)).toBe("log");
    expect(scaleFromLog(false)).toBe("linear");
  });

  it("isAxisScale accepts only the three valid tokens", () => {
    expect(isAxisScale("linear")).toBe(true);
    expect(isAxisScale("log")).toBe(true);
    expect(isAxisScale("reciprocal")).toBe(true);
    expect(isAxisScale("Log")).toBe(false);
    expect(isAxisScale(true)).toBe(false);
    expect(isAxisScale(null)).toBe(false);
    expect(isAxisScale(undefined)).toBe(false);
  });

  it("cycleAxisScale advances linear -> log -> reciprocal -> linear", () => {
    expect(cycleAxisScale("linear")).toBe("log");
    expect(cycleAxisScale("log")).toBe("reciprocal");
    expect(cycleAxisScale("reciprocal")).toBe("linear");
  });
});

/** A pre-#12 persisted view: has the OLD xLog/yLog/y2Log boolean fields and
 *  NONE of the new xScale/yScale/y2Scale ones (a REAL old `.dwk` — unlike
 *  spreading `defaultPlotView()`, which now carries the new fields and would
 *  make "new field present" true even for a legacy fixture). */
function legacyView(over: Record<string, unknown> = {}): unknown {
  const v = { ...defaultPlotView(), ...over } as Record<string, unknown>;
  delete v.xScale;
  delete v.yScale;
  delete v.y2Scale;
  return v;
}

describe("sanitizeView back-compat (MAIN #12 — old .dwk boolean -> new scale enum)", () => {
  it("a pre-#12 view (xLog/yLog/y2Log booleans, no scale fields) migrates to the enum", () => {
    const out = sanitizePlotWindows(
      [win({ view: legacyView({ xLog: true, yLog: false, y2Log: true }) as PlotView })],
      new Set(["d1"]),
    );
    expect(out[0].view.xScale).toBe("log");
    expect(out[0].view.yScale).toBe("linear");
    expect(out[0].view.y2Scale).toBe("log");
  });

  it("y2Log: null (legacy 'inherit yLog') migrates to y2Scale: null", () => {
    const out = sanitizePlotWindows(
      [win({ view: legacyView({ y2Log: null }) as PlotView })],
      new Set(["d1"]),
    );
    expect(out[0].view.y2Scale).toBeNull();
  });

  it("a post-#12 view (scale fields present) round-trips the enum directly, ignoring any stray legacy field", () => {
    const out = sanitizePlotWindows(
      [
        win({
          view: {
            ...defaultPlotView(),
            xScale: "reciprocal",
            yScale: "log",
            y2Scale: "reciprocal",
            // A stray legacy field (e.g. hand-edited file) must never override
            // a present, valid new field.
            xLog: false,
          } as unknown as PlotView,
        }),
      ],
      new Set(["d1"]),
    );
    expect(out[0].view.xScale).toBe("reciprocal");
    expect(out[0].view.yScale).toBe("log");
    expect(out[0].view.y2Scale).toBe("reciprocal");
  });

  it("an invalid scale string falls back to the default, same as any other malformed field", () => {
    const out = sanitizePlotWindows(
      [win({ view: { ...defaultPlotView(), xScale: "sqrt" } as unknown as PlotView })],
      new Set(["d1"]),
    );
    expect(out[0].view.xScale).toBe("linear");
  });
});

describe("sanitizeView — legendXY (MAIN #18 — free legend position)", () => {
  it("round-trips a valid [fx, fy] pair", () => {
    const out = sanitizePlotWindows(
      [win({ view: { ...defaultPlotView(), legendXY: [0.2, 0.8] } as PlotView })],
      new Set(["d1"]),
    );
    expect(out[0].view.legendXY).toEqual([0.2, 0.8]);
  });

  it("clamps out-of-range fractions to [0, 1]", () => {
    const out = sanitizePlotWindows(
      [win({ view: { ...defaultPlotView(), legendXY: [-0.5, 1.5] } as unknown as PlotView })],
      new Set(["d1"]),
    );
    expect(out[0].view.legendXY).toEqual([0, 1]);
  });

  it("falls back to null for a malformed value (not a 2-tuple of finite numbers)", () => {
    for (const bad of [null, "ne", [0.5], [0.5, "x"], [0.5, NaN]]) {
      const out = sanitizePlotWindows(
        [win({ view: { ...defaultPlotView(), legendXY: bad } as unknown as PlotView })],
        new Set(["d1"]),
      );
      expect(out[0].view.legendXY).toBeNull();
    }
  });
});

describe("nearestLegendCorner (MAIN #18 — double-click-to-reset)", () => {
  it("picks the corner matching each quadrant", () => {
    expect(nearestLegendCorner(0.9, 0.1)).toBe("ne");
    expect(nearestLegendCorner(0.1, 0.1)).toBe("nw");
    expect(nearestLegendCorner(0.9, 0.9)).toBe("se");
    expect(nearestLegendCorner(0.1, 0.9)).toBe("sw");
  });

  it("resolves dead-center to a deterministic corner", () => {
    expect(nearestLegendCorner(0.5, 0.5)).toBe("ne");
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
    linkGroup: null,
    pinned: false,
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
    // "worksheet" became a REAL kind with item 17, so the unknown-kind probe
    // here uses a genuinely-invalid value.
    const out = sanitizePlotWindows(
      [win(), { id: "bad" }, null, "nope", { kind: "notebook", id: "w3" }],
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

  it("round-trips a valid linkGroup and clamps a missing/malformed one to null (item 13)", () => {
    const out = sanitizePlotWindows(
      [
        win({ id: "a", linkGroup: 2 }),
        win({ id: "b", linkGroup: null }),
        { ...win({ id: "c" }), linkGroup: undefined },
        win({ id: "d", linkGroup: 1.5 as unknown as number }),
        win({ id: "e", linkGroup: 0 as unknown as number }),
        win({ id: "f", linkGroup: "1" as unknown as number }),
        win({ id: "g", linkGroup: 7 }), // beyond MAX_LINK_GROUP — a hand-edited .dwk
      ],
      new Set(["d1"]),
    );
    expect(out.map((w) => w.linkGroup)).toEqual([2, null, null, null, null, null, null]);
  });

  it("forces linkGroup to null on non-plot kinds — only plot windows can sync", () => {
    const out = sanitizePlotWindows(
      [
        win({ id: "wk", kind: "worksheet", linkGroup: 2 }),
        win({ id: "mp", kind: "map", linkGroup: 1 }),
      ],
      new Set(["d1"]),
    );
    expect(out.map((w) => w.linkGroup)).toEqual([null, null]);
  });

  it("round-trips the pin flag and falls back to false for a missing/invalid value (item 14)", () => {
    const out = sanitizePlotWindows(
      [
        win({ id: "a", pinned: true }),
        win({ id: "b", pinned: false }),
        win({ id: "c", pinned: "yes" as unknown as boolean }),
        { ...win({ id: "d" }), pinned: undefined },
      ],
      new Set(["d1"]),
    );
    expect(out.map((w) => w.pinned)).toEqual([true, false, false, false]);
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

describe("sanitizePlotWindows — snapshot windows (item 11)", () => {
  const bundle = (): FrozenPlotBundle => ({
    payload: {
      data: [
        [0, 1],
        [5, 6],
      ] as FrozenPlotBundle["payload"]["data"],
      series: [{ label: "m", unit: "emu" }],
      xLabel: "x",
      xUnit: "",
    },
    styleList: null,
    labelList: null,
    errorBars: [[1, [0.1, null]]],
    plotted: [0],
    colorByColumns: [],
    hidden: null,
  });

  it("round-trips a valid snapshot window — kind + frozen bundle survive; datasetId is forced null", () => {
    const out = sanitizePlotWindows(
      [win({ id: "s1", kind: "snapshot", snapshot: bundle(), datasetId: "d1" })],
      new Set(["d1"]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("snapshot");
    expect(out[0].datasetId).toBeNull(); // frozen means frozen — never dataset-bound
    expect(out[0].snapshot!.payload.data).toEqual([
      [0, 1],
      [5, 6],
    ]);
    expect(out[0].snapshot!.payload.series).toEqual([{ label: "m", unit: "emu" }]);
    expect(out[0].snapshot!.errorBars).toEqual([[1, [0.1, null]]]);
  });

  it("drops a snapshot window whose frozen bundle is missing or malformed — plot siblings survive", () => {
    const out = sanitizePlotWindows(
      [
        win({ id: "p1" }),
        win({ id: "s1", kind: "snapshot" }), // no bundle at all
        win({
          id: "s2",
          kind: "snapshot",
          snapshot: { payload: { data: "nope", series: [] } } as unknown as FrozenPlotBundle,
        }),
        win({
          id: "s3",
          kind: "snapshot",
          // column count breaks the data = [x, ...series] contract
          snapshot: {
            ...bundle(),
            payload: { ...bundle().payload, series: [] },
          } as FrozenPlotBundle,
        }),
      ],
      new Set(["d1"]),
    );
    expect(out.map((w) => w.id)).toEqual(["p1"]);
  });
});

describe("sanitizePlotWindows — worksheet/map document windows (item 17)", () => {
  it("round-trips the document kinds with a LIVE dataset binding — no snapshot bundle required", () => {
    const out = sanitizePlotWindows(
      [win({ id: "ws1", kind: "worksheet" }), win({ id: "m1", kind: "map" })],
      new Set(["d1"]),
    );
    expect(out.map((w) => w.kind)).toEqual(["worksheet", "map"]);
    // Unlike a snapshot, the binding survives (live documents, decision #4).
    expect(out.map((w) => w.datasetId)).toEqual(["d1", "d1"]);
  });

  it("clamps a document window's dead dataset ref to null without dropping the window", () => {
    const out = sanitizePlotWindows([win({ id: "ws1", kind: "worksheet", datasetId: "gone" })], new Set(["d1"]));
    expect(out).toHaveLength(1);
    expect(out[0].datasetId).toBeNull(); // the "dataset removed" empty state
  });

  it("defaults a document window's malformed view to defaultPlotView() (required but unused)", () => {
    const out = sanitizePlotWindows(
      [win({ id: "m1", kind: "map", view: { bogus: 1 } as unknown as PlotView })],
      new Set(["d1"]),
    );
    expect(out[0].view).toEqual(defaultPlotView());
  });
});

describe("nextPlotBg (item 18 — per-window background toggle)", () => {
  it("cycles theme -> light -> dark -> theme", () => {
    expect(nextPlotBg("theme")).toBe("light");
    expect(nextPlotBg("light")).toBe("dark");
    expect(nextPlotBg("dark")).toBe("theme");
  });
});

describe("nextLinkGroup (item 13 — cross-window link-group toggle)", () => {
  it("cycles null -> 1 -> 2 -> 3 -> null", () => {
    expect(nextLinkGroup(null)).toBe(1);
    expect(nextLinkGroup(1)).toBe(2);
    expect(nextLinkGroup(2)).toBe(3);
    expect(nextLinkGroup(3)).toBeNull();
  });

  it("clamps an out-of-range group straight back to null (defensive — sanitize should prevent it)", () => {
    expect(nextLinkGroup(99)).toBeNull();
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

describe("snapMovePosition / snapResizeSize (item 12 — edge/sibling snapping)", () => {
  const bounds = { width: 800, height: 600 };
  const rect = (x: number, y: number, w = 200, h = 150): WindowGeometry => ({ x, y, w, h });

  it("snaps a move to the canvas edges on all four sides", () => {
    expect(snapMovePosition(rect(5, 300), bounds, [])).toEqual({ x: 0, y: 300 }); // left
    expect(snapMovePosition(rect(300, 6), bounds, [])).toEqual({ x: 300, y: 0 }); // top
    expect(snapMovePosition(rect(595, 300), bounds, [])).toEqual({ x: 600, y: 300 }); // right: 795 → 800
    expect(snapMovePosition(rect(300, 444), bounds, [])).toEqual({ x: 300, y: 450 }); // bottom: 594 → 600
  });

  it("aligns to a sibling's same edge (left-to-left)", () => {
    const sib = rect(100, 100);
    expect(snapMovePosition({ x: 106, y: 300, w: 240, h: 150 }, undefined, [sib])).toEqual({
      x: 100,
      y: 300,
    });
  });

  it("abuts a sibling in both directions (our left to its right; our right to its left)", () => {
    const sib = rect(100, 100); // spans x 100..300
    // Our left edge 305 → the sibling's right edge 300.
    expect(snapMovePosition({ x: 305, y: 400, w: 240, h: 100 }, undefined, [sib])).toEqual({
      x: 300,
      y: 400,
    });
    // Our right edge 95 → the sibling's left edge 100.
    expect(snapMovePosition({ x: 55, y: 400, w: 40, h: 40 }, undefined, [sib])).toEqual({
      x: 60,
      y: 400,
    });
  });

  it("does not snap outside the threshold (and snaps at exactly the threshold)", () => {
    expect(SNAP_THRESHOLD).toBe(8);
    expect(snapMovePosition(rect(9, 300), bounds, [])).toEqual({ x: 9, y: 300 });
    expect(snapMovePosition(rect(8, 300), bounds, []).x).toBe(0);
  });

  it("the nearest candidate wins when several lines are in range", () => {
    const sib = rect(11, 100); // sibling left edge at 11
    // Proposed left edge 6: canvas left (0) is 6 away, the sibling's left
    // (11) is 5 away — the sibling wins.
    expect(snapMovePosition({ x: 6, y: 300, w: 240, h: 150 }, bounds, [sib]).x).toBe(11);
  });

  it("x and y snap independently of each other", () => {
    const sib = rect(100, 100);
    // x in reach of the sibling's left edge; y far from every line.
    expect(snapMovePosition({ x: 95, y: 350, w: 240, h: 100 }, bounds, [sib])).toEqual({
      x: 100,
      y: 350,
    });
    // y in reach of the sibling's top edge; x far from every line.
    expect(snapMovePosition({ x: 400, y: 94, w: 240, h: 100 }, bounds, [sib])).toEqual({
      x: 400,
      y: 100,
    });
  });

  it("snapResizeSize snaps only the moving right/bottom edges", () => {
    // Right edge 795 → canvas 800; bottom edge 596 → canvas 600.
    expect(snapResizeSize({ x: 300, y: 200, w: 495, h: 396 }, bounds, [])).toEqual({
      w: 500,
      h: 400,
    });
    // The ANCHORED left/top edges being near a line must NOT change the size.
    expect(snapResizeSize({ x: 5, y: 5, w: 400, h: 300 }, bounds, [])).toEqual({ w: 400, h: 300 });
  });

  it("snapResizeSize abuts sibling edges (right→its left, bottom→its top)", () => {
    const sib = rect(500, 300);
    expect(snapResizeSize({ x: 100, y: 100, w: 395, h: 195 }, undefined, [sib])).toEqual({
      w: 400,
      h: 200,
    });
  });

  it("with no bounds and no siblings the geometry is unchanged", () => {
    expect(snapMovePosition(rect(5, 5), undefined, [])).toEqual({ x: 5, y: 5 });
    expect(snapResizeSize(rect(5, 5), undefined, [])).toEqual({ w: 200, h: 150 });
  });
});

describe("dropGeometry (item 14 — drop onto empty canvas)", () => {
  const bounds = { width: 1200, height: 800 };

  it("places a default-sized window with its top-left at the drop point", () => {
    expect(dropGeometry(100, 60, bounds)).toEqual({ x: 100, y: 60, w: 480, h: 360 });
  });

  it("clamps a near-edge drop so the whole frame stays inside the bounds", () => {
    const g = dropGeometry(1190, 790, bounds);
    expect(g.x).toBe(1200 - 480);
    expect(g.y).toBe(800 - 360);
  });

  it("clamps a negative drop point to the origin", () => {
    const g = dropGeometry(-50, -50, bounds);
    expect(g.x).toBe(0);
    expect(g.y).toBe(0);
  });

  it("degrades to the origin when the canvas is smaller than the default window", () => {
    const g = dropGeometry(100, 100, { width: 300, height: 200 });
    expect(g.x).toBe(0);
    expect(g.y).toBe(0);
  });
});
