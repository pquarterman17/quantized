// S4 (regression-matrix-pixels.spec.ts, `group`): a plot grouped by a categorical
// column painted NO series on the screen canvas. The levels interleave
// (A B C A B C), so each level's column is non-null only at isolated rows, and
// uPlot clips a line stroke to its non-null runs: a run of one point has no
// length. The export (matplotlib) draws each level as a connected line through
// its own points. These tests pin the series-building half of the fix: a split
// level reaches uPlot with `spanGaps`, while an ungrouped series (and a plain
// NaN gap in it) keeps its break.

import { describe, expect, it, vi } from "vitest";

import { buildOpts } from "./uplotOpts";
import { encodedNames, encodedSplit } from "./plotEncoding";
import { applyGroupSplit } from "./plotGroupSplit";
import type { PlotPayload } from "./plotdata";
import type { DataStruct } from "./types";

const base = { width: 600, height: 400, xScale: "linear" as const, yScale: "linear" as const, tool: "zoom" as const, onReadout: vi.fn() };

/** Six rows, levels A B C A B C: every level is non-null at isolated rows. */
const interleaved = (): PlotPayload => ({
  data: [[0, 1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6]],
  series: [{ label: "Y", unit: "" }],
  xLabel: "x",
  xUnit: "",
});
const CODES = [0, 1, 2, 0, 1, 2];

describe("S4: a split level is connected through the other levels' rows on screen", () => {
  it("applyGroupSplit flags every level series when there is more than one level", () => {
    const out = applyGroupSplit(interleaved(), CODES, "g", (c) => "ABC"[c]);
    expect(out.series.map((s) => s.spanGaps)).toEqual([true, true, true]);
    // the data keep their null masking (a genuine gap stays a null; parity with buildXY)
    expect(out.data[1]).toEqual([1, null, null, 4, null, null]);
  });

  it("a single level (nothing to interleave with) is not flagged", () => {
    const out = applyGroupSplit(interleaved(), [0, 0, 0, 0, 0, 0], "g", () => "A");
    expect(out.series.map((s) => s.spanGaps)).toEqual([undefined]);
  });

  it("the encoded split flags its level series; with no factor it does not", () => {
    const data = {
      time: [0, 1, 2, 3, 4, 5], values: CODES.map((c, r) => [r + 1, c]), labels: ["Y", "G"], units: ["", ""],
      metadata: { cat_levels: { 1: ["A", "B", "C"] } },
    } as unknown as DataStruct;
    const grouped = encodedNames(data, encodedSplit(data, [0], { group: 1, color: null, symbol: null, label: null } as never));
    expect(grouped.specs.map((s) => s.spanGaps)).toEqual([true, true, true]);
    const plain = encodedNames(data, encodedSplit(data, [0], { group: null, color: null, symbol: null, label: null } as never));
    expect(plain.specs.map((s) => s.spanGaps)).toEqual([undefined]);
  });

  it("buildOpts hands spanGaps to uPlot for a split level, and only for it", () => {
    const grouped = buildOpts(applyGroupSplit(interleaved(), CODES, "g", (c) => "ABC"[c]), base);
    expect(grouped.series.slice(1).map((s) => s.spanGaps)).toEqual([true, true, true]);
    // an ungrouped series with a real NaN gap keeps `spanGaps` off: the break stays a break
    const gappy: PlotPayload = { ...interleaved(), data: [[0, 1, 2, 3], [1, null, 3, 4]] };
    expect(buildOpts(gappy, base).series[1].spanGaps).toBeFalsy();
  });
});
