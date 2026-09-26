// statStageLevels — the decoration that puts P2.6 box 2's axis accounting onto
// the Stat Stage's already-computed draws (flat and faceted), and the notice.

import { describe, expect, it } from "vitest";

import { boxStatsClient } from "../../lib/statstage";
import type { DataStruct, Dataset } from "../../lib/types";
import type { StatDrawData } from "./statRender";
import { applyLevels, decorateDraw, flatAxis, type LevelsInput } from "./statStageLevels";

// grp declares A B C; C has no rows. Row 4 (grp B) is excluded.
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
  cat_levels: { 0: ["A", "B", "C"], 2: ["f0", "f1"] },
};
const DS: Dataset = { id: "d", name: "d", data: DATA, excludedRows: [4] };
const ANALYSIS: DataStruct = { ...DATA, time: [0, 1, 2, 3, 5], values: DATA.values.filter((_, r) => r !== 4) };

function lv(over: Partial<LevelsInput> = {}): LevelsInput {
  return {
    active: DS, data: ANALYSIS, mode: "box", groupCol: 0, group2Col: null, valueCol: 1, plotted: [1],
    barValueChannels: [1], facetCol: null, hideEmpty: false, showN: true, ...over,
  };
}

const boxDraw = (): StatDrawData => ({
  mode: "box",
  boxes: [boxStatsClient([1, 2, 3], 1.5, "grp = A"), boxStatsClient([4], 1.5, "grp = B")],
  valueLabel: "y",
  groupLabel: "grp",
});

describe("decorateDraw", () => {
  it("box: threads the groups onto the full axis — the declared-only level is an empty slot", () => {
    const { draw, aligned } = decorateDraw(boxDraw(), flatAxis(lv()), false, true);
    expect(draw.mode === "box" && draw.slots?.map((s) => [s.label, s.group])).toEqual([
      ["grp = A", 0],
      ["grp = B", 1],
      ["grp = C", null],
    ]);
    expect(draw.mode === "box" && draw.showN).toBe(true);
    // B: one usable row, one NaN, one excluded — all counted on the slot.
    expect(aligned?.[1]).toMatchObject({ n: 1, nonFinite: 1, excluded: 1 });
  });

  it("hide-empty keeps only the plotted groups on the axis", () => {
    const { draw } = decorateDraw(boxDraw(), flatAxis(lv()), true, false);
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
    const { draw } = decorateDraw(bar, flatAxis(lv({ mode: "bar" })), false, true);
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
    expect(decorateDraw(qq, flatAxis(lv()), false, true).draw).toBe(qq);
  });
});

describe("applyLevels", () => {
  it("flat: decorated draw plus a notice naming the empty level and the dropped rows, with the caveat", () => {
    const r = applyLevels(lv(), boxDraw(), null);
    expect(r.notice?.line).toBe(
      "Caveat: n < 3 in 1 group · 1 empty level (n=0) · 2 rows dropped (1 non-finite, 1 excluded/filtered)",
    );
    expect(r.notice?.caveat).toContain("n < 3 in 1 group");
    expect(r.notice?.detail).toContain("grp = C: n=0 (never occurs)");
  });

  it("faceted: every panel carries the WHOLE axis, so a level missing from one slice is an empty slot there", () => {
    const facetDraw = (label: string, boxes: StatDrawData) => ({ label, draw: boxes });
    const f0: StatDrawData = {
      mode: "box", boxes: [boxStatsClient([1, 2], 1.5, "grp = A")], valueLabel: "y", groupLabel: "grp",
    };
    const f1: StatDrawData = {
      mode: "box",
      boxes: [boxStatsClient([3], 1.5, "grp = A"), boxStatsClient([4], 1.5, "grp = B")],
      valueLabel: "y", groupLabel: "grp",
    };
    const r = applyLevels(lv({ facetCol: 2 }), null, [facetDraw("f0", f0), facetDraw("f1", f1)]);
    const labels = r.drawFacets?.map((f) => (f.draw.mode === "box" ? f.draw.slots?.map((s) => `${s.label}:${s.group}`) : null));
    expect(labels).toEqual([
      ["grp = A:0", "grp = B:null", "grp = C:null"],
      ["grp = A:0", "grp = B:1", "grp = C:null"],
    ]);
    // Panel groups are what the caveat counts (f1's two singletons, f0's pair).
    expect(r.notice?.caveat).toContain("n < 3 in 3 groups");
  });

  it("returns the draws untouched outside the categorical modes", () => {
    const r = applyLevels(lv({ mode: "histogram" }), null, null);
    expect(r).toEqual({ draw: null, drawFacets: null, notice: null });
  });
});
