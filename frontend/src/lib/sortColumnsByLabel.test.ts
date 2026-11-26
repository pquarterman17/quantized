// Sort columns by a label row: stable, blanks last in both directions, natural
// text order, numeric parameters, and a partial selection sorted in its slots.

import { describe, expect, it } from "vitest";

import type { ColumnProps } from "./columnProps";
import { columnOrderByLabel, sortPermutation } from "./sortColumnsByLabel";

const data = (labels: string[], units: string[] = [], params: Record<string, string[]> = {}) => ({
  labels,
  units: labels.map((_, i) => units[i] ?? ""),
  metadata: {
    label_rows: Object.entries(params).map(([name, cells], index) => ({ index, role: "label", name, x: name, cells })),
  },
});

describe("columnOrderByLabel", () => {
  it("sorts by long name, naturally and ignoring case", () => {
    const d = data(["T10", "t2", "T1", "b"]);
    expect(columnOrderByLabel(d, undefined, [0, 1, 2, 3], { kind: "name" }, 1).order).toEqual([3, 2, 1, 0]);
    expect(columnOrderByLabel(d, undefined, [0, 1, 2, 3], { kind: "name" }, -1).order).toEqual([0, 1, 2, 3]);
  });

  it("is stable: equal units keep their current order, in both directions", () => {
    const d = data(["a", "b", "c", "d"], ["K", "T", "K", "T"]);
    expect(columnOrderByLabel(d, undefined, [0, 1, 2, 3], { kind: "unit" }, 1).order).toEqual([0, 2, 1, 3]);
    expect(columnOrderByLabel(d, undefined, [0, 1, 2, 3], { kind: "unit" }, -1).order).toEqual([1, 3, 0, 2]);
  });

  it("puts blank labels last whichever way it sorts, and counts them", () => {
    const d = data(["a", "b", "c"], ["", "K", "A"]);
    expect(columnOrderByLabel(d, undefined, [0, 1, 2], { kind: "unit" }, 1)).toEqual({ order: [2, 1, 0], blank: 1 });
    expect(columnOrderByLabel(d, undefined, [0, 1, 2], { kind: "unit" }, -1)).toEqual({ order: [1, 2, 0], blank: 1 });
  });

  it("sorts by comment from the column properties", () => {
    const props: Record<number, ColumnProps> = { 0: { comment: "zeta" }, 2: { comment: "alpha" } };
    expect(columnOrderByLabel(data(["a", "b", "c"]), props, [0, 1, 2], { kind: "comment" }, 1)).toEqual({ order: [2, 0, 1], blank: 1 });
  });

  it("a user parameter compares as a number when both are numbers, else as text", () => {
    const d = data(["a", "b", "c", "d"], [], { Temp: ["300 K", "50 K", "", "5 K"] });
    expect(columnOrderByLabel(d, undefined, [0, 1, 2, 3], { kind: "param", name: "Temp" }, 1).order).toEqual([3, 1, 0, 2]);
    expect(columnOrderByLabel(d, undefined, [0, 1, 2, 3], { kind: "param", name: "Temp" }, -1).order).toEqual([0, 1, 3, 2]);
    const text = data(["a", "b"], [], { Sample: ["beta", "alpha"] });
    expect(columnOrderByLabel(text, undefined, [0, 1], { kind: "param", name: "Sample" }, 1).order).toEqual([1, 0]);
  });

  it("an unknown parameter leaves every column blank, so the order is unchanged", () => {
    expect(columnOrderByLabel(data(["a", "b"]), undefined, [0, 1], { kind: "param", name: "nope" }, 1)).toEqual({ order: [0, 1], blank: 2 });
  });
});

describe("sortPermutation", () => {
  const d = data(["a", "b", "c", "d"], ["4", "3", "2", "1"]);
  it("no targets sorts every column", () => {
    expect(sortPermutation(d, undefined, 4, [], { kind: "unit" }, 1).perm).toEqual([3, 2, 1, 0]);
  });
  it("several targets are sorted among the places they hold; the rest stay put", () => {
    expect(sortPermutation(d, undefined, 4, [3, 0], { kind: "unit" }, 1).perm).toEqual([3, 1, 2, 0]);
  });
  it("a single selected column means the whole sheet (nothing to order it against)", () => {
    expect(sortPermutation(d, undefined, 4, [1], { kind: "unit" }, 1).perm).toEqual([3, 2, 1, 0]);
  });
  it("is always a permutation", () => {
    const { perm } = sortPermutation(data(["x", "y", "z"], ["", "b", ""]), undefined, 3, [], { kind: "unit" }, -1);
    expect([...perm].sort()).toEqual([0, 1, 2]);
  });
});
