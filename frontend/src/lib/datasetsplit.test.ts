import { describe, expect, it } from "vitest";

import {
  autoTolerance,
  clusterByGaps,
  columnUnit,
  columnValues,
  formatGroupLabel,
  groupByExactValue,
  isCategoricalColumn,
  pickDefaultSplitColumn,
  sliceDataStruct,
  SPLIT_GROUP_CAP,
  splitColumn,
  tooManyGroups,
  type SplitGroup,
} from "./datasetsplit";
import type { DataStruct } from "./types";

/** Sum of every group's row count — a split must always account for every
 *  source row exactly once (no silent drops, no double-counting). */
function totalRows(groups: readonly SplitGroup[]): number {
  return groups.reduce((n, g) => n + g.rowIndexes.length, 0);
}

// NOTE: `medianNonZeroGap`/`AUTO_TOLERANCE_MULTIPLIER` (and their tests, that
// used to live here) were REMOVED with the bug-hunt fix below — the
// median-of-all-gaps × 8 heuristic they implemented is exactly the SEVERE
// bug: with few rows per setpoint, the within-setpoint wobble gaps and the
// between-setpoint jump gaps are comparable in COUNT, so the median landed
// between the two populations and ×8 was enough to swallow a real boundary
// (see the "bug-hunt regression" describe block below for the two confirmed
// repros). `autoTolerance` now uses elbow detection on the sorted gaps
// instead — see its doc comment in datasetsplit.ts for the full algorithm.
describe("autoTolerance — elbow detection (bug-hunt fix)", () => {
  it("is 0 for fewer than 3 distinct finite values — no gaps to compute a ratio from", () => {
    expect(autoTolerance([5, 5, 5])).toBe(0); // 1 distinct value, 0 gaps
    expect(autoTolerance([5, 5, 10, 10])).toBe(0); // 2 distinct values, 1 gap, no ratio possible
  });

  it("ignores non-finite values when collecting the distinct value set", () => {
    const clean = [4.998, 5.0, 5.003, 9.997, 10.0, 10.003];
    const withJunk = [...clean, NaN, Infinity, -Infinity];
    expect(autoTolerance(withJunk)).toBe(autoTolerance(clean));
  });

  it("finds the elbow and returns the geometric mean of the two straddling gaps", () => {
    // Distinct values 1,2,3,4 (small/uniform gaps of 1) then a jump to 100
    // (gap 96) -- a clean, decisive elbow with a >=2-member wobble side.
    const values = [1, 2, 3, 4, 100];
    const tol = autoTolerance(values);
    expect(tol).toBeCloseTo(Math.sqrt(1 * 96), 6);
    // And using it actually separates the two populations.
    const { groups } = clusterByGaps(values, tol);
    expect(groups.map((g) => g.rowIndexes)).toEqual([[0, 1, 2, 3], [4]]);
  });

  it("has no evidence of a wobble population when the elbow's small side has only 1 gap — doesn't merge", () => {
    // Only 4 distinct values (3 gaps: 1, 3, 5) -- the best ratio (3/1 = 3)
    // has just ONE gap on its small side, not enough to trust as "wobble"
    // rather than a smaller (but still real) jump.
    expect(autoTolerance([1, 2, 5, 10])).toBe(0);
  });

  it("collapses a uniform gap sequence (ratio never decisive) to a single-cluster tolerance", () => {
    // All gaps equal -> every ratio is 1, well under the elbow threshold ->
    // tolerance = the max gap itself, so nothing splits (see the
    // "monotonic ramp" describe block below for the end-to-end check).
    const values = [0, 1, 2, 3, 4, 5, 6, 7];
    expect(autoTolerance(values)).toBe(1);
  });
});

describe("clusterByGaps — bug-hunt regression: few rows per setpoint (SEVERE, data corruption)", () => {
  // Confirmed repro #1: 2 setpoints (5 K, 10 K, each read twice with tiny
  // wobble) plus a clear outlier at 500 -- the OLD median×8 heuristic merged
  // all of this into ONE "7.5005 K" group (5 K and 10 K's wobble-scale gaps
  // and their own between-them jump ended up comparable in count at n=5).
  it("[5, 5.001, 10, 10.002, 500] splits into 3 groups, not merged into one blob", () => {
    const values = [5, 5.001, 10, 10.002, 500];
    const { groups, tolerance } = clusterByGaps(values, autoTolerance(values));
    expect(tolerance).toBeGreaterThan(0);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.rowIndexes)).toEqual([[0, 1], [2, 3], [4]]);
    expect(groups.map((g) => g.label)).toEqual(["5.0005", "10.001", "500"]);
    expect(totalRows(groups)).toBe(values.length);
  });

  // Confirmed repro #2: 3 EXACT setpoints (5, 10, 300) with no wobble at all
  // (every repeat is an identical read) -- the OLD heuristic's single
  // nonzero-gap median (5) × 8 = 40 exceeded the real 5->10 jump (5), so it
  // merged two genuinely distinct setpoints and reported "nothing to split".
  it("[5,5,5,10,10,300] splits into 3 groups (previously merged to 1: 'nothing to split')", () => {
    const values = [5, 5, 5, 10, 10, 300];
    const { groups } = clusterByGaps(values, autoTolerance(values));
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.rowIndexes)).toEqual([[0, 1, 2], [3, 4], [5]]);
    expect(groups.map((g) => g.label)).toEqual(["5", "10", "300"]);
    expect(totalRows(groups)).toBe(values.length);
  });
});

describe("clusterByGaps — PPMS/MPMS setpoint wobble (the headline scenario)", () => {
  // Four setpoints (5/10/50/100 K) each read back with small controller
  // wobble around the true value; between-setpoint jumps are >1000x the
  // within-setpoint wobble.
  const wobble = [
    4.998, 5.0, 5.003, // ~5 K
    9.997, 10.0, 10.002, // ~10 K
    49.996, 50.0, 50.004, // ~50 K
    99.995, 100.0, 100.004, // ~100 K
  ];

  it("auto tolerance clusters the wobble together and separates each setpoint", () => {
    const tol = autoTolerance(wobble);
    const { groups, tolerance } = clusterByGaps(wobble, tol, "K");
    expect(tolerance).toBe(tol);
    expect(groups).toHaveLength(4);
    // Each cluster's label is its MEDIAN, rounded via the house formatter —
    // the symmetric wobble was chosen so the median lands exactly on the
    // true setpoint (5 K, not 5.0013 K or similar noise).
    expect(groups.map((g) => g.label)).toEqual(["5 K", "10 K", "50 K", "100 K"]);
    expect(groups.map((g) => g.value)).toEqual([5, 10, 50, 100]);
    expect(totalRows(groups)).toBe(wobble.length);
    // Rows land in the RIGHT group and stay in ascending original-index order.
    expect(groups[0].rowIndexes).toEqual([0, 1, 2]);
    expect(groups[1].rowIndexes).toEqual([3, 4, 5]);
    expect(groups[2].rowIndexes).toEqual([6, 7, 8]);
    expect(groups[3].rowIndexes).toEqual([9, 10, 11]);
  });

  it("is order-independent (descending input yields the same groups)", () => {
    const asc = clusterByGaps(wobble, autoTolerance(wobble), "K");
    const desc = [...wobble].reverse();
    const descResult = clusterByGaps(desc, autoTolerance(desc), "K");
    expect(descResult.groups.map((g) => g.label)).toEqual(asc.groups.map((g) => g.label));
    expect(descResult.groups.map((g) => g.value)).toEqual(asc.groups.map((g) => g.value));
    // Row indexes point at the REVERSED array's positions, but every value
    // still lands in its correct cluster.
    for (const g of descResult.groups) {
      for (const i of g.rowIndexes) {
        expect(Math.abs(desc[i] - g.value)).toBeLessThan(0.01);
      }
    }
    expect(totalRows(descResult.groups)).toBe(wobble.length);
  });
});

describe("clusterByGaps — single group", () => {
  it("groups everything together when there's no gap that exceeds tolerance", () => {
    const values = [24.998, 25.0, 25.001, 24.999, 25.002];
    const { groups } = clusterByGaps(values, autoTolerance(values));
    expect(groups).toHaveLength(1);
    expect(groups[0].rowIndexes).toEqual([0, 1, 2, 3, 4]);
    expect(groups[0].value).toBeCloseTo(25.0, 6);
  });
});

describe("clusterByGaps — monotonic ramp (every value unique)", () => {
  // 60 evenly-spaced points (step 1) — a continuous sweep like an M-H
  // field axis, not a setpoint column.
  const ramp = Array.from({ length: 60 }, (_, i) => i);

  it("auto tolerance collapses a uniform ramp to ONE group, not N", () => {
    // For a perfectly uniform gap sequence, the median gap equals every
    // individual gap, so ANY multiplier > 1 makes the tolerance exceed
    // every adjacent gap -> the whole ramp merges. This is the desired
    // behaviour: a smooth sweep is not a multi-setpoint file.
    const tol = autoTolerance(ramp);
    const { groups } = clusterByGaps(ramp, tol);
    expect(groups).toHaveLength(1);
    expect(totalRows(groups)).toBe(ramp.length);
  });

  it("a too-tight explicit tolerance DOES explode into one group per row — and tooManyGroups catches it", () => {
    // This is the scenario the dialog's cap-warning exists for: a mis-picked
    // column (or a hand-typed tolerance smaller than the natural spacing)
    // must not silently render 60 one-row "groups" — the pure model still
    // computes them (it doesn't second-guess an explicit tolerance), but
    // exposes tooManyGroups so the dialog can warn instead of listing.
    const { groups } = clusterByGaps(ramp, 0.5);
    expect(groups).toHaveLength(ramp.length);
    expect(groups.length).toBeGreaterThan(SPLIT_GROUP_CAP);
    expect(tooManyGroups(groups)).toBe(true);
  });

  it("tooManyGroups is false right at and under the cap", () => {
    const small = clusterByGaps(ramp.slice(0, SPLIT_GROUP_CAP), 0.5);
    expect(small.groups).toHaveLength(SPLIT_GROUP_CAP);
    expect(tooManyGroups(small.groups)).toBe(false);
  });
});

describe("clusterByGaps — NaN rows", () => {
  it("collects non-finite rows into a trailing (other) group instead of dropping them", () => {
    const values = [5, 5, 5, NaN, 5, NaN];
    const { groups } = clusterByGaps(values, autoTolerance(values), "K");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ label: "5 K", value: 5, rowIndexes: [0, 1, 2, 4] });
    expect(groups[1]).toMatchObject({ label: "(other)", rowIndexes: [3, 5] });
    expect(Number.isNaN(groups[1].value)).toBe(true);
    expect(totalRows(groups)).toBe(values.length);
  });

  it("omits the (other) group entirely when there are no non-finite rows", () => {
    const { groups } = clusterByGaps([5, 5, 5], 1);
    expect(groups.some((g) => g.label === "(other)")).toBe(false);
  });

  it("also isolates Infinity/-Infinity, not just NaN", () => {
    const { groups } = clusterByGaps([1, 1, Infinity, -Infinity], 1);
    const other = groups.find((g) => g.label === "(other)");
    expect(other?.rowIndexes).toEqual([2, 3]);
  });
});

describe("groupByExactValue — text/label-role columns", () => {
  it("groups by exact value in first-appearance order, no tolerance", () => {
    const values = [1, 1, 2, 2, 2, 3, 1];
    const { groups, tolerance } = groupByExactValue(values, "run");
    expect(tolerance).toBeNull();
    expect(groups.map((g) => g.value)).toEqual([1, 2, 3]);
    expect(groups.map((g) => g.rowIndexes)).toEqual([[0, 1, 6], [2, 3, 4], [5]]);
    expect(groups[0].label).toBe("1 run");
  });

  it("routes NaN rows to a trailing (other) group here too", () => {
    const { groups } = groupByExactValue([1, NaN, 1, 2]);
    expect(groups.at(-1)).toMatchObject({ label: "(other)", rowIndexes: [1] });
  });
});

describe("formatGroupLabel", () => {
  it("appends the unit when present, omits it when blank", () => {
    expect(formatGroupLabel(5, "K")).toBe("5 K");
    expect(formatGroupLabel(0.1, "T")).toBe("0.1 T");
    expect(formatGroupLabel(5, "")).toBe("5");
  });
});

describe("column addressing (-1 = x convention, matches ColumnFilter.col)", () => {
  const data: DataStruct = {
    time: [1, 2, 3],
    values: [
      [10, 100],
      [20, 100],
      [30, 200],
    ],
    labels: ["A", "B"],
    units: ["Oe", "K"],
    metadata: {},
  };

  it("columnValues/columnUnit read the x column at -1", () => {
    expect(columnValues(data, -1)).toEqual([1, 2, 3]);
    expect(columnUnit(data, -1)).toBe("");
  });

  it("columnValues/columnUnit read a value channel at >=0", () => {
    expect(columnValues(data, 0)).toEqual([10, 20, 30]);
    expect(columnUnit(data, 1)).toBe("K");
  });

  it("the x column is never treated as categorical", () => {
    expect(isCategoricalColumn(data, -1)).toBe(false);
  });
});

describe("splitColumn dispatch", () => {
  // 14 rows so lib/modeling.ts's inferModelingType (MIN_SAMPLES=12) actually
  // evaluates the nominal branch for the run-id column.
  function makeData(): DataStruct {
    const n = 14;
    // Wobbled, all-distinct reads (>8 distinct values keeps
    // lib/modeling.ts's inferModelingType on the "continuous" branch —
    // an exact-repeat 2-level column would read as nominal instead, which
    // is a DIFFERENT test below).
    const temps = [4.997, 4.998, 4.999, 5.0, 5.001, 5.002, 5.003, 9.997, 9.998, 9.999, 10.0, 10.001, 10.002, 10.003];
    const runId = [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2]; // few discrete levels
    return {
      time: Array.from({ length: n }, (_, i) => i),
      values: temps.map((t, i) => [t, runId[i]]),
      labels: ["T", "run"],
      units: ["K", ""],
      metadata: {},
    };
  }

  it("gap-clusters a continuous channel", () => {
    const data = makeData();
    const { groups, tolerance } = splitColumn(data, 0);
    expect(tolerance).not.toBeNull();
    expect(groups.map((g) => g.label)).toEqual(["5 K", "10 K"]);
  });

  it("exact-groups a categorical channel and reports tolerance null", () => {
    const data = makeData();
    const { groups, tolerance } = splitColumn(data, 1);
    expect(tolerance).toBeNull();
    expect(groups.map((g) => g.value)).toEqual([1, 2]);
  });

  // Bug-hunt regression (preview/commit parity): `tolerance ?? autoTolerance(...)`
  // alone only catches null/undefined, not NaN or a negative number — a bad
  // caller (e.g. an unvalidated numeric-field string) used to reach
  // `clusterByGaps` with garbage that either collapsed everything to one
  // group (NaN: every `>` comparison is false) or exploded into one group
  // per row (negative: even a same-value repeat's gap of 0 exceeds it).
  // `splitColumn` now guards both, falling back to `autoTolerance` exactly
  // as if the caller had passed nothing at all.
  it("falls back to autoTolerance for a NaN tolerance (never collapses to one group)", () => {
    const data = makeData();
    const nanResult = splitColumn(data, 0, NaN);
    const autoResult = splitColumn(data, 0);
    expect(nanResult.groups.map((g) => g.rowIndexes)).toEqual(autoResult.groups.map((g) => g.rowIndexes));
    expect(nanResult.groups.length).toBeGreaterThan(1);
  });

  it("falls back to autoTolerance for a negative tolerance (never explodes to one-row groups)", () => {
    const data = makeData();
    const negResult = splitColumn(data, 0, -5);
    const autoResult = splitColumn(data, 0);
    expect(negResult.groups.map((g) => g.rowIndexes)).toEqual(autoResult.groups.map((g) => g.rowIndexes));
    expect(negResult.groups.every((g) => g.rowIndexes.length > 1 || g.label === "(other)")).toBe(true);
  });

  it("falls back to autoTolerance for -Infinity too (not just finite negatives)", () => {
    const data = makeData();
    const negInfResult = splitColumn(data, 0, -Infinity);
    const autoResult = splitColumn(data, 0);
    expect(negInfResult.groups.map((g) => g.rowIndexes)).toEqual(autoResult.groups.map((g) => g.rowIndexes));
  });
});

describe("pickDefaultSplitColumn", () => {
  it("prefers the column with fewer groups (more setpoint-like)", () => {
    const n = 12;
    const data: DataStruct = {
      time: Array.from({ length: n }, (_, i) => i),
      values: Array.from({ length: n }, (_, i) => [
        i < 6 ? 5 : 10, // channel 0: 2 setpoints
        [1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3][i], // channel 1: 3 discrete levels
      ]),
      labels: ["T", "run"],
      units: ["K", ""],
      metadata: {},
    };
    // channel 0 -> 2 groups, channel 1 -> 3 groups: channel 0 wins (fewer).
    expect(pickDefaultSplitColumn(data)).toBe(0);
  });

  it("falls back to the first channel when nothing splits (every column constant)", () => {
    const n = 12;
    const data: DataStruct = {
      time: Array.from({ length: n }, (_, i) => i),
      values: Array.from({ length: n }, () => [1, 1]),
      labels: ["A", "B"],
      units: ["", ""],
      metadata: {},
    };
    expect(pickDefaultSplitColumn(data)).toBe(0);
  });

  it("returns -1 for a dataset with no channels", () => {
    const data: DataStruct = { time: [1, 2], values: [[], []], labels: [], units: [], metadata: {} };
    expect(pickDefaultSplitColumn(data)).toBe(-1);
  });
});

describe("sliceDataStruct", () => {
  const source: DataStruct = {
    time: [1, 2, 3, 4],
    values: [
      [10, 100],
      [20, 200],
      [30, 300],
      [40, 400],
    ],
    labels: ["A", "B"],
    units: ["Oe", "K"],
    metadata: { note: "src" },
  };

  it("slices time+values to the given row indexes, preserving order given", () => {
    const sliced = sliceDataStruct(source, [1, 3]);
    expect(sliced.time).toEqual([2, 4]);
    expect(sliced.values).toEqual([
      [20, 200],
      [40, 400],
    ]);
    expect(sliced.labels).toEqual(["A", "B"]);
    expect(sliced.units).toEqual(["Oe", "K"]);
    expect(sliced.metadata).toEqual({ note: "src" });
  });

  it("never aliases the source's mutable arrays", () => {
    const sliced = sliceDataStruct(source, [0, 1]);
    sliced.values[0][0] = 999;
    sliced.labels.push("C");
    expect(source.values[0][0]).toBe(10);
    expect(source.labels).toEqual(["A", "B"]);
  });
});
