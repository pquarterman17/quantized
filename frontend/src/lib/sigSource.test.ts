// Where the p-values come from, and the refusal when the source's groups are not the plot's.

import { describe, expect, it } from "vitest";

import type { PosthocResult } from "./api/statsTestsMore";
import { DEFAULT_SIG_LEVELS, type SigMarks } from "./sigMarks";
import { matchPairs, pairsFromResult, pairsFromSheet, sigOutcome } from "./sigSource";
import { statisticalTestAnalysisResult } from "./statisticalTestAnalysisResult";
import { DEFAULT_PARAMS, DEFAULT_SELECTION } from "./statsTests";
import { describeResult } from "./statsTestsResults";
import type { Dataset } from "./types";

const LABELS = ["grp = A", "grp = B", "grp = C"];
const GROUPS = LABELS.map((label) => ({ label, values: [1, 2, 3] }));
const pair = (i: number, j: number, p: number) => ({ i, j, diff: 1, p, ciLow: null, ciHigh: null, significant: p < 0.05, effect_size: null });

/** A post-hoc result the way the workshop saves it: describeResult -> the envelope. */
function posthoc(key: PosthocResult["key"] = "games-howell", labels = LABELS) {
  const data: PosthocResult = {
    pairs: [pair(0, 1, 0.0004), pair(0, 2, 0.03), pair(1, 2, 0.2)], n_groups: 3, alpha: 0.05, method: key, key,
    omnibus_p: 0.01, adjusted: key !== "lsd", groups: [],
  };
  const output = describeResult({ id: "posthoc", data }, labels, 0.05);
  const params = { ...DEFAULT_PARAMS, more: { ...DEFAULT_PARAMS.more, posthoc: key } };
  return statisticalTestAnalysisResult("r1", null, "posthoc", DEFAULT_SELECTION, params, labels, output);
}

const sig = (source: SigMarks["source"], over: Partial<SigMarks> = {}): SigMarks =>
  ({ source, levels: DEFAULT_SIG_LEVELS.map((l) => ({ ...l })), showP: false, showNs: false, ...over });
const state = (results = [posthoc()], datasets: Dataset[] = []) => ({ results, datasets });

describe("a post-hoc statistics result", () => {
  it("is read back as named pairs with their p-values", () => {
    expect(pairsFromResult(posthoc())).toEqual({ method: "games-howell", pairs: [
      { a: "grp = A", b: "grp = B", p: 0.0004, where: "table row 1" },
      { a: "grp = A", b: "grp = C", p: 0.03, where: "table row 2" },
      { a: "grp = B", b: "grp = C", p: 0.2, where: "table row 3" },
    ] });
  });

  it("reads group names that themselves contain the minus separator", () => {
    const names = ["x − y", "z", "w"];
    expect(pairsFromResult(posthoc("tukey", names))).toMatchObject({
      pairs: [{ a: "x − y", b: "z" }, { a: "x − y", b: "w" }, { a: "z", b: "w" }],
    });
  });

  it("reads the rank-based tables' p columns too", () => {
    for (const key of ["dunn-sidak", "steel-dwass"] as const) {
      expect(pairsFromResult(posthoc(key))).toMatchObject({ pairs: [{ p: 0.0004 }, { p: 0.03 }, { p: 0.2 }] });
    }
  });

  it("refuses a result that is not a post-hoc table", () => {
    const r = { ...posthoc(), parameters: { testId: "dunnett", labels: LABELS } };
    expect(pairsFromResult(r)).toEqual({ error: expect.stringContaining("not a post-hoc comparison result") });
  });
});

describe("matching the plot's groups", () => {
  const named = (pairsFromResult(posthoc()) as { pairs: Parameters<typeof matchPairs>[0] }).pairs;

  it("maps names to the plot's group indices", () => {
    expect(matchPairs(named, LABELS)).toEqual([{ a: 0, b: 1, p: 0.0004 }, { a: 0, b: 2, p: 0.03 }, { a: 1, b: 2, p: 0.2 }]);
  });

  it("accepts the bare level name when it is unambiguous", () => {
    const bare = named.map((q) => ({ ...q, a: q.a.slice(6), b: q.b.slice(6) }));
    expect(matchPairs(bare, LABELS)).toHaveLength(3);
  });

  it("refuses, naming the source groups the plot lacks and the plot groups the source lacks", () => {
    const out = matchPairs(named, ["grp = A", "grp = B", "grp = D"]);
    expect(out).toEqual({ error: expect.stringContaining('names "grp = C", which the plot does not have') });
    expect(out).toEqual({ error: expect.stringContaining("no p-values for the plot's \"grp = D\"") });
    expect(matchPairs(named.slice(0, 1), LABELS)).toEqual({ error: expect.stringContaining('"grp = C"') });
  });

  it("refuses two different p-values for one pair, and a group paired with itself", () => {
    const twice = [...named, { a: "grp = B", b: "grp = A", p: 0.5, where: "row 9" }];
    expect(matchPairs(twice, LABELS)).toEqual({ error: expect.stringContaining("two different p-values") });
    expect(matchPairs([{ a: "grp = A", b: "grp = A", p: 0.1, where: "row 1" }], LABELS)).toEqual({ error: expect.stringContaining("itself") });
  });
});

const SHEET: Dataset = {
  id: "s", name: "pairs",
  data: {
    time: [0, 1, 2], labels: ["A", "B", "p"], units: ["", "", ""], metadata: {},
    values: [[0, 0, 0.0004], [0, 1, 0.03], [1, 1, 0.2]],
    // the codes index each column's own level list: A/B/C are named by columns 0 and 1
    cat_levels: { 0: ["A", "B"], 1: ["B", "C"] },
  },
};

describe("a worksheet source", () => {
  it("reads group A, group B and p per source row", () => {
    expect(pairsFromSheet(SHEET, 0, 1, 2)).toEqual([
      { a: "A", b: "B", p: 0.0004, where: "row 1" }, { a: "A", b: "C", p: 0.03, where: "row 2" }, { a: "B", b: "C", p: 0.2, where: "row 3" },
    ]);
  });

  it("skips excluded rows and names later rows by their source row number", () => {
    const excluded: Dataset = { ...SHEET, excludedRows: [0] };
    expect(pairsFromSheet(excluded, 0, 1, 2)).toEqual([
      { a: "A", b: "C", p: 0.03, where: "row 2" }, { a: "B", b: "C", p: 0.2, where: "row 3" },
    ]);
    const bad: Dataset = { ...SHEET, excludedRows: [0], data: { ...SHEET.data, values: [[0, 0, 0.1], [0, 1, 0.2], [1, 1, 1.5]] } };
    expect(pairsFromSheet(bad, 0, 1, 2)).toEqual({ error: "Row 3: the p-value must be a number from 0 to 1" });
  });

  it("refuses unusable columns and values, by source row", () => {
    expect(pairsFromSheet(SHEET, 0, 0, 2)).toEqual({ error: expect.stringContaining("three different columns") });
    expect(pairsFromSheet(SHEET, 2, 1, 0)).toEqual({ error: expect.stringContaining("must be a text column") });
    const bad: Dataset = { ...SHEET, data: { ...SHEET.data, values: [[0, 0, 0.1], [0, 1, 1.5]] } };
    expect(pairsFromSheet(bad, 0, 1, 2)).toEqual({ error: "Row 2: the p-value must be a number from 0 to 1" });
    expect(pairsFromSheet({ ...SHEET, pending: { kind: "x" } as never }, 0, 1, 2)).toEqual({ error: expect.stringContaining("not fully loaded") });
  });
});

describe("a worksheet whose group B is a sidecar text column", () => {
  // only column A is categorical (the CSV importer's rule); B and the row labels stay text
  const CSV: Dataset = {
    id: "c", name: "pairs.csv",
    data: {
      time: [0, 1, 2, 3], labels: ["A", "p"], units: ["", ""], cat_levels: { 0: ["A", "B"] },
      values: [[0, 0.0004], [0, 0.03], [1, 0.2], [1, 0.5]],
      metadata: { text_columns: { B: ["B", "C", "C", " "], note: ["x", "y", "z", "w"] } },
    },
  };

  it("reads a text column as group names, by source row, through the row state", () => {
    expect(pairsFromSheet(CSV, 0, -2, 1)).toEqual({ error: "Row 4: group A or B is empty" });
    const kept: Dataset = { ...CSV, excludedRows: [3] };
    expect(pairsFromSheet(kept, 0, -2, 1)).toEqual([
      { a: "A", b: "B", p: 0.0004, where: "row 1" }, { a: "A", b: "C", p: 0.03, where: "row 2" }, { a: "B", b: "C", p: 0.2, where: "row 3" },
    ]);
    const skipped: Dataset = { ...CSV, excludedRows: [0, 3] };
    expect(pairsFromSheet(skipped, 0, -2, 1)).toEqual([
      { a: "A", b: "C", p: 0.03, where: "row 2" }, { a: "B", b: "C", p: 0.2, where: "row 3" },
    ]);
  });

  it("accepts a text column for group A as well, and refuses a stale or misaligned one", () => {
    expect(pairsFromSheet({ ...CSV, excludedRows: [3] }, -3, -2, 1)).toMatchObject([{ a: "x", b: "B", p: 0.0004 }, { a: "y", b: "C" }, { a: "z", b: "C" }]);
    expect(pairsFromSheet(CSV, 0, -9, 1)).toEqual({ error: expect.stringContaining("no longer exists") });
    const short: Dataset = { ...CSV, data: { ...CSV.data, metadata: { text_columns: { B: ["B"] } } } };
    expect(pairsFromSheet(short, 0, -2, 1)).toEqual({ error: expect.stringContaining("does not line up") });
  });
});

describe("the whole path", () => {
  it("builds the layout input from a result, with a note that names the source", () => {
    const out = sigOutcome(sig({ kind: "result", resultId: "r1" }), GROUPS, state());
    expect(out).toMatchObject({ method: "given", display: "brackets", pairs: [{ a: 0, b: 1 }, { a: 0, b: 2 }, { a: 1, b: 2 }] });
    expect((out as { note: string }).note).toContain("games-howell");
    expect((out as { label: (p: number) => string | null }).label(0.0004)).toBe("***");
  });

  it("notes that Fisher LSD is not adjusted", () => {
    const out = sigOutcome(sig({ kind: "result", resultId: "r1" }), GROUPS, state([posthoc("lsd")]));
    expect((out as { note: string }).note).toContain("lsd, not adjusted");
  });

  it("builds from a worksheet", () => {
    const out = sigOutcome(sig({ kind: "sheet", datasetId: "s", a: 0, b: 1, p: 2 }), GROUPS, state([], [SHEET]));
    expect(out).toMatchObject({ pairs: [{ a: 0, b: 1, p: 0.0004 }, { a: 0, b: 2, p: 0.03 }, { a: 1, b: 2, p: 0.2 }] });
  });

  it("says what to pick while the source is incomplete, and when it vanished", () => {
    expect(sigOutcome(sig({ kind: "result", resultId: "" }), GROUPS, state())).toEqual({ error: expect.stringContaining("Pick a post-hoc") });
    expect(sigOutcome(sig({ kind: "result", resultId: "gone" }), GROUPS, state())).toEqual({ error: expect.stringContaining("no longer exists") });
    expect(sigOutcome(sig({ kind: "sheet", datasetId: "s", a: 0, b: -1, p: 2 }), GROUPS, state([], [SHEET]))).toEqual({ error: expect.stringContaining("Pick the worksheet") });
  });

  it("refuses a source that was run on other groups", () => {
    const other = GROUPS.map((g, i) => ({ ...g, label: `grp = ${"XYZ"[i]}` }));
    const out = sigOutcome(sig({ kind: "result", resultId: "r1" }), other, state());
    expect(out).toEqual({ error: expect.stringContaining('names "grp = A", "grp = B", "grp = C"') });
    expect(out).toEqual({ error: expect.stringContaining('"grp = X", "grp = Y", "grp = Z"') });
  });
});
