// G24 row states: the model's row remap and validators.

import { describe, expect, it } from "vitest";

import { sanitizeRowStyle, sliceRowStyle, usableRowStyle } from "./rowStyle";
import type { Dataset } from "./types";

const ds = (rowStyle: Dataset["rowStyle"], n = 4): Pick<Dataset, "rowStyle" | "data"> => ({
  rowStyle,
  data: { time: Array.from({ length: n }, (_, i) => i), values: [], labels: [], units: [], metadata: {} },
});

describe("usableRowStyle", () => {
  it("returns the arrays that stand one-for-one against the rows", () => {
    expect(usableRowStyle(ds({ color: ["s1", "", "s2", ""] }))?.color).toEqual(["s1", "", "s2", ""]);
  });
  it("ignores a stale array (wrong length) rather than colour the wrong rows", () => {
    expect(usableRowStyle(ds({ color: ["s1", "s2"] }))).toBeUndefined();
    expect(usableRowStyle(ds({ color: ["s1", "s2"], marker: ["circle", "", "", ""] }))?.color).toBeUndefined();
  });
  it("no rowStyle reads as none", () => {
    expect(usableRowStyle(ds(undefined))).toBeUndefined();
    expect(usableRowStyle(null)).toBeUndefined();
  });
});

describe("sliceRowStyle: new row i = old row rowIndexes[i]", () => {
  const rs = { color: ["s1", "s2", "s3", "s4"], marker: ["", "square", "", "star"] };
  it("a sort permutation moves each state with its row", () => {
    expect(sliceRowStyle({ rowStyle: rs }, [3, 1, 0, 2], 4)).toEqual({ rowStyle: { color: ["s4", "s2", "s1", "s3"], marker: ["star", "square", "", ""] } });
  });
  it("an inserted blank (-1) and a delete (dropped index) keep the rest aligned", () => {
    expect(sliceRowStyle({ rowStyle: rs }, [0, -1, 1, 2, 3], 5).rowStyle?.color).toEqual(["s1", "", "s2", "s3", "s4"]);
    expect(sliceRowStyle({ rowStyle: rs }, [0, 2, 3], 3).rowStyle?.color).toEqual(["s1", "s3", "s4"]);
  });
  it("indexes past the new row count are cut (text-only rows must not lengthen the array)", () => {
    expect(sliceRowStyle({ rowStyle: rs }, [0, 1, 2, 3, 4, 5], 4).rowStyle?.color).toHaveLength(4);
  });
  it("nothing surviving clears the style; a dataset without one gets no patch", () => {
    expect(sliceRowStyle({ rowStyle: rs }, [], 0)).toEqual({ rowStyle: undefined });
    expect(sliceRowStyle({}, [0, 1], 2)).toEqual({});
  });
});

describe("sanitizeRowStyle (a .dwk is hand-editable)", () => {
  it("keeps known slots, hex and shapes; blanks anything else", () => {
    const got = sanitizeRowStyle({ color: ["s1", "s9", "#00ff00", "red"], marker: ["star", "blob", "", "circle"] }, 4);
    expect(got).toEqual({ color: ["s1", "", "#00ff00", ""], marker: ["star", "", "", "circle"] });
  });
  it("drops a wrong-length array and a style left with nothing", () => {
    expect(sanitizeRowStyle({ color: ["s1"] }, 4)).toBeUndefined();
    expect(sanitizeRowStyle({ color: ["", "", "", ""] }, 4)).toBeUndefined();
    expect(sanitizeRowStyle("x", 4)).toBeUndefined();
  });
  it("keeps a well-formed legend and drops a malformed one", () => {
    const ok = sanitizeRowStyle({ color: ["s1", "", "", ""], legend: { column: "S", kind: "levels", entries: [{ label: "a", color: "s1" }, null] } }, 4);
    expect(ok?.legend?.entries).toEqual([{ label: "a", color: "s1" }]);
    expect(sanitizeRowStyle({ color: ["s1", "", "", ""], legend: { column: 3 } }, 4)?.legend).toBeUndefined();
  });
});
