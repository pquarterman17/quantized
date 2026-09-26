// P2.5 keyed join with a TEXT key (lib/worksheetJoin.ts): a categorical
// channel keys by its LEVEL TEXT (never its code — two datasets rarely number
// levels alike), a text sidecar column keys by name, and analyzeJoin counts
// the same keys the join matches on.

import { describe, expect, it } from "vitest";

import { transformParamsOf } from "./transformRun";
import { analyzeJoin } from "./transformWarnings";
import type { DataStruct } from "./types";
import { joinKeyColumn, joinWorksheets } from "./worksheetJoin";

// Sample ids as a categorical channel. Left numbers "B" as code 1, right as 0.
const left: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[0, 1.5], [1, 2.5], [1, 9.9], [Number.NaN, 4]],
  labels: ["Sample", "Tc"],
  units: ["", "K"],
  metadata: {},
  cat_levels: { 0: ["A", "B"] },
};
const right: DataStruct = {
  time: [0, 1, 2],
  values: [[0, 7, 1], [1, 8, 0], [2, 9, 1]],
  labels: ["Sample", "Hc", "Grade"],
  units: ["", "Oe", ""],
  metadata: {},
  cat_levels: { 0: ["B", "C", "A"], 2: ["lo", "hi"] },
};

describe("join by a text key", () => {
  it("matches a categorical key by its level text, not its code", () => {
    const out = joinWorksheets(left, right, 0, 0, "inner");
    // Left order of first appearance; B's duplicate (row 2) and the blank key
    // (row 3) are not joined.
    expect(out.labels).toEqual(["Sample", "Tc", "Hc", "Grade"]);
    expect(out.time).toEqual([0, 1]);
    expect(out.cat_levels?.[0]).toEqual(["A", "B"]);
    // A: Tc 1.5 / right row 2 (Hc 9, Grade code 1 = "hi"); B: Tc 2.5 / right row 0.
    expect(out.values).toEqual([[0, 1.5, 9, 1], [1, 2.5, 7, 1]]);
    // The right side's own level table travels with its column.
    expect(out.cat_levels?.[3]).toEqual(["lo", "hi"]);
    expect(out.metadata).toMatchObject({ worksheet_transform: "join", join_key: "text", x_column_name: "Row" });
  });

  it("a full join keeps right-only keys after the left ones, blank on the left", () => {
    const out = joinWorksheets(left, right, 0, 0, "full");
    expect(out.cat_levels?.[0]).toEqual(["A", "B", "C"]);
    expect(out.values[2][0]).toBe(2);
    expect(out.values[2][1]).toBeNaN();
    expect(out.values[2][2]).toBe(8);
  });

  it("keys on a text sidecar column by name", () => {
    const withText: DataStruct = {
      time: [0, 1, 2],
      values: [[1], [2], [3]],
      labels: ["v"],
      units: [""],
      metadata: { text_columns: { ID: ["s1", "s2", ""] } },
    };
    const other: DataStruct = { ...withText, values: [[10], [20], [30]], labels: ["w"], metadata: { text_columns: { ID: ["s2", "s9", "s1"] } } };
    expect(joinKeyColumn(withText, "ID")).toEqual({ kind: "text", keys: ["s1", "s2", null] });
    const out = joinWorksheets(withText, other, "ID", "ID", "inner");
    expect(out.labels).toEqual(["ID", "v", "w"]);
    expect(out.cat_levels?.[0]).toEqual(["s1", "s2"]);
    expect(out.values).toEqual([[0, 1, 30], [1, 2, 10]]);
    expect(() => joinWorksheets(withText, other, "Nope", "ID")).toThrow('there is no text column "Nope"');
  });

  it("refuses a text key against a numeric one instead of guessing", () => {
    expect(() => joinWorksheets(left, right, 0, 1)).toThrow(/left key is text but the right key is numeric/);
  });

  it("analyzeJoin counts the same text keys the join matches on", () => {
    const w = analyzeJoin(left, right, 0, 0, "inner", "left.dat", "right.dat");
    expect(w.map((x) => x.code)).toEqual(["duplicate-keys", "blank-keys", "unmatched-dropped"]);
    expect(w[0].text).toBe('left.dat: 1 row repeats an earlier key (1 duplicated key value in "Sample"); only the first row of each key is kept.');
    expect(w[1].text).toBe('left.dat: 1 row with a blank "Sample" cannot match anything and is dropped.');
    expect(w[2].text).toContain("right.dat: 1 key value has no match in left.dat");
    // Text keys carry no unit, so no unit-mismatch is ever raised for them.
    expect(w.some((x) => x.code === "unit-mismatch")).toBe(false);
  });

  it("a numeric key is unchanged: sorted numeric X, no key channel", () => {
    const l: DataStruct = { time: [30, 10], values: [[1], [3]], labels: ["a"], units: [""], metadata: {} };
    const r: DataStruct = { time: [10, 30], values: [[5], [6]], labels: ["b"], units: [""], metadata: {} };
    const out = joinWorksheets(l, r, -1, -1, "inner");
    expect(out.time).toEqual([10, 30]);
    expect(out.labels).toEqual(["a", "b"]);
    expect(out.values).toEqual([[3, 5], [1, 6]]);
    expect(out).not.toHaveProperty("cat_levels");
  });

  it("a recorded join step may name a text column as its key", () => {
    const p = transformParamsOf({ op: "join", leftKey: "ID", rightKey: 0, mode: "left", with: { id: "R", name: "r" } });
    expect(p).toEqual({ op: "join", leftKey: "ID", rightKey: 0, mode: "left", with: { id: "R", name: "r" } });
    expect(() => transformParamsOf({ op: "join", leftKey: 1.5, rightKey: 0, with: { id: "R" } })).toThrow(/integer "leftKey"/);
  });
});
