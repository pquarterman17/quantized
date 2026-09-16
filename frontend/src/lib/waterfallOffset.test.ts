import { afterEach, describe, expect, it } from "vitest";

import { applyWaterfall, buildColumns } from "./plotdata";
import {
  publishLiveWaterfallSpan,
  readLiveWaterfallSpan,
  waterfallApplies,
  waterfallSpan,
  waterfallStep,
  waterfallWire,
} from "./waterfallOffset";
import type { CycleView } from "./seriesStyleCycle";
import type { DataStruct } from "./types";

// THE CROSS-LANGUAGE PIN (BUG-013). The literals below are the SHARED golden
// between this canvas-side implementation and the backend that has to reproduce
// the staggered figure: `tests/test_calc_plotting.py`'s
// `test_apply_waterfall_offsets_matches_the_canvas_golden` feeds the SAME
// dataset and the SAME offsets to `calc.plotting.apply_waterfall_offsets` and
// asserts the SAME shifted values to 1e-12. Change one side and the other goes
// red — which is the whole point: screen and export must not drift apart again.
const GOLDEN: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [1, 10, 100],
    [2, 20, 200],
    [3, 30, 300],
    [4, 40, 400],
  ],
  labels: ["a", "b", "c"],
  units: ["", "", ""],
  metadata: {},
};
const GOLDEN_FRACTION = 0.25;
/** y-range over ALL THREE value columns is 400 - 1 = 399; 0.25 of it = 99.75. */
const GOLDEN_STEP = 99.75;
const GOLDEN_OFFSETS = [0, 99.75, 199.5];
const GOLDEN_SHIFTED = [
  [1, 2, 3, 4],
  [109.75, 119.75, 129.75, 139.75],
  [299.5, 399.5, 499.5, 599.5],
];

/** The plain single-panel XY overlay — the one view the field is keyed to. */
const XY: CycleView = {
  groupKey: null,
  facetKey: null,
  stackMode: false,
  polarMode: false,
  statMode: false,
  xKey: null,
  yKeys: [0, 1, 2],
};

function wire(over: Partial<Parameters<typeof waterfallWire>[0]> = {}) {
  return waterfallWire({
    data: GOLDEN,
    displayChannels: [0, 1, 2],
    positions: [0, 1, 2],
    fraction: GOLDEN_FRACTION,
    view: XY,
    ...over,
  });
}

afterEach(() => publishLiveWaterfallSpan(null));

describe("waterfallStep", () => {
  it("is `fraction` of the combined y-range of every value column", () => {
    const cols = [
      [1, 2, 3, 4],
      [10, 20, 30, 40],
      [100, 200, 300, 400],
    ];
    expect(waterfallStep(cols, GOLDEN_FRACTION)).toBeCloseTo(GOLDEN_STEP, 12);
    expect(waterfallSpan(cols)).toBeCloseTo(399, 12);
  });

  it("ignores nulls and non-finite values", () => {
    expect(waterfallStep([[null, 1, NaN, 5, Infinity]], 0.5)).toBeCloseTo(2, 12);
  });

  it("falls back to a span of 1 when the range is degenerate", () => {
    expect(waterfallStep([[7, 7, 7]], 0.25)).toBeCloseTo(0.25, 12);
    expect(waterfallStep([[null, null]], 0.25)).toBeCloseTo(0.25, 12);
  });
});

// NIT 5 of the BUG-013 review: the canvas used `fraction <= 0` and the wire
// `!(fraction > 0)`, so the two sides disagreed on a NaN fraction — the canvas
// went on to NaN every value column while the wire omitted the field. One
// predicate now answers for both.
describe("waterfallApplies is the guard BOTH sides ask", () => {
  it("refuses zero, negative and NaN fractions", () => {
    expect(waterfallApplies(0)).toBe(false);
    expect(waterfallApplies(-0.25)).toBe(false);
    expect(waterfallApplies(NaN)).toBe(false);
    expect(waterfallApplies(0.25)).toBe(true);
  });

  it("so a NaN fraction leaves the canvas payload untouched AND the wire empty", () => {
    const before = buildColumns(GOLDEN, null, null, [0, 1, 2]);
    expect(applyWaterfall(before, NaN)).toBe(before);
    expect(wire({ fraction: NaN })).toEqual({});
  });
});

describe("the canvas and the export wire resolve the SAME offsets", () => {
  it("applyWaterfall shifts the golden columns by the golden offsets", () => {
    const shifted = applyWaterfall(buildColumns(GOLDEN, null, null, [0, 1, 2]), GOLDEN_FRACTION);
    // data[0] is x; data[1..3] are the value columns, in display order.
    expect([...shifted.data].slice(1)).toEqual(GOLDEN_SHIFTED);
  });

  it("waterfallWire emits exactly those offsets for the same display list", () => {
    expect(wire()).toEqual({ waterfall_offsets: GOLDEN_OFFSETS });
  });

  it("and they agree column by column — offset i really is series i's shift", () => {
    const before = buildColumns(GOLDEN, null, null, [0, 1, 2]);
    const after = applyWaterfall(before, GOLDEN_FRACTION);
    const w = wire();
    for (let s = 0; s < 3; s++) {
      const b = before.data[s + 1] as (number | null)[];
      const a = after.data[s + 1] as (number | null)[];
      expect((a[0] as number) - (b[0] as number)).toBeCloseTo(
        (w.waterfall_offsets ?? [])[s],
        12,
      );
    }
  });
});

describe("waterfallWire refusals", () => {
  it("emits nothing without a waterfall, or with a single display channel", () => {
    expect(wire({ fraction: 0 })).toEqual({});
    expect(wire({ displayChannels: [0], positions: [0] })).toEqual({});
  });

  it("emits nothing for a grouped or faceted request", () => {
    expect(wire({ view: { ...XY, groupKey: 0 } })).toEqual({});
    expect(wire({ view: { ...XY, facetKey: 0 } })).toEqual({});
  });

  // BUG-013 review finding 1: these three replace the XY canvas outright
  // (`PlotStage` early-returns to PolarStage / StatStage / MultiPanelStage
  // before the overlay is built), and NONE of them staggers anything — so an
  // emitted offset would stagger an export the screen never staggered.
  it("emits nothing for a stacked, polar or statistics view", () => {
    expect(wire({ view: { ...XY, stackMode: true } })).toEqual({});
    expect(wire({ view: { ...XY, polarMode: true } })).toEqual({});
    expect(wire({ view: { ...XY, statMode: true } })).toEqual({});
  });

  it("keys the offsets by DISPLAY position, so a hidden series keeps its slot", () => {
    // Display list [0, 1, 2] with channel 0 hidden -> plotted [1, 2] at
    // positions [1, 2]: the surviving series are staggered as if the hidden
    // one were still drawn, exactly as the canvas payload does.
    expect(wire({ positions: [1, 2] })).toEqual({
      waterfall_offsets: [GOLDEN_STEP, 2 * GOLDEN_STEP],
    });
  });
});

// BUG-013 review finding 2. The canvas measures its span over the rows the
// FETCH returned, which a committed zoom on a server-decimated dataset narrows
// to the visible x-window; the DataStruct the wire builder holds still has every
// row. When a live canvas published its span, that number wins.
describe("waterfallWire honours the live canvas' span", () => {
  it("uses the published span instead of re-measuring the DataStruct", () => {
    // The full-DataStruct span is 399; a windowed canvas that only saw the
    // flat tail would have measured 4.
    expect(wire({ span: 4 })).toEqual({ waterfall_offsets: [0, 1, 2] });
  });

  it("falls back to the DataStruct for a render with no live canvas behind it", () => {
    expect(wire({ span: null })).toEqual({ waterfall_offsets: GOLDEN_OFFSETS });
    expect(wire({ span: NaN })).toEqual({ waterfall_offsets: GOLDEN_OFFSETS });
  });

  it("the seam hands back a span only for the dataset it was measured from", () => {
    publishLiveWaterfallSpan({ datasetId: "d1", span: 4 });
    expect(readLiveWaterfallSpan("d1")).toBe(4);
    expect(readLiveWaterfallSpan("d2")).toBeNull();
    publishLiveWaterfallSpan(null);
    expect(readLiveWaterfallSpan("d1")).toBeNull();
  });
});
