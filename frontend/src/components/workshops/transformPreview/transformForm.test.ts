// The Reshape & combine form (pure): the seed, the key choices (text keys
// included) and the one form -> params translation the preview and commit share.

import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { formToRun, keyOptions, parseKey, seedForm } from "./transformForm";

const d: DataStruct = {
  time: [0],
  values: [[0, 1]],
  labels: ["Sample", "v"],
  units: ["", "K"],
  metadata: { x_column_name: "Time", text_columns: { ID: ["a"] } },
  cat_levels: { 0: ["s1"] },
};
const sets = [
  { id: "a", name: "a.dat", data: d },
  { id: "b", name: "b.dat", data: d },
];

describe("transformForm", () => {
  it("offers X, every channel (a categorical one marked as text) and every text column as a join key", () => {
    expect(keyOptions(d)).toEqual([
      { value: "-1", label: "Time (x)" },
      { value: "0", label: "Sample (text levels)" },
      { value: "1", label: "v" },
      { value: "t:ID", label: "ID (text column)" },
    ]);
    expect([parseKey("-1"), parseKey("1"), parseKey("t:ID")]).toEqual([-1, 1, "ID"]);
  });

  it("seeds the primary and join partner from the command's ids, and appends need two picks", () => {
    const f = seedForm("join", ["b", "a"], sets);
    expect([f.primary, f.right, f.appendIds]).toEqual(["b", "a", ["b", "a"]]);
    expect(formToRun({ ...f, leftKey: "t:ID", rightKey: "0" }, sets)).toEqual({
      params: { op: "join", leftKey: "ID", rightKey: 0, mode: "inner", keyMode: "text", with: { id: "a", name: "a.dat" } },
      primaryId: "b",
      otherIds: ["a"],
    });
    expect(formToRun({ ...f, op: "merge", appendIds: ["a"] }, sets)).toBe("Tick at least two datasets to append.");
    expect(formToRun({ ...f, right: "b" }, sets)).toBe("Pick two different datasets to join.");
    // A key that no longer exists (a deleted column / text column) is a form
    // error, never a join on nothing.
    expect(formToRun({ ...f, leftKey: "5" }, sets)).toBe("Pick the left key.");
    expect(formToRun({ ...f, rightKey: "t:Gone" }, sets)).toBe("Pick the right key.");
    expect(formToRun({ ...f, op: "merge", match: "name" }, sets)).toMatchObject({
      params: { op: "merge", match: "name", with: [{ id: "a", name: "a.dat" }] },
      primaryId: "b",
    });
  });
});
