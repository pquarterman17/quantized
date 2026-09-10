// Covers BOTH halves of the C2 eager/lazy split: `datasetsplit.ts` and
// `datasetsplitDefault.ts` (lazy default-column pick).
import { describe, expect, it } from "vitest";

import {
  autoTolerance,
  clusterByGaps,
  columnUnit,
  columnValues,
  formatGroupLabel,
  groupByExactValue,
  isCategoricalColumn,
  sliceDataStruct,
  SPLIT_GROUP_CAP,
  splitColumn,
  tooManyGroups,
  type SplitGroup,
} from "./datasetsplit";
import { pickDefaultSplitColumn } from "./datasetsplitDefault";
import { byColumnOptions } from "./byPartition";
import { categoryLevels, resolveCategoryLabels } from "./barlayout";
import type { DataStruct, Dataset } from "./types";

/** Wrap a bare fixture DataStruct as the minimal `Dataset` the split API now
 *  takes (BUG-008): the grouping decision reads `channelTypes` and
 *  `cat_levels`, so it needs the dataset, not just its columns. Tests that
 *  exercise an override or a level table build their own Dataset instead. */
function asDataset(data: DataStruct): Dataset {
  return { id: "fixture", name: "fixture", data };
}

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
    expect(isCategoricalColumn(asDataset(data), -1)).toBe(false);
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
    const { groups, tolerance } = splitColumn(asDataset(data), 0);
    expect(tolerance).not.toBeNull();
    expect(groups.map((g) => g.label)).toEqual(["5 K", "10 K"]);
  });

  it("exact-groups a categorical channel and reports tolerance null", () => {
    const data = makeData();
    const { groups, tolerance } = splitColumn(asDataset(data), 1);
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
    const nanResult = splitColumn(asDataset(data), 0, NaN);
    const autoResult = splitColumn(asDataset(data), 0);
    expect(nanResult.groups.map((g) => g.rowIndexes)).toEqual(autoResult.groups.map((g) => g.rowIndexes));
    expect(nanResult.groups.length).toBeGreaterThan(1);
  });

  it("falls back to autoTolerance for a negative tolerance (never explodes to one-row groups)", () => {
    const data = makeData();
    const negResult = splitColumn(asDataset(data), 0, -5);
    const autoResult = splitColumn(asDataset(data), 0);
    expect(negResult.groups.map((g) => g.rowIndexes)).toEqual(autoResult.groups.map((g) => g.rowIndexes));
    expect(negResult.groups.every((g) => g.rowIndexes.length > 1 || g.label === "(other)")).toBe(true);
  });

  it("falls back to autoTolerance for -Infinity too (not just finite negatives)", () => {
    const data = makeData();
    const negInfResult = splitColumn(asDataset(data), 0, -Infinity);
    const autoResult = splitColumn(asDataset(data), 0);
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
    expect(pickDefaultSplitColumn(asDataset(data))).toBe(0);
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
    expect(pickDefaultSplitColumn(asDataset(data))).toBe(0);
  });

  it("returns -1 for a dataset with no channels", () => {
    const data: DataStruct = { time: [1, 2], values: [[], []], labels: [], units: [], metadata: {} };
    expect(pickDefaultSplitColumn(asDataset(data))).toBe(-1);
  });
});

// BUG-008 (plans/BUGS_AND_ISSUES.md): Split reached past `channelModelingType`
// — the sanctioned modeling-type accessor, which honours a `channelTypes`
// override and then a `cat_levels` table BEFORE the numeric-shape heuristic —
// straight to the raw heuristic. Two consequences, both measured on the
// fixture below before the fix:
//   1. the heuristic needs >= 12 finite rows (lib/modeling.ts's MIN_SAMPLES),
//      so a 6-row / 3-sample categorical column read as CONTINUOUS and got
//      gap-clustered into a single group labelled "1" — three samples merged
//      into one dataset, the codes' median standing in for a sample name.
//   2. even at >= 12 rows, where the heuristic happens to agree, the group
//      labels were the raw float CODES ("0"/"1"/"2"), so the child datasets
//      were named "run.dat (0)" instead of "run.dat (A123)".
// The negative control below is the load-bearing half: a small-integer column
// with NO level table must keep its NUMERIC labels.
describe("BUG-008 — an explicit cat_levels table decides the split", () => {
  /** 3 samples x 2 rows = 6 rows: FEWER than lib/modeling.ts's MIN_SAMPLES,
   *  so the shape heuristic alone calls this continuous. The level table is
   *  the only thing that can make it categorical. */
  function categoricalDataset(): Dataset {
    return {
      id: "d1",
      name: "run.dat",
      data: {
        time: [1, 2, 3, 4, 5, 6],
        values: [[0], [1], [2], [0], [1], [2]],
        labels: ["sample"],
        units: [""],
        metadata: {},
        cat_levels: { 0: ["A123", "B456", "C789"] },
      },
    };
  }

  it("splits a 6-row / 3-level categorical column into 3 groups, not 1", () => {
    const ds = categoricalDataset();
    const { groups, tolerance } = splitColumn(ds, 0);
    // Pre-fix measurement: [{ label: "1", rows: 6 }] — one group, all rows.
    expect(groups.map((g) => g.rowIndexes.length)).toEqual([2, 2, 2]);
    expect(tolerance).toBeNull(); // exact-value grouping, no tolerance
    expect(totalRows(groups)).toBe(6);
  });

  it("labels the groups with LEVEL NAMES, in first-appearance order", () => {
    const { groups } = splitColumn(categoricalDataset(), 0);
    expect(groups.map((g) => g.label)).toEqual(["A123", "B456", "C789"]);
    // The raw code stays available as `value` — only the LABEL is resolved.
    expect(groups.map((g) => g.value)).toEqual([0, 1, 2]);
  });

  it("isCategoricalColumn agrees (it is what the dialog hides its tolerance field on)", () => {
    expect(isCategoricalColumn(categoricalDataset(), 0)).toBe(true);
  });

  // THE NEGATIVE CONTROL. A run-index column is small integers with no level
  // table: the heuristic correctly routes it to exact-value grouping, and its
  // labels must stay numeric. An over-broad fix (e.g. resolving labels
  // through whatever level table any OTHER channel carries, or inventing
  // names from codes) fails here.
  it("keeps NUMERIC labels for a small-int column with no level table", () => {
    const n = 12;
    const ds: Dataset = {
      id: "d1",
      name: "run.dat",
      data: {
        time: Array.from({ length: n }, (_, i) => i),
        values: Array.from({ length: n }, (_, i) => [[1, 2, 3][i % 3]]),
        labels: ["run"],
        units: [""],
        metadata: {},
      },
    };
    const { groups } = splitColumn(ds, 0);
    expect(groups.map((g) => g.label)).toEqual(["1", "2", "3"]);
  });

  // A level table on channel 0 must not leak into channel 1's labels — the
  // resolution is per-CHANNEL, like every other `lib/categorical.ts` read.
  it("resolves levels per channel, never from a sibling channel's table", () => {
    const ds: Dataset = {
      id: "d1",
      name: "run.dat",
      data: {
        time: [1, 2, 3, 4],
        values: [
          [0, 7],
          [1, 8],
          [0, 7],
          [1, 8],
        ],
        labels: ["sample", "run"],
        units: ["", ""],
        metadata: {},
        cat_levels: { 0: ["A123", "B456"] },
      },
    };
    expect(splitColumn(ds, 0).groups.map((g) => g.label)).toEqual(["A123", "B456"]);
    // Channel 1 has no table of its own: continuous by the heuristic (4 rows
    // < MIN_SAMPLES), so it gap-clusters and labels numerically.
    expect(splitColumn(ds, 1).groups.map((g) => g.label)).toEqual(["7", "8"]);
  });

  // A code the table can't resolve (out of range, or non-integer) keeps its
  // numeric label + unit rather than getting an invented name or a blank.
  it("falls back to the numeric label for a code outside the level table", () => {
    const ds: Dataset = {
      id: "d1",
      name: "run.dat",
      data: {
        time: [1, 2, 3, 4],
        values: [[0], [1], [5], [5]],
        labels: ["sample"],
        units: [""],
        metadata: {},
        cat_levels: { 0: ["A123", "B456"] },
      },
    };
    expect(splitColumn(ds, 0).groups.map((g) => g.label)).toEqual(["A123", "B456", "5"]);
    // MEASURED, and it corrected the doc comment (review round, LOW 8): the
    // unit is NOT re-attached here. Once the canonical resolver names a column
    // at all, `barlayout.ts`'s `catTableLabels` fills any code its table does
    // not cover with a formatted number of its own, so the group gets that
    // name — "5", not "5 K". That is deliberate consistency: an axis tick for
    // the same unmapped code reads "5" too. The unit-bearing fallback belongs
    // to a column the resolver declines WHOLESALE — see the text-sidecar
    // negative control below, which asserts "0 K"/"1 K"/"2 K".
    const withUnit: Dataset = { ...ds, data: { ...ds.data, units: ["K"] } };
    expect(splitColumn(withUnit, 0).groups.map((g) => g.label)).toEqual(["A123", "B456", "5"]);
  });

  // The `channelTypes` override is the FIRST thing `channelModelingType`
  // honours, and it was equally invisible to the old heuristic-only path.
  it("honours a channelTypes override on values the heuristic calls continuous", () => {
    const ds: Dataset = {
      id: "d1",
      name: "run.dat",
      data: {
        time: [1, 2, 3, 4],
        values: [[10], [20], [10], [20]],
        labels: ["setpoint"],
        units: ["K"],
        metadata: {},
      },
      channelTypes: { 0: "nominal" },
    };
    const { groups, tolerance } = splitColumn(ds, 0);
    expect(tolerance).toBeNull(); // exact-value grouping, because of the override
    expect(groups.map((g) => g.label)).toEqual(["10 K", "20 K"]); // no level table -> numeric + unit
    expect(groups.map((g) => g.rowIndexes)).toEqual([
      [0, 2],
      [1, 3],
    ]);
    // Without the override the same values gap-cluster (a tolerance is
    // reported) — proof the override, not the shape, decided it.
    const { tolerance: noOverride } = splitColumn({ ...ds, channelTypes: undefined }, 0);
    expect(noOverride).not.toBeNull();
  });

  // MEDIUM 4 + 6 of the review round. `channelModelingType` checks the
  // `channelTypes` override BEFORE the level table, so the override wins in
  // BOTH directions and both outcomes are surprising enough to pin. Neither is
  // a defect: the override is the user stating what the column MEANS, and the
  // split obeys it. What would be a defect is the two paths disagreeing again.
  it('a "nominal" override splits a wobbly setpoint column per DISTINCT read', () => {
    // The module header's own motivating fixture: 4 setpoints x 5 wobble reads.
    // Continuous, it gap-clusters to 4 groups. Declared nominal, exact-value
    // grouping is correct BY DEFINITION and yields one group per distinct
    // read — measured 20, under SPLIT_GROUP_CAP, so it commits.
    const setpoints = [5, 10, 50, 100];
    const values: number[][] = [];
    for (const sp of setpoints) for (let i = 0; i < 5; i++) values.push([sp + i * 0.001]);
    const data: DataStruct = {
      time: values.map((_, i) => i),
      values,
      labels: ["T"],
      units: ["K"],
      metadata: {},
    };
    expect(splitColumn(asDataset(data), 0).groups).toHaveLength(4);
    const overridden: Dataset = { ...asDataset(data), channelTypes: { 0: "nominal" } };
    const { groups, tolerance } = splitColumn(overridden, 0);
    expect(groups).toHaveLength(20);
    expect(tolerance).toBeNull();
    expect(groups.length).toBeLessThanOrEqual(SPLIT_GROUP_CAP); // so it really does commit
  });

  it('a "continuous" override gap-clusters a level-table column, codes and all', () => {
    // The override is checked FIRST, ahead of the level table — so this
    // reproduces the pre-fix symptom on purpose: one group whose label is the
    // MEDIAN of the level codes. Recorded because "a level table is the
    // strongest signal there is" (lib/modeling.ts) is true only relative to
    // the numeric-shape heuristic, NOT relative to an explicit user override.
    const ds: Dataset = {
      id: "d1",
      name: "run.dat",
      data: {
        time: [1, 2, 3, 4, 5, 6],
        values: [[0], [1], [2], [0], [1], [2]],
        labels: ["sample"],
        units: [""],
        metadata: {},
        cat_levels: { 0: ["A123", "B456", "C789"] },
      },
      channelTypes: { 0: "continuous" },
    };
    expect(isCategoricalColumn(ds, 0)).toBe(false);
    const { groups, tolerance } = splitColumn(ds, 0);
    expect(groups.map((g) => `${g.label}:${g.rowIndexes.length}`)).toEqual(["1:6"]);
    expect(tolerance).not.toBeNull();
    // Drop the override and the level table takes over again.
    expect(splitColumn({ ...ds, channelTypes: undefined }, 0).groups.map((g) => g.label)).toEqual([
      "A123",
      "B456",
      "C789",
    ]);
  });

  // The bug from its second angle: `lib/byPartition.ts`'s `byColumnOptions`
  // (which decides which columns are OFFERED as categorical) already used
  // `channelModelingType`, while `splitColumn` (which decides HOW the chosen
  // column is grouped) used the raw heuristic. Two paths, two answers to the
  // same question. They must now agree.
  it("agrees with byPartition's offered-column decision for the same (dataset, column)", () => {
    const ds = categoricalDataset();
    const offered = byColumnOptions(ds, [{ index: 0, label: "sample" }]);
    expect(offered.map((c) => c.index)).toEqual([0]); // byPartition offers it
    expect(isCategoricalColumn(ds, 0)).toBe(true); // and split now groups it that way
  });

  // HIGH 1 of the BUG-008 review round. `channelModelingType` calls a column
  // categorical for THREE reasons and only one of them carries a `cat_levels`
  // table. An Origin `.opj` import is the second shape: numeric codes plus an
  // `origin_text_columns` sidecar, no level table — the exact case
  // `lib/statschooser.ts`'s header records having already been got wrong once
  // by reaching for the narrow `lib/categorical.ts` accessor ("batch = 0" for
  // the same column Data Filter and Tabulate labelled "Reference"). The first
  // cut of this fix made that mistake again; measured then, this returned
  // ["0","1","2"] while `resolveCategoryLabels` on the same column returned
  // ["Reference","Doped","Annealed"].
  it("names groups from an Origin text sidecar when there is no level table", () => {
    const n = 12;
    const ds: Dataset = {
      id: "d1",
      name: "run.opj",
      data: {
        time: Array.from({ length: n }, (_, i) => i),
        values: Array.from({ length: n }, (_, i) => [i % 3]),
        labels: ["batch"],
        units: [""],
        metadata: {
          origin_text_columns: {
            A: Array.from({ length: n }, (_, i) => ["Reference", "Doped", "Annealed"][i % 3]),
          },
        },
        // deliberately NO cat_levels — this is the Origin shape
      },
    };
    const { groups } = splitColumn(ds, 0);
    expect(groups.map((g) => g.label)).toEqual(["Reference", "Doped", "Annealed"]);
    // And it agrees with what every other surface shows for this column.
    expect(resolveCategoryLabels(ds.data, 0, categoryLevels(ds.data, 0))).toEqual([
      "Reference",
      "Doped",
      "Annealed",
    ]);
  });

  // A sidecar that does NOT consistently cover the levels must not produce a
  // name — the resolver declines, and the numeric label (with unit) stands.
  // This is the negative control for the sidecar half.
  it("keeps numeric labels when a text sidecar disagrees with itself on a level", () => {
    const n = 12;
    const ds: Dataset = {
      id: "d1",
      name: "run.opj",
      data: {
        time: Array.from({ length: n }, (_, i) => i),
        values: Array.from({ length: n }, (_, i) => [i % 3]),
        labels: ["setpoint"],
        units: ["K"],
        metadata: {
          // level 0's rows say "Reference" and then "Other" — inconsistent, so
          // this column cannot name the levels.
          origin_text_columns: {
            A: Array.from({ length: n }, (_, i) => (i === 3 ? "Other" : ["Reference", "Doped", "Annealed"][i % 3])),
          },
        },
      },
    };
    expect(splitColumn(ds, 0).groups.map((g) => g.label)).toEqual(["0 K", "1 K", "2 K"]);
  });

  // LOW 7 of the review round: `labelForCode` returns the level string, and
  // "" is not nullish, so a `??` fallback produced a child dataset literally
  // named "run.dat ()". `isValidLevelList` and `sanitizeDataStruct` both
  // accept "", so a hand-edited or foreign `.dwk` reaches this.
  it("treats an EMPTY level name as no name, not as a blank label", () => {
    const ds: Dataset = {
      id: "d1",
      name: "run.dat",
      data: {
        time: [1, 2, 3, 4],
        values: [[0], [1], [0], [1]],
        labels: ["sample"],
        units: ["K"],
        metadata: {},
        cat_levels: { 0: ["", "B456"] },
      },
    };
    expect(splitColumn(ds, 0).groups.map((g) => g.label)).toEqual(["0 K", "B456"]);
  });

  it("pickDefaultSplitColumn prefers a level-table column over a continuous one", () => {
    const n = 6;
    const ds: Dataset = {
      id: "d1",
      name: "run.dat",
      data: {
        time: Array.from({ length: n }, (_, i) => i),
        // channel 0: a continuous sweep (6 distinct values, gap-clustered
        // into more groups); channel 1: 3 named levels.
        values: [
          [1.0, 0],
          [2.5, 1],
          [4.1, 2],
          [5.9, 0],
          [7.4, 1],
          [9.2, 2],
        ],
        labels: ["field", "sample"],
        units: ["T", ""],
        metadata: {},
        cat_levels: { 1: ["A123", "B456", "C789"] },
      },
    };
    expect(pickDefaultSplitColumn(ds)).toBe(1);
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

  it("P1.4 review P2-2: carries cat_levels forward (a row slice preserves column layout)", () => {
    const catSource: DataStruct = { ...source, cat_levels: { 1: ["North", "South"] } };
    const sliced = sliceDataStruct(catSource, [1, 3]);
    expect(sliced.cat_levels).toEqual({ 1: ["North", "South"] });
  });

  it("omits cat_levels when the source has none (additive, not a stray undefined key)", () => {
    const sliced = sliceDataStruct(source, [0, 1]);
    expect("cat_levels" in sliced).toBe(false);
  });

  it("never aliases the source's mutable arrays", () => {
    const sliced = sliceDataStruct(source, [0, 1]);
    sliced.values[0][0] = 999;
    sliced.labels.push("C");
    expect(source.values[0][0]).toBe(10);
    expect(source.labels).toEqual(["A", "B"]);
  });
});

// BUG-006. `sliceDataStruct` copied `metadata` whole, but the `text_columns`
// sidecar inside it is indexed BY ROW — so an Extract or a Split-by-column gave
// the child the right numeric rows and the PARENT's full text-cell lists. Every
// sample id, operator and run label then read against a different measurement
// than the one it belonged to: a wrong value displayed as if it were right.
describe("sliceDataStruct — row-indexed metadata sidecars (BUG-006)", () => {
  const withText = (extra: Record<string, unknown> = {}): DataStruct => ({
    time: [10, 20, 30, 40],
    values: [[1], [2], [3], [4]],
    labels: ["Y"],
    units: [""],
    metadata: {
      text_columns: { SampleID: ["s0", "s1", "s2", "s3"], Operator: ["a", "b", "c", "d"] },
      ...extra,
    },
  });

  it("slices text-column cells to the SAME rows as the numbers", () => {
    const out = sliceDataStruct(withText(), [1, 3]);
    expect(out.values).toEqual([[2], [4]]);
    const cols = out.metadata["text_columns"] as Record<string, string[]>;
    expect(cols.SampleID).toEqual(["s1", "s3"]);
    expect(cols.Operator).toEqual(["b", "d"]);
  });

  it("keeps row order, including a non-ascending slice", () => {
    // Split groups are usually ascending, but the signature accepts any order
    // and the text cells must follow the SAME permutation as the numbers.
    const out = sliceDataStruct(withText(), [3, 0]);
    expect(out.values).toEqual([[4], [1]]);
    expect((out.metadata["text_columns"] as Record<string, string[]>).SampleID).toEqual(["s3", "s0"]);
  });

  it("reads a gap INSIDE a short text column as a blank cell, not undefined", () => {
    // A text column may be shorter than `time` (columnmeta.ts's TextColumn
    // doc). `undefined` would serialize to null and read back as a hole.
    const ds = withText();
    (ds.metadata["text_columns"] as Record<string, string[]>).Operator = ["a", "b"];
    const out = sliceDataStruct(ds, [0, 2, 1]);
    const cols = out.metadata["text_columns"] as Record<string, string[]>;
    expect(cols.Operator).toEqual(["a", "", "b"]);
    expect(cols.Operator.every((c) => typeof c === "string")).toBe(true);
  });

  it("does not pad a short text column out to the slice length", () => {
    // TRAILING misses are dropped rather than materialized: the column already
    // reads as blank for the rows it doesn't cover, so padding it changes
    // nothing on screen while growing every derived dataset (and, on the
    // `store/cellEdit.ts` path, the SAVED one) by a cell per edit.
    const ds = withText();
    (ds.metadata["text_columns"] as Record<string, string[]>).Operator = ["a"];
    const out = sliceDataStruct(ds, [0, 2]);
    expect((out.metadata["text_columns"] as Record<string, string[]>).Operator).toEqual(["a"]);
  });

  it("slices the origin_text_columns spelling too", () => {
    const ds: DataStruct = {
      time: [1, 2, 3],
      values: [[1], [2], [3]],
      labels: ["Y"],
      units: [""],
      metadata: { origin_text_columns: { A: ["x", "y", "z"] } },
    };
    const out = sliceDataStruct(ds, [2, 0]);
    expect((out.metadata["origin_text_columns"] as Record<string, string[]>).A).toEqual(["z", "x"]);
  });

  it("slices origin_report_sheets too — the sidecar the first fix MISSED", () => {
    // `{short_name: [cell per row]}` of Origin report-sheet reference strings
    // (io/origin_project/opj.py). The first version of this fix asserted in its
    // own comment that nothing else was row-indexed; a review found this.
    const ds = withText();
    ds.metadata["origin_report_sheets"] = { A: ["r0", "r1", "r2", "r3"] };
    const out = sliceDataStruct(ds, [3, 1]);
    expect((out.metadata["origin_report_sheets"] as Record<string, string[]>).A).toEqual(["r3", "r1"]);
  });

  it("carries an ARRAY-shaped text_columns through untouched (corrupted sidecar)", () => {
    // The shape guard, pinned on its own. `text_columns` must be
    // `{name: cells[]}`; a bare ARRAY there is corrupt. Without the
    // `Array.isArray(raw)` rejection, `Object.entries` would happily walk the
    // array's INDICES and hand back an object — silently changing the shape of
    // data we failed to understand, instead of leaving it alone.
    const ds = withText();
    ds.metadata["text_columns"] = ["a", "b"] as unknown as Record<string, string[]>;
    const out = sliceDataStruct(ds, [0]);
    expect(out.metadata["text_columns"]).toEqual(["a", "b"]);
  });

  it("does NOT slice CHANNEL-indexed or file-level sidecars", () => {
    // `label_rows[].cells` is one cell per CHANNEL and `all_column_names` is the
    // column roster; both are unaffected by which rows survive.
    //
    // A characterization test, and worth naming as one: TWO independent
    // mechanisms keep these safe — they are not in `ROW_INDEXED_SIDECARS`, and
    // they are not `{name: array}` objects — so removing either alone leaves
    // this passing. It pins the user-visible contract, not a single guard; the
    // guards have their own tests above and beside it.
    const labelRows = [{ index: 0, role: "label", x: "H", cells: ["Y"] }];
    const out = sliceDataStruct(withText({ label_rows: labelRows, all_column_names: ["H", "Y"], comments: ["# hi"] }), [1]);
    expect(out.metadata["label_rows"]).toEqual(labelRows);
    expect(out.metadata["all_column_names"]).toEqual(["H", "Y"]);
    expect(out.metadata["comments"]).toEqual(["# hi"]); // file-level, untouched
  });

  it("carries a structurally corrupted sidecar through rather than inventing a shape", () => {
    const ds = withText();
    ds.metadata["text_columns"] = { Bad: "not an array" } as unknown as Record<string, string[]>;
    const out = sliceDataStruct(ds, [0]);
    expect((out.metadata["text_columns"] as Record<string, unknown>).Bad).toBe("not an array");
  });

  it("leaves a dataset with no text sidecar byte-identical to before", () => {
    const plain: DataStruct = {
      time: [1, 2], values: [[1], [2]], labels: ["Y"], units: [""], metadata: { source: "/x.dat" },
    };
    const out = sliceDataStruct(plain, [1]);
    expect(out.metadata).toEqual({ source: "/x.dat" });
    expect("text_columns" in out.metadata).toBe(false);
  });
});
