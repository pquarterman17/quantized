// S4 + per-level masking (regression-matrix-pixels.spec.ts, `group`). The levels
// interleave (A B C A B C), so each level's own rows are isolated and uPlot
// clips a one-point run to nothing. Another level's row therefore reaches uPlot
// as `undefined` (its line builder skips it and draws across), while a level's
// OWN non-finite row is `null` (uPlot 1.6.32 `findGaps` tests `=== null`), so the
// screen breaks that level's line exactly where the export's matplotlib line
// breaks. `spanGaps` stays off everywhere: it would bridge the genuine NaN.

import { describe, expect, it, vi } from "vitest";

import { buildOpts } from "./uplotOpts";
import { applyEncodedSplit, encodedNames, encodedSplit } from "./plotEncoding";
import { applyGroupSplit } from "./plotGroupSplit";
import { buildXY } from "./plotspec";
import type { PlotPayload } from "./plotdata";
import type { DataStruct } from "./types";

const base = { width: 600, height: 400, xScale: "linear" as const, yScale: "linear" as const, tool: "zoom" as const, onReadout: vi.fn() };

const payload = (y: (number | null)[] = [1, 2, 3, 4, 5, 6]): PlotPayload => ({
  data: [[0, 1, 2, 3, 4, 5], y],
  series: [{ label: "Y", unit: "" }],
  xLabel: "x",
  xUnit: "",
});
const CODES = [0, 1, 2, 0, 1, 2];
const U = undefined;

const dataStruct = (y: number[]) =>
  ({
    time: [0, 1, 2, 3, 4, 5], values: CODES.map((c, r) => [y[r], c]), labels: ["Y", "G"], units: ["", ""],
    metadata: { cat_levels: { 1: ["A", "B", "C"] } },
  }) as unknown as DataStruct;

describe("levels interleaved without a NaN stay continuous on screen", () => {
  it("applyGroupSplit: other-level rows are undefined (spanned), never null", () => {
    const out = applyGroupSplit(payload(), CODES, "g", (c) => "ABC"[c]);
    expect(out.data.slice(1)).toEqual([[1, U, U, 4, U, U], [U, 2, U, U, 5, U], [U, U, 3, U, U, 6]]);
    expect((out.data[1] as unknown[]).includes(null)).toBe(false);
  });

  it("buildXY and applyEncodedSplit produce the same masks", () => {
    const ds = dataStruct([1, 2, 3, 4, 5, 6]);
    expect(buildXY(ds, null, [0], 1).data.slice(1)).toEqual([[1, U, U, 4, U, U], [U, 2, U, U, 5, U], [U, U, 3, U, U, 6]]);
    const split = encodedSplit(ds, [0], { group: 1, color: null, symbol: null, label: null } as never);
    const { specs } = encodedNames(ds, split);
    expect(applyEncodedSplit(payload(), split, specs).data.slice(1)).toEqual([[1, U, U, 4, U, U], [U, 2, U, U, 5, U], [U, U, 3, U, U, 6]]);
  });

  it("no series asks uPlot for spanGaps, so a null is a break", () => {
    const opts = buildOpts(applyGroupSplit(payload(), CODES, "g", (c) => "ABC"[c]), base);
    expect(opts.series.slice(1).map((s) => s.spanGaps)).toEqual([undefined, undefined, undefined]);
  });
});

describe("a level with an interior NaN breaks on screen, as the export does", () => {
  it("applyGroupSplit: the level's own non-finite row is null; other levels' rows stay undefined", () => {
    // level A owns rows 0 and 3: row 3 is NaN. Level B's own row 4 is NaN too.
    const out = applyGroupSplit(payload([1, 2, 3, NaN, null, 6]), CODES, "g", (c) => "ABC"[c]);
    expect(out.data.slice(1)).toEqual([[1, U, U, null, U, U], [U, 2, U, U, null, U], [U, U, 3, U, U, 6]]);
  });

  it("buildXY and applyEncodedSplit agree", () => {
    const ds = dataStruct([1, 2, 3, NaN, 5, 6]);
    const want = [[1, U, U, null, U, U], [U, 2, U, U, 5, U], [U, U, 3, U, U, 6]];
    expect(buildXY(ds, null, [0], 1).data.slice(1)).toEqual(want);
    const split = encodedSplit(ds, [0], { group: 1, color: null, symbol: null, label: null } as never);
    const { specs } = encodedNames(ds, split);
    expect(applyEncodedSplit(payload([1, 2, 3, NaN, 5, 6]), split, specs).data.slice(1)).toEqual(want);
  });

  it("uPlot's gap rule: only null opens a gap (interior NaN breaks; foreign rows do not)", () => {
    const out = applyGroupSplit(payload([1, 2, 3, NaN, 5, 6]), CODES, "g", (c) => "ABC"[c]);
    const gapOpens = (col: ArrayLike<number | null | undefined>) => Array.from(col, (v) => v === null);
    expect(gapOpens(out.data[1] as never)).toEqual([false, false, false, true, false, false]);
    expect(gapOpens(out.data[2] as never).some(Boolean)).toBe(false);
  });

  it("a single level keeps its own NaN as a break too (no foreign rows)", () => {
    const out = applyGroupSplit(payload([1, NaN, 3, 4, 5, 6]), [0, 0, 0, 0, 0, 0], "g", () => "A");
    expect(out.data[1]).toEqual([1, null, 3, 4, 5, 6]);
  });
});
