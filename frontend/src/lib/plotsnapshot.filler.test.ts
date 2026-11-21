// Audit finding 2: a gapped / thinned snapshot's `undefined` filler (uPlot
// draws ACROSS it) must survive a workspace save and reload, distinct from the
// `null` of a real gap (which breaks the line).
import { describe, expect, it } from "vitest";

import { encodePersistedCells } from "./nonFiniteCells";
import { freezePlotSnapshot, sanitizeFrozenBundle } from "./plotsnapshot";
import { ungap } from "./plotUngap";

const frozen = (col: (number | null | undefined)[]) =>
  freezePlotSnapshot({
    payload: { data: [[0, 1, 2, 3, 4], col] as never, series: [{ label: "a", unit: "" }], xLabel: "x", xUnit: "", decimated: true } as never,
    styleList: undefined, labelList: undefined, errorBars: new Map(), plotted: [0], colorByColumns: new Map(), hidden: undefined,
  });
const roundTrip = (b: ReturnType<typeof frozen>) =>
  sanitizeFrozenBundle((JSON.parse(JSON.stringify({ snapshot: b }, encodePersistedCells)) as { snapshot: unknown }).snapshot);

describe("snapshot filler across a workspace save and reload", () => {
  it("a gapped payload keeps its filler as undefined", () => {
    const gapped = ungap([[0, 1, 2, 3, 4], [1, Number.NaN, Number.NaN, Number.NaN, 5]], [[0, 4]]);
    expect(roundTrip(frozen(gapped[1]))?.payload.data[1]).toEqual([1, undefined, undefined, undefined, 5]);
  });

  it("keeps a real gap (null) distinct from the filler (undefined)", () => {
    const back = roundTrip(frozen([1, undefined, null, Number.NaN, 5]))!.payload.data[1] as (number | null | undefined)[];
    expect(back[1]).toBeUndefined();
    expect(back[2]).toBeNull();
    expect(back[3]).toBeNaN(); // NaN keeps its sentinel
    expect(1 in back).toBe(true); // a dense cell, not a hole
  });

  it("loads a workspace saved before the fix (the same text was already written)", () => {
    const legacy = { payload: { data: [[0, 1, 2], [1, "undefined", 3]], series: [{ label: "a", unit: "" }], xLabel: "x", xUnit: "" }, plotted: [0] };
    expect(sanitizeFrozenBundle(legacy)?.payload.data[1]).toEqual([1, undefined, 3]);
  });
});
