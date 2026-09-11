import { describe, expect, it } from "vitest";

import type { DataStruct, Dataset } from "./types";
import {
  barValueDomain,
  connectMeansBreaks,
  boxStatsClient,
  categoricalChannels,
  categorySlots,
  connectMeansSeries,
  type BoxStat,
  finiteDomain,
  firstValueChannel,
  groupBoxStatsClient,
  maskStaleCategoricalPicks,
  resolveGroups,
  resolveGroupsIndexed,
  violinOutline,
  zeroBasedDomain,
} from "./statstage";

// ── boxStatsClient (cross-checked against calc.statplots.box_stats) ─────────
describe("boxStatsClient", () => {
  it("matches the backend's box_stats oracle exactly (11-point sample w/ one outlier)", () => {
    // Oracle: python -c "from quantized.calc.statplots import box_stats;
    // print(box_stats([1,2,3,4,5,6,7,8,9,10,50]))" ->
    // q1=3.5 median=6.0 q3=8.5 iqr=5.0 whislo=1.0 whishi=10.0
    // mean=9.545454545454545 fliers=[50.0]
    const b = boxStatsClient([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 50]);
    expect(b.q1).toBeCloseTo(3.5, 9);
    expect(b.median).toBeCloseTo(6.0, 9);
    expect(b.q3).toBeCloseTo(8.5, 9);
    expect(b.iqr).toBeCloseTo(5.0, 9);
    expect(b.whislo).toBeCloseTo(1.0, 9);
    expect(b.whishi).toBeCloseTo(10.0, 9);
    expect(b.mean).toBeCloseTo(9.545454545454545, 9);
    expect(b.n).toBe(11);
    expect(b.fliers).toEqual([50]);
  });

  it("drops non-finite values before computing", () => {
    const b = boxStatsClient([1, 2, 3, NaN, Infinity, 4, 5]);
    expect(b.n).toBe(5);
  });

  it("throws on an all-non-finite sample", () => {
    expect(() => boxStatsClient([NaN, Infinity])).toThrow();
  });

  it("'range' whis uses min/max with no fliers", () => {
    const b = boxStatsClient([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 50], "range");
    expect(b.whislo).toBe(1);
    expect(b.whishi).toBe(50);
    expect(b.fliers).toEqual([]);
  });

  it("carries the group label through", () => {
    expect(boxStatsClient([1, 2, 3], 1.5, "sample A").label).toBe("sample A");
  });

  // ── mean +/- 95% CI (JMP_GAP J5 #2) -- SAME fixture pinned in
  // tests/test_calc_statplots.py::test_box_stats_mean_sem_ci95_matches_scipy_t
  // so the offline client fallback agrees with the backend to high precision.
  it("mean/sem/ci95 match the backend's box_stats oracle (1..10 sample)", () => {
    // Oracle: python -c "from quantized.calc.statplots import box_stats;
    // print(box_stats([1,2,3,4,5,6,7,8,9,10]))" ->
    // sem=0.9574271077563381 ci_lo=3.334149410331831 ci_hi=7.665850589668169
    const b = boxStatsClient([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(b.mean).toBeCloseTo(5.5, 9);
    expect(b.sem).toBeCloseTo(0.9574271077563381, 6);
    expect(b.ciLo).toBeCloseTo(3.334149410331831, 5);
    expect(b.ciHi).toBeCloseTo(7.665850589668169, 5);
  });

  it("degenerates sem to NaN and ci to the mean itself for a single value", () => {
    const b = boxStatsClient([5]);
    expect(Number.isNaN(b.sem)).toBe(true);
    expect(b.ciLo).toBe(5);
    expect(b.ciHi).toBe(5);
  });
});

describe("groupBoxStatsClient", () => {
  it("computes one BoxStat per group, preserving order", () => {
    const groups = [
      { label: "a", values: [1, 2, 3, 4, 5] },
      { label: "b", values: [10, 20, 30, 40, 50] },
    ];
    const out = groupBoxStatsClient(groups);
    expect(out.map((b) => b.label)).toEqual(["a", "b"]);
    expect(out[0].median).toBeCloseTo(3, 9);
    expect(out[1].median).toBeCloseTo(30, 9);
  });
});

describe("connectMeansSeries (JMP_GAP J5 residual)", () => {
  it("returns each group's mean, in order, straight off BoxStat.mean", () => {
    const boxes = groupBoxStatsClient([
      { label: "a", values: [1, 2, 3, 4, 5] },
      { label: "b", values: [10, 20, 30, 40, 50] },
    ]);
    expect(connectMeansSeries(boxes)).toEqual([boxes[0].mean, boxes[1].mean]);
    expect(connectMeansSeries(boxes)).toEqual([3, 30]);
  });

  it("returns an empty array for an empty boxes list", () => {
    expect(connectMeansSeries([])).toEqual([]);
  });
});

// ── grouping ─────────────────────────────────────────────────────────────────
function makeDataset(labels: string[], rows: number[][]): Dataset {
  const data: DataStruct = {
    time: rows.map((_, i) => i),
    values: rows,
    labels,
    units: labels.map(() => ""),
    metadata: {},
  };
  return { id: "d1", name: "d1", data };
}

describe("categoricalChannels / firstValueChannel", () => {
  // 12+ rows needed for inference (MIN_SAMPLES); nominal = <=8 distinct
  // levels each used >=3x on average.
  const rows = Array.from({ length: 15 }, (_, i) => [i % 3, i * 1.1]);
  const ds = makeDataset(["group", "value"], rows);

  it("flags the few-level column as categorical, not the continuous one", () => {
    expect(categoricalChannels(ds)).toEqual([0]);
  });

  it("picks the first continuous channel other than the group column", () => {
    expect(firstValueChannel(ds, 0)).toBe(1);
  });

  it("returns 0 for a null dataset / falls back sanely", () => {
    expect(categoricalChannels(null)).toEqual([]);
    expect(firstValueChannel(null, -1)).toBe(0);
  });
});

describe("resolveGroups", () => {
  const rows = Array.from({ length: 15 }, (_, i) => [i % 3, i * 1.1, i * 2.2]);
  const ds = makeDataset(["group", "valA", "valB"], rows);

  it("partitions the value column by the categorical column when groupCol is given", () => {
    const groups = resolveGroups(ds.data, 0, 1, [1, 2]);
    expect(groups).toHaveLength(3); // levels 0, 1, 2
    expect(groups.map((g) => g.label)).toEqual(["group = 0", "group = 1", "group = 2"]);
  });

  it("carries categorical level names into box/violin/strip group labels", () => {
    const categorical = makeDataset(["group", "valA", "valB"], rows);
    categorical.data.cat_levels = { 0: ["Control", "Low field", "High field"] };
    const groups = resolveGroups(categorical.data, 0, 1, [1, 2]);
    expect(groups.map((g) => g.label)).toEqual([
      "group = Control",
      "group = Low field",
      "group = High field",
    ]);
  });

  it("falls back to one group per plotted channel when groupCol is null", () => {
    const groups = resolveGroups(ds.data, null, 1, [1, 2]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.label)).toEqual(["valA", "valB"]);
  });

  it("falls back to [valueCol] when nothing is plotted", () => {
    const groups = resolveGroups(ds.data, null, 1, []);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("valA");
  });
});

describe("resolveGroups — NESTED second factor (Group R)", () => {
  // lot/wafer, the JMP reading (PRIMARY_SOFTWARE_AUDIT_PLAN.md:1143). Lot 0
  // holds wafers 0 and 1; lot 1 holds wafer 1 only — RAGGED on purpose, so a
  // cross product would produce a `lot = 1 / wafer = 0` box that must not
  // exist, and a nested/flat mix-up changes the COUNT, not just the labels.
  const rows = [
    [0, 10, 0],
    [0, 11, 0],
    [0, 20, 1],
    [0, 21, 1],
    [1, 30, 1],
    [1, 31, 1],
  ];
  const ds = makeDataset(["lot", "thickness", "wafer"], rows);

  it("one group per (A, B) cell that has values, in nested order, named by both", () => {
    const groups = resolveGroups(ds.data, 0, 1, [1], 2);
    expect(groups.map((g) => g.label)).toEqual([
      "lot = 0 / wafer = 0",
      "lot = 0 / wafer = 1",
      "lot = 1 / wafer = 1",
    ]);
    expect(groups.map((g) => g.values)).toEqual([[10, 11], [20, 21], [30, 31]]);
  });

  it("group2Col === null is the ORDINARY single-factor plot, unchanged", () => {
    expect(resolveGroups(ds.data, 0, 1, [1], null).map((g) => g.label)).toEqual([
      "lot = 0",
      "lot = 1",
    ]);
    // And omitting the argument entirely must mean the same thing — two of the
    // four call sites (computeBoxDraw's fallback, lib/plotspec) rely on that.
    expect(resolveGroups(ds.data, 0, 1, [1])).toEqual(resolveGroups(ds.data, 0, 1, [1], null));
  });

  it("nesting a column inside ITSELF degrades to the single-factor plot", () => {
    // Defense in depth. The mask (`maskStaleCategoricalPicks`) nulls this out
    // before it ever reaches here and the picker omits the chosen column from
    // its list — but `groupsByNestedCategory(d, v, 0, 0)` is perfectly
    // well-defined and would label every box `lot = 0 / lot = 0`, so the
    // resolver refuses it on its own rather than trusting two callers.
    expect(resolveGroups(ds.data, 0, 1, [1], 0).map((g) => g.label)).toEqual([
      "lot = 0",
      "lot = 1",
    ]);
  });

  it("the per-plotted-channel FALLBACK ignores a second factor entirely", () => {
    // groupCol null means there is no first factor to nest inside; the groups
    // are columns, not levels. A second factor here would be meaningless, so
    // it must not change the answer.
    expect(resolveGroups(ds.data, null, 1, [1, 2], 2)).toEqual(
      resolveGroups(ds.data, null, 1, [1, 2]),
    );
  });

  it("resolveGroupsIndexed nests IDENTICALLY — same cells, same order, same counts", () => {
    // The two must not diverge: the jittered points overlay is drawn into the
    // category slots the box stats produced, so a mismatch silently scatters
    // one cell's points over another cell's box.
    const plain = resolveGroups(ds.data, 0, 1, [1], 2);
    const indexed = resolveGroupsIndexed(ds.data, 0, 1, [1], 2);
    expect(indexed.map((g) => g.label)).toEqual(plain.map((g) => g.label));
    expect(indexed.map((g) => g.points.map((pt) => pt.value))).toEqual(
      plain.map((g) => g.values),
    );
    expect(indexed.map((g) => g.points.map((pt) => pt.rowIndex))).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });
});

describe("maskStaleCategoricalPicks — the nested second factor (Group R)", () => {
  const CATS = [{ index: 0 }, { index: 2 }];

  it("passes a live, distinct second factor through", () => {
    expect(maskStaleCategoricalPicks(0, null, CATS, 2).group2Col).toBe(2);
  });

  it("masks a second factor whose column stopped reading as categorical", () => {
    // Same BUG-004 root cause as groupCol: a channelTypes override landed
    // after the pick was made, and nothing else clears the stored pick.
    expect(maskStaleCategoricalPicks(0, null, [{ index: 0 }], 2).group2Col).toBeNull();
  });

  it("is INERT with no first factor — there is nothing to nest inside", () => {
    // groupCol null selects the per-plotted-channel fallback, whose groups are
    // columns rather than levels; nesting inside it is not defined.
    expect(maskStaleCategoricalPicks(null, null, CATS, 2).group2Col).toBeNull();
  });

  it("is inert when the first factor MOVES ONTO it", () => {
    // The picker omits the chosen column from the second list, so the user
    // cannot ask for this directly — but they can pick `wafer` second and then
    // change `group by` to `wafer`, which the picker cannot prevent. Without
    // this rule the axis would read `wafer = 0 / wafer = 0`.
    expect(maskStaleCategoricalPicks(2, null, CATS, 2).group2Col).toBeNull();
  });

  it("is inert when the FIRST factor is itself masked away", () => {
    // groupCol 0 is no longer categorical, so it masks to null and the plot
    // falls back to per-plotted-channel — at which point the still-live second
    // factor must go inert too, or the fallback would silently nest.
    const picks = maskStaleCategoricalPicks(0, null, [{ index: 2 }], 2);
    expect(picks.groupCol).toBeNull();
    expect(picks.group2Col).toBeNull();
  });

  it("leaves the other two picks exactly as they were", () => {
    // facetCol stays UNMASKED (Graph Builder facets on non-categorical columns
    // deliberately); adding a fourth parameter must not have changed that.
    const picks = maskStaleCategoricalPicks(0, 99, [{ index: 0 }, { index: 2 }], 2);
    expect(picks.groupCol).toBe(0);
    expect(picks.facetCol).toBe(99);
  });
});

describe("resolveGroupsIndexed (JMP_GAP J5 #1/#3 — points overlay / strip mode)", () => {
  const rows = Array.from({ length: 15 }, (_, i) => [i % 3, i * 1.1, i * 2.2]);
  const ds = makeDataset(["group", "valA", "valB"], rows);

  it("mirrors resolveGroups' partition (same labels, same order, same counts)", () => {
    const plain = resolveGroups(ds.data, 0, 1, [1, 2]);
    const indexed = resolveGroupsIndexed(ds.data, 0, 1, [1, 2]);
    expect(indexed.map((g) => g.label)).toEqual(plain.map((g) => g.label));
    expect(indexed.map((g) => g.points.length)).toEqual(plain.map((g) => g.values.length));
  });

  it("carries each point's ORIGINAL dataset row index alongside its value", () => {
    const indexed = resolveGroupsIndexed(ds.data, 0, 1, [1, 2]);
    // level 0 = rows 0,3,6,9,12 (i%3===0); values are i*1.1.
    expect(indexed[0].points.map((p) => p.rowIndex)).toEqual([0, 3, 6, 9, 12]);
    const values = indexed[0].points.map((p) => p.value);
    [0, 3.3, 6.6, 9.9, 13.2].forEach((expected, i) => expect(values[i]).toBeCloseTo(expected, 9));
  });

  it("falls back to one indexed group per plotted channel when groupCol is null", () => {
    const indexed = resolveGroupsIndexed(ds.data, null, 1, [1, 2]);
    expect(indexed.map((g) => g.label)).toEqual(["valA", "valB"]);
    expect(indexed[0].points).toHaveLength(15);
    expect(indexed[0].points[0]).toEqual({ value: 0, rowIndex: 0 });
  });
});

// ── scale / layout math ──────────────────────────────────────────────────────
describe("finiteDomain", () => {
  it("pads a normal range", () => {
    const [lo, hi] = finiteDomain([[1, 2, 3, 4, 5]]);
    expect(lo).toBeLessThan(1);
    expect(hi).toBeGreaterThan(5);
  });

  it("widens a degenerate (single-value) range", () => {
    const [lo, hi] = finiteDomain([[5, 5, 5]]);
    expect(lo).toBeLessThan(5);
    expect(hi).toBeGreaterThan(5);
  });

  it("returns [0,1] when nothing is finite", () => {
    expect(finiteDomain([[NaN, Infinity]])).toEqual([0, 1]);
  });

  it("spans across multiple lists (e.g. one box's whiskers + fliers)", () => {
    const [, hi] = finiteDomain([[3, 8], [50]]);
    expect(hi).toBeGreaterThan(50);
  });
});

describe("connectMeansBreaks — the interaction line must not cross a nested boundary", () => {
  // Review finding 2. The line asserts that consecutive categories are steps
  // along ONE factor. Nested, they are not: the step from `lot = 0 / wafer = 1`
  // to `lot = 1 / wafer = 0` crosses into another lot, and drawing it claims a
  // trend between two lots that share no wafer.
  const box = (label: string): BoxStat => ({
    label, q1: 0, median: 1, q3: 2, iqr: 2, whislo: 0, whishi: 2,
    mean: 1, sem: 0.1, ciLo: 0.9, ciHi: 1.1, n: 3, fliers: [],
  });

  it("breaks at each new outer factor, and nowhere else", () => {
    const breaks = connectMeansBreaks([
      box("lot = 0 / wafer = 0"),
      box("lot = 0 / wafer = 1"),
      box("lot = 1 / wafer = 0"),
      box("lot = 1 / wafer = 1"),
    ]);
    // index 0 always starts a segment; index 2 is the first box of lot 1.
    expect(breaks).toEqual([true, false, true, false]);
  });

  it("leaves a SINGLE-factor plot as one unbroken line", () => {
    // The load-bearing case. Consecutive single-factor labels differ by design,
    // so a naive "did the label change?" rule would segment every slot and
    // silently delete the existing interaction plot.
    expect(connectMeansBreaks([box("lot = 0"), box("lot = 1"), box("lot = 2")])).toEqual([
      true, false, false,
    ]);
  });

  it("does not break when the outer factor repeats after a gap it cannot see", () => {
    // Runs, not set membership: `nestedLevels` emits each A level's cells
    // contiguously, so a repeat would mean the order was already wrong. What is
    // pinned here is that the rule compares NEIGHBOURS, which is what makes it
    // a segmenting rule rather than a grouping one.
    expect(connectMeansBreaks([box("a = 0 / b = 0"), box("a = 0 / b = 1")])).toEqual([
      true, false,
    ]);
  });

  it("treats the per-plotted-channel fallback (bare column names) as one line", () => {
    expect(connectMeansBreaks([box("valA"), box("valB")])).toEqual([true, false]);
  });
});

describe("zeroBasedDomain", () => {
  it("always starts at 0 and pads the top", () => {
    expect(zeroBasedDomain([[1, 5, 3]])).toEqual([0, 5 * 1.08]);
  });

  it("returns [0,1] for an all-zero / empty input", () => {
    expect(zeroBasedDomain([[0, 0]])).toEqual([0, 1]);
    expect(zeroBasedDomain([[]])).toEqual([0, 1]);
  });
});

describe("barValueDomain (gap #20 bar mode — always spans 0, unlike zeroBasedDomain)", () => {
  it("spans [0, max] for all-positive values (padded)", () => {
    expect(barValueDomain([1, 5, 3])).toEqual([0, 5 * 1.08]);
  });

  it("spans [min, 0] for all-negative values", () => {
    const [lo, hi] = barValueDomain([-1, -5, -3]);
    expect(hi).toBeCloseTo(0, 10);
    expect(lo).toBeCloseTo(-5 * 1.08, 10);
  });

  it("spans both sides for mixed-sign values, padding each side by its own magnitude", () => {
    const [lo, hi] = barValueDomain([-2, 4]);
    expect(lo).toBeCloseTo(-2 - 2 * 0.08, 10);
    expect(hi).toBeCloseTo(4 + 4 * 0.08, 10);
  });

  it("returns [0,1] for an all-zero / empty / all-non-finite input", () => {
    expect(barValueDomain([0, 0])).toEqual([0, 1]);
    expect(barValueDomain([])).toEqual([0, 1]);
    expect(barValueDomain([NaN, Infinity])).toEqual([0, 1]);
  });
});

describe("categorySlots", () => {
  it("spaces n slots evenly across [0,1] with no overlap", () => {
    const slots = categorySlots(4);
    expect(slots).toHaveLength(4);
    expect(slots.map((s) => s.cx)).toEqual([0.125, 0.375, 0.625, 0.875]);
    // Adjacent boxes never touch: half-width * 2 < slot pitch (0.25).
    for (const s of slots) expect(s.halfWidth * 2).toBeLessThan(0.25);
  });

  it("returns an empty array for n<=0", () => {
    expect(categorySlots(0)).toEqual([]);
  });
});

describe("violinOutline", () => {
  it("normalizes the density peak to half-width 1", () => {
    const out = violinOutline([0, 1, 2], [0, 4, 2]);
    expect(out.map((p) => p.halfWidth)).toEqual([0, 1, 0.5]);
  });

  it("returns all-zero half-widths for a flat/zero density", () => {
    const out = violinOutline([0, 1], [0, 0]);
    expect(out.every((p) => p.halfWidth === 0)).toBe(true);
  });
});
