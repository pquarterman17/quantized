// P2.5 keyed join with a TEXT key (lib/worksheetJoin.ts): a categorical
// channel keys by its LEVEL TEXT (never its code — two datasets rarely number
// levels alike), a text sidecar column keys by name, and analyzeJoin counts
// the same keys the join matches on.

import { describe, expect, it } from "vitest";

import { transformParamsOf } from "./transformRun";
import { analyzeJoin } from "./transformWarnings";
import type { DataStruct } from "./types";
import { joinKeyColumn, joinWorksheets, planCarriedText } from "./worksheetJoin";

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
    // Each side's own X is carried as a column: a text key cannot be the X.
    expect(out.labels).toEqual(["Sample", "X", "Tc", "Right: X", "Hc", "Grade"]);
    // 1-based, like every other Row axis in the app (finding 9).
    expect(out.time).toEqual([1, 2]);
    expect(out.cat_levels?.[0]).toEqual(["A", "B"]);
    // A: left row 0 (x 0, Tc 1.5) / right row 2 (x 2, Hc 9, Grade code 1 =
    // "hi"); B: left row 1 / right row 0.
    expect(out.values).toEqual([[0, 0, 1.5, 2, 9, 1], [1, 1, 2.5, 0, 7, 1]]);
    // The right side's own level table travels with its column.
    expect(out.cat_levels?.[5]).toEqual(["lo", "hi"]);
    expect(out.metadata).toMatchObject({ worksheet_transform: "join", join_key: "text", x_column_name: "Row" });
  });

  it("a full join keeps right-only keys after the left ones, blank on the left", () => {
    const out = joinWorksheets(left, right, 0, 0, "full");
    expect(out.cat_levels?.[0]).toEqual(["A", "B", "C"]);
    expect(out.values[2][0]).toBe(2);
    expect(out.values[2][2]).toBeNaN(); // no left Tc for C
    expect(out.values[2][4]).toBe(8);
  });

  it("keys on a text sidecar column by name", () => {
    const withText: DataStruct = {
      time: [0, 1, 2],
      values: [[1], [2], [3]],
      labels: ["v"],
      units: [""],
      metadata: { text_columns: { ID: ["s1", "s2", "  "] } },
    };
    // "s1 " (a spreadsheet export's trailing space) is still s1.
    const other: DataStruct = { ...withText, values: [[10], [20], [30]], labels: ["w"], metadata: { text_columns: { ID: ["s2", "s9", "s1 "] } } };
    expect(joinKeyColumn(withText, "ID")).toEqual({ kind: "text", keys: ["s1", "s2", null] });
    const out = joinWorksheets(withText, other, "ID", "ID", "inner");
    expect(out.labels).toEqual(["ID", "X", "v", "Right: X", "w"]);
    expect(out.cat_levels?.[0]).toEqual(["s1", "s2"]);
    expect(out.values).toEqual([[0, 0, 1, 2, 30], [1, 1, 2, 0, 10]]);
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

  it("a numeric join keeps a categorical channel's level table (it used to drop it)", () => {
    const l: DataStruct = { time: [1, 2], values: [[0], [1]], labels: ["grade"], units: [""], metadata: {}, cat_levels: { 0: ["lo", "hi"] }, level_order: { 0: [1, 0] } };
    const r: DataStruct = { time: [1, 2], values: [[5], [6]], labels: ["b"], units: [""], metadata: {} };
    const out = joinWorksheets(l, r, -1, -1, "inner");
    expect(out.cat_levels).toEqual({ 0: ["lo", "hi"] });
    expect(out.level_order).toEqual({ 0: [1, 0] });
  });

  it("a recorded join step may name a text column as its key", () => {
    const p = transformParamsOf({ op: "join", leftKey: "ID", rightKey: 0, mode: "left", with: { id: "R", name: "r" } });
    expect(p).toEqual({ op: "join", leftKey: "ID", rightKey: 0, mode: "left", with: { id: "R", name: "r" } });
    expect(() => transformParamsOf({ op: "join", leftKey: 1.5, rightKey: 0, with: { id: "R" } })).toThrow(/integer "leftKey"/);
  });

  // Review finding 2: `keyMode` only changes how a CATEGORICAL channel keys —
  // "code" (the pre-P2.5 default every unversioned recorded step replays
  // with) reads its raw numeric code; "text" (this function's own default,
  // matching every direct call above) reads its level string instead. The
  // two datasets below number "lo"/"hi" in opposite order, so the two modes
  // genuinely pair up different rows.
  it("keyMode 'code' joins a categorical channel by its raw code, not its level text", () => {
    const l: DataStruct = { time: [10, 20], values: [[0, 100], [1, 200]], labels: ["grade", "v"], units: ["", ""], metadata: {}, cat_levels: { 0: ["lo", "hi"] } };
    const r: DataStruct = { time: [1, 2], values: [[0, 7], [1, 8]], labels: ["grade", "w"], units: ["", ""], metadata: {}, cat_levels: { 0: ["hi", "lo"] } };
    const byText = joinWorksheets(l, r, 0, 0, "inner"); // default: "text"
    expect(byText.labels).toEqual(["grade", "X", "v", "Right: X", "w"]);
    expect(byText.values).toEqual([[0, 10, 100, 2, 8], [1, 20, 200, 1, 7]]);
    const byCode = joinWorksheets(l, r, 0, 0, "inner", "code");
    expect(byCode.labels).toEqual(["v", "w"]); // no key channel at all under "code" — a plain numeric join
    expect(byCode.values).toEqual([[100, 7], [200, 8]]);
  });

  it("keyMode 'code' never refuses a text-vs-numeric pairing (that distinction didn't exist yet)", () => {
    expect(() => joinWorksheets(left, right, 0, 1, "inner", "code")).not.toThrow();
  });
});

describe("join — carried non-key text columns (finding 1)", () => {
  const l: DataStruct = {
    time: [0, 1, 2],
    values: [[0], [1], [2]],
    labels: ["k"],
    units: [""],
    metadata: { text_columns: { Notes: ["ln0", "ln1", "ln2"], Batch: ["B1", "B2", "B3"] } },
  };
  const r: DataStruct = {
    time: [0, 1],
    values: [[0], [1]],
    labels: ["k"],
    units: [""],
    metadata: { text_columns: { Notes: ["rn0", "rn1"] } },
  };

  it("carries every non-key text column, row-aligned, L/R-suffixed on a name clash", () => {
    const out = joinWorksheets(l, r, 0, 0, "left");
    expect(out.time).toEqual([0, 1, 2]); // every left key kept — right's k=2 is missing
    expect(out.metadata.text_columns).toEqual({
      Notes: ["ln0", "ln1", "ln2"],
      Batch: ["B1", "B2", "B3"],
      // Right's OWN "Notes" collides with left's — suffixed like a numeric
      // channel would be; blank ("") for the row right has no match for.
      "Right: Notes": ["rn0", "rn1", ""],
    });
  });

  it("a text-key join carries non-key columns too (not just a numeric key)", () => {
    const withKey: DataStruct = { ...l, metadata: { text_columns: { Notes: ["ln0", "ln1", "ln2"], Batch: ["B1", "B2", "B3"], ID: ["a", "b", "c"] } } };
    const rWithKey: DataStruct = { ...r, metadata: { text_columns: { Notes: ["rn0", "rn1"], ID: ["a", "b"] } } };
    const out = joinWorksheets(withKey, rWithKey, "ID", "ID", "left");
    // "ID" itself is excluded from carrying (it's already the join's key
    // channel); Notes/Batch are carried exactly as in the numeric-key case.
    expect(out.metadata.text_columns).toEqual({ Notes: ["ln0", "ln1", "ln2"], Batch: ["B1", "B2", "B3"], "Right: Notes": ["rn0", "rn1", ""] });
  });

  it("planCarriedText drops a column whose suffixed name still collides, and analyzeJoin names it", () => {
    const rClash: DataStruct = { ...r, metadata: { text_columns: { Notes: ["x", "y"], "Right: Notes": ["p", "q"] } } };
    const plan = planCarriedText(l, rClash, 0, 0);
    // Origin short-name order (length-then-lex): "Batch" before "Notes".
    expect(plan.kept.map((c) => c.name)).toEqual(["Batch", "Notes", "Right: Notes"]);
    expect(plan.dropped).toEqual([{ name: "Right: Notes", side: "right", shortName: "Right: Notes", col: { shortName: "Right: Notes", rows: ["p", "q"] } }]);
    const w = analyzeJoin(l, rClash, 0, 0, "left", "l.dat", "r.dat");
    const dropped = w.find((x) => x.code === "text-column-dropped");
    expect(dropped?.text).toBe('r.dat: its text column "Right: Notes" could not be carried into the result — the name "Right: Notes" is already used by another carried column.');
  });
});

describe("join — a text-sidecar key shorter than the dataset's rows (finding 3)", () => {
  it("treats a missing sidecar cell as a blank key, COUNTED, rather than silently uncounted", () => {
    const ds: DataStruct = {
      time: [0, 1, 2, 3],
      values: [[1], [2], [3], [4]],
      labels: ["v"],
      units: [""],
      // Only 2 of 4 rows have an ID cell — rows 2 and 3 must not just vanish
      // from `joinKeyColumn`'s own output (one key per DATA row, not per
      // sidecar cell).
      metadata: { text_columns: { ID: ["s1", "s2"] } },
    };
    expect(joinKeyColumn(ds, "ID")).toEqual({ kind: "text", keys: ["s1", "s2", null, null] });
    const other: DataStruct = { time: [0], values: [[10]], labels: ["w"], units: [""], metadata: { text_columns: { ID: ["s1"] } } };
    // The join itself is unaffected here (a blank key never matches either
    // way) — what changes is the WARNING: rows 2/3 are now counted rather
    // than silently missing from both the match and the count.
    const out = joinWorksheets(ds, other, "ID", "ID", "left");
    expect(out.time).toEqual([1, 2]); // s1 (matched) and s2 (left-only)
    const w = analyzeJoin(ds, other, "ID", "ID", "left", "ds.dat", "other.dat");
    expect(w.find((x) => x.code === "blank-keys")).toMatchObject({
      count: 2,
      text: 'ds.dat: 2 rows with a blank "ID" cannot match anything and are dropped.',
    });
  });
});

describe("join — bounded output for a live preview (finding 5)", () => {
  const l: DataStruct = { time: [0, 1, 2, 3, 4], values: [[10], [11], [12], [13], [14]], labels: ["a"], units: [""], metadata: {} };
  const r: DataStruct = { time: [0, 1, 2, 3, 4], values: [[20], [21], [22], [23], [24]], labels: ["b"], units: [""], metadata: {} };

  it("caps the materialized rows and records the true count, without changing which keys match", () => {
    const full = joinWorksheets(l, r, -1, -1, "inner");
    expect(full.time).toEqual([0, 1, 2, 3, 4]);
    expect(full.metadata).not.toHaveProperty("preview_truncated_from");

    const capped = joinWorksheets(l, r, -1, -1, "inner", "text", 3);
    expect(capped.time).toEqual([0, 1, 2]); // the first 3 of the 5 real matches
    expect(capped.values).toEqual(full.values.slice(0, 3));
    expect(capped.metadata.preview_truncated_from).toBe(5);
  });

  it("a limit at or above the real row count changes nothing — an exact preview stays exact", () => {
    const exact = joinWorksheets(l, r, -1, -1, "inner", "text", 5);
    const full = joinWorksheets(l, r, -1, -1, "inner");
    expect(exact).toEqual(full);
    expect(exact.metadata).not.toHaveProperty("preview_truncated_from");
  });
});
