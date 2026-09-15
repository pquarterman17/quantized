import { describe, expect, it } from "vitest";

import { applyWaterfall, buildColumns } from "./plotdata";
import { waterfallStep, waterfallWire } from "./waterfallOffset";
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

describe("waterfallStep", () => {
  it("is `fraction` of the combined y-range of every value column", () => {
    const cols = [
      [1, 2, 3, 4],
      [10, 20, 30, 40],
      [100, 200, 300, 400],
    ];
    expect(waterfallStep(cols, GOLDEN_FRACTION)).toBeCloseTo(GOLDEN_STEP, 12);
  });

  it("ignores nulls and non-finite values", () => {
    expect(waterfallStep([[null, 1, NaN, 5, Infinity]], 0.5)).toBeCloseTo(2, 12);
  });

  it("falls back to a span of 1 when the range is degenerate", () => {
    expect(waterfallStep([[7, 7, 7]], 0.25)).toBeCloseTo(0.25, 12);
    expect(waterfallStep([[null, null]], 0.25)).toBeCloseTo(0.25, 12);
  });
});

describe("the canvas and the export wire resolve the SAME offsets", () => {
  it("applyWaterfall shifts the golden columns by the golden offsets", () => {
    const shifted = applyWaterfall(buildColumns(GOLDEN, null, null, [0, 1, 2]), GOLDEN_FRACTION);
    // data[0] is x; data[1..3] are the value columns, in display order.
    expect([...shifted.data].slice(1)).toEqual(GOLDEN_SHIFTED);
  });

  it("waterfallWire emits exactly those offsets for the same display list", () => {
    expect(waterfallWire(GOLDEN, [0, 1, 2], [0, 1, 2], GOLDEN_FRACTION, null, undefined)).toEqual({
      waterfall_offsets: GOLDEN_OFFSETS,
    });
  });

  it("and they agree column by column — offset i really is series i's shift", () => {
    const before = buildColumns(GOLDEN, null, null, [0, 1, 2]);
    const after = applyWaterfall(before, GOLDEN_FRACTION);
    const wire = waterfallWire(GOLDEN, [0, 1, 2], [0, 1, 2], GOLDEN_FRACTION, null, undefined);
    for (let s = 0; s < 3; s++) {
      const b = before.data[s + 1] as (number | null)[];
      const a = after.data[s + 1] as (number | null)[];
      expect((a[0] as number) - (b[0] as number)).toBeCloseTo(
        (wire.waterfall_offsets ?? [])[s],
        12,
      );
    }
  });
});

describe("waterfallWire refusals", () => {
  it("emits nothing without a waterfall, or with a single display channel", () => {
    expect(waterfallWire(GOLDEN, [0, 1, 2], [0, 1, 2], 0, null, undefined)).toEqual({});
    expect(waterfallWire(GOLDEN, [0], [0], GOLDEN_FRACTION, null, undefined)).toEqual({});
  });

  it("emits nothing for a grouped or faceted request", () => {
    expect(waterfallWire(GOLDEN, [0, 1, 2], [0, 1, 2], GOLDEN_FRACTION, 0, undefined)).toEqual({});
    expect(waterfallWire(GOLDEN, [0, 1, 2], [0, 1, 2], GOLDEN_FRACTION, null, [])).toEqual({});
  });

  it("keys the offsets by DISPLAY position, so a hidden series keeps its slot", () => {
    // Display list [0, 1, 2] with channel 0 hidden -> plotted [1, 2] at
    // positions [1, 2]: the surviving series are staggered as if the hidden
    // one were still drawn, exactly as the canvas payload does.
    expect(waterfallWire(GOLDEN, [0, 1, 2], [1, 2], GOLDEN_FRACTION, null, undefined)).toEqual({
      waterfall_offsets: [GOLDEN_STEP, 2 * GOLDEN_STEP],
    });
  });
});
