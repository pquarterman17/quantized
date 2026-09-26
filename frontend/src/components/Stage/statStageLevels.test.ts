// statStageLevels — the decoration that puts P2.6 box 2's axis accounting onto
// the Stat Stage's already-computed draws (flat and faceted), and the notice.

import { describe, expect, it } from "vitest";

import { facetSlices } from "../../lib/facet";
import { pruneExcluded } from "../../lib/rowstate";
import { boxStatsClient } from "../../lib/statstage";
import type { DataStruct, Dataset } from "../../lib/types";
import type { StatDrawData } from "./statRender";
import { applyLevels, decorateDraw, levelAxes, type LevelsInput } from "./statStageLevels";

const SHOW = { hideEmpty: false, showN: true };

// grp declares A B C; C has no rows. Row 4 (grp B) is excluded. fac declares
// f0 f1 f2; f2 has no rows at all.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [
    [0, 1, 0],
    [0, 2, 0],
    [0, 3, 1],
    [1, 4, 1],
    [1, 5, 1],
    [1, Number.NaN, 0],
  ],
  labels: ["grp", "y", "fac"],
  units: ["", "", ""],
  metadata: {},
  cat_levels: { 0: ["A", "B", "C"], 2: ["f0", "f1", "f2"] },
};
const DS: Dataset = { id: "d", name: "d", data: DATA, excludedRows: [4] };
const ANALYSIS = pruneExcluded(DATA, [4]);

function lv(over: Partial<LevelsInput> = {}): LevelsInput {
  const facetCol = over.facetCol ?? null;
  const data = over.data ?? ANALYSIS;
  return {
    active: DS, data, mode: "box", groupCol: 0, group2Col: null, valueCol: 1, plotted: [1],
    barValueChannels: [1], facetCol, slices: facetCol == null ? null : facetSlices(data, facetCol), ...over,
  };
}
const flat = (over: Partial<LevelsInput> = {}) => levelAxes(lv(over))!.flat;

const boxDraw = (...labels: string[]): StatDrawData => ({
  mode: "box",
  boxes: (labels.length ? labels : ["grp = A", "grp = B"]).map((l, i) => boxStatsClient(i === 0 ? [1, 2, 3] : [4], 1.5, l)),
  valueLabel: "y",
  groupLabel: "grp",
});

describe("decorateDraw", () => {
  it("box: threads the groups onto the full axis — the declared-only level is an empty slot", () => {
    const { draw, aligned } = decorateDraw(boxDraw(), flat(), false, true);
    expect(draw.mode === "box" && draw.slots?.map((s) => [s.label, s.group])).toEqual([
      ["grp = A", 0],
      ["grp = B", 1],
      ["grp = C", null],
    ]);
    expect(draw.mode === "box" && draw.showN).toBe(true);
    // B: one usable row, one NaN, one excluded — all counted on the slot.
    expect(aligned?.[1]).toMatchObject({ n: 1, nonFinite: 1, excluded: 1 });
  });

  it("names the plotted groups with the AXIS's one label resolution (screen and export share it)", () => {
    // The groups arrive named by a different resolution (an Origin text
    // sidecar reads differently over the analysis view than over the whole
    // column); the slots' labels win, on the boxes AND their points.
    const d: StatDrawData = {
      ...boxDraw("sidecar A", "sidecar B"),
      points: [{ label: "sidecar A", points: [] }, { label: "sidecar B", points: [] }],
    } as StatDrawData;
    const { draw } = decorateDraw(d, flat(), false, true);
    if (draw.mode !== "box") throw new Error("mode");
    expect(draw.boxes.map((b) => b.label)).toEqual(["grp = A", "grp = B"]);
    expect(draw.points?.map((g) => g.label)).toEqual(["grp = A", "grp = B"]);
  });

  it("hide-empty keeps only the plotted groups on the axis", () => {
    const { draw } = decorateDraw(boxDraw(), flat(), true, false);
    expect(draw.mode === "box" && draw.slots?.map((s) => s.label)).toEqual(["grp = A", "grp = B"]);
    expect(draw.mode === "box" && draw.showN).toBe(false);
  });

  it("bar: pads the matrix with an all-NaN, n=0 category for each empty slot", () => {
    const bar: StatDrawData = {
      mode: "bar",
      data: {
        seriesLabels: ["y"],
        groups: [
          { label: "A", series: [{ mean: 2, sem: 0.5, n: 3 }] },
          { label: "B", series: [{ mean: 4, sem: Number.NaN, n: 1 }] },
        ],
      },
      valueLabel: "y", groupLabel: "grp", stacked: false,
    };
    const { draw } = decorateDraw(bar, flat({ mode: "bar" }), false, true);
    if (draw.mode !== "bar") throw new Error("mode");
    expect(draw.data.groups.map((g) => g.label)).toEqual(["A", "B", "C"]);
    expect(draw.data.groups[2].series[0].n).toBe(0);
    expect(Number.isNaN(draw.data.groups[2].series[0].mean)).toBe(true);
    // Hidden: an existing all-NaN category goes too, even without an axis.
    const hidden = decorateDraw(
      { ...bar, data: { ...bar.data, groups: [...bar.data.groups, { label: "Z", series: [{ mean: Number.NaN, sem: Number.NaN, n: 0 }] }] } },
      null, true, true,
    ).draw;
    expect(hidden.mode === "bar" && hidden.data.groups.map((g) => g.label)).toEqual(["A", "B"]);
  });

  it("leaves Q-Q / histogram draws alone", () => {
    const qq: StatDrawData = { mode: "qq", theo: [], obs: [], slope: 1, intercept: 0, dist: "norm", valueLabel: "y" };
    expect(decorateDraw(qq, flat(), false, true).draw).toBe(qq);
  });
});

describe("applyLevels", () => {
  it("flat: decorated draw plus a notice naming the empty level and the dropped rows, with the caveat", () => {
    const r = applyLevels(levelAxes(lv()), SHOW, boxDraw(), null);
    expect(r.notice?.line).toBe(
      "Caveat: n < 3 in 1 group · 1 empty level (n=0) · 2 rows dropped (1 non-finite, 1 excluded/filtered)",
    );
    expect(r.notice?.caveat).toContain("n < 3 in 1 group");
    expect(r.notice?.detail).toContain("grp = C: n=0 (never occurs)");
  });

  it("a STALE draw (computed for other picks) is neither decorated nor described", () => {
    const d = boxDraw();
    const r = applyLevels(levelAxes(lv()), SHOW, d, null, { draw: false, facets: true });
    expect(r.draw).toBe(d);
    expect(r.notice).toBeNull();
  });

  it("a draw whose group count does not fit the axis renders closed up, and the notice says 'hidden'", () => {
    const r = applyLevels(levelAxes(lv()), SHOW, boxDraw("x", "y", "z"), null);
    expect(r.draw?.mode === "box" && r.draw.slots).toBeNull();
    expect(r.notice?.line).toContain("1 empty level hidden");
  });

  const f0: StatDrawData = {
    mode: "box", boxes: [boxStatsClient([1, 2], 1.5, "grp = A")], valueLabel: "y", groupLabel: "grp",
  };
  const f1: StatDrawData = {
    mode: "box",
    boxes: [boxStatsClient([3], 1.5, "grp = A"), boxStatsClient([4], 1.5, "grp = B")],
    valueLabel: "y", groupLabel: "grp",
  };

  it("faceted: every panel carries the WHOLE axis, so a level missing from one slice is an empty slot there", () => {
    const r = applyLevels(levelAxes(lv({ facetCol: 2 })), SHOW, null, [{ label: "f0", draw: f0 }, { label: "f1", draw: f1 }]);
    const labels = r.drawFacets?.map((f) => (f.draw.mode === "box" ? f.draw.slots?.map((s) => `${s.label}:${s.group}`) : null));
    expect(labels).toEqual([
      ["grp = A:0", "grp = B:null", "grp = C:null"],
      ["grp = A:0", "grp = B:1", "grp = C:null"],
    ]);
    // Panel groups are what the caveat counts (f1's two singletons, f0's pair).
    expect(r.notice?.caveat).toContain("n < 3 in 3 groups");
  });

  it("faceted: a facet level with no panel is counted and named, never silently gone", () => {
    // f2 is declared but no row carries it; f1's panel is missing too (as if
    // the compute dropped it for having no usable value).
    const r = applyLevels(levelAxes(lv({ facetCol: 2 })), SHOW, null, [{ label: "f0", draw: f0 }]);
    expect(r.notice?.line).toContain("2 facet levels with no usable data not shown");
    expect(r.notice?.detail).toContain("no panel (no usable data): f2; f1");
  });

  it("faceted: a facet level whose rows are ALL excluded is counted too", () => {
    const ds: Dataset = { ...DS, excludedRows: [2, 3, 4] }; // every f1 row
    const data = pruneExcluded(DATA, [2, 3, 4]);
    const r = applyLevels(levelAxes(lv({ active: ds, data, facetCol: 2 })), SHOW, null, [{ label: "f0", draw: f0 }]);
    expect(r.notice?.detail).toContain("no panel (no usable data): f1; f2");
  });

  it("faceted: panels that are not on the axis never make a negative or stale count", () => {
    // Drawn facets naming levels the current slices do not have (the async
    // compute mid-flight) contribute nothing: at most "all levels missing".
    const r = applyLevels(levelAxes(lv({ facetCol: 2 })), SHOW, null, [
      { label: "zz", draw: f0 }, { label: "yy", draw: f0 }, { label: "xx", draw: f0 }, { label: "ww", draw: f0 },
    ]);
    expect(r.notice?.line).toContain("3 facet levels with no usable data not shown");
    expect(r.notice?.line).not.toMatch(/-\d/);
  });

  it("faceted: STALE panels (the facet column just changed) are neither decorated nor counted", () => {
    const panels = [{ label: "old1", draw: f0 }, { label: "old2", draw: f0 }];
    const r = applyLevels(levelAxes(lv({ facetCol: 2 })), SHOW, null, panels, { draw: true, facets: false });
    expect(r.drawFacets).toBe(panels);
    expect(r.notice).toBeNull();
  });

  it("faceted: a panel that cannot be threaded onto its axis makes the notice say 'hidden'", () => {
    const odd: StatDrawData = { ...boxDraw("grp = A"), boxes: [boxStatsClient([1, 2], 1.5, "a"), boxStatsClient([9], 1.5, "?")] } as StatDrawData;
    const r = applyLevels(levelAxes(lv({ facetCol: 2 })), SHOW, null, [{ label: "f0", draw: odd }, { label: "f1", draw: f1 }]);
    expect(r.notice?.line).toContain("1 empty level hidden");
    expect(r.notice?.line).not.toContain("(n=0)");
  });

  it("returns the draws untouched outside the categorical modes", () => {
    const r = applyLevels(levelAxes(lv({ mode: "histogram" })), SHOW, null, null);
    expect(r).toEqual({ draw: null, drawFacets: null, notice: null });
  });
});
