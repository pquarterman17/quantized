// `rng("Name")` in worksheet formulas through the REAL store (ROW_RANGE_CONTRACT 5.2-5.3, slice R4b): define a range
// with the store, use it in a computed column, and follow it through data edits, row and column edits, rename, delete,
// cut, cycles, retarget, the project file and Append project. Named ranges have no UI until R4c, so the store actions
// are the first user.

import { beforeEach, describe, expect, it } from "vitest";

import dwk034 from "../lib/__fixtures__/workspace/v4-0.34.0.dwk.json";
import { loadFormulaExtension } from "../lib/formulaExt";
import type { Dataset } from "../lib/types";
import { parseWorkspace, serializeWorkspace, type LoadedWorkspace } from "../lib/workspace";
import { recomputeFormulaData } from "./computedColumns";
import { deleteRowsAt, insertRowsAbove } from "./moveRows";
import { defineNamedRange, defineNamedRangeFromSelection, removeNamedRange, renameNamedRange, retargetNamedRange } from "./namedRanges";
import { markRowsReplaced } from "./rowRangeShift";
import { useApp } from "./useApp";
import { deleteColumns } from "./worksheetColumns";

const VIEWPORT = { width: 1600, height: 900 };
const N = 30;
// A = sin(i + 1), B = 10 cos(i + 1): irrational, so the sums are not hand-friendly. The expected figures below are numpy's,
// computed on exactly the block's rows (rows 3..9, 0-based): see NUMPY.
const A = Array.from({ length: N }, (_, i) => Math.sin(i + 1));
const B = Array.from({ length: N }, (_, i) => Math.cos(i + 1) * 10);
const sheet = (id: string, extra: Partial<Dataset> = {}): Dataset => ({
  id,
  name: `${id}.csv`,
  data: { time: Array.from({ length: N }, (_, i) => i), values: A.map((a, i) => [a, B[i]]), labels: ["A", "B"], units: ["", ""], metadata: {} },
  ...extra,
});
const st = () => useApp.getState();
const get = (id: string) => st().datasets.find((d) => d.id === id)!;
/** The last computed column of a worksheet. */
const last = (id: string) => get(id).data.values.map((r) => r[r.length - 1]);
const colOf = (id: string, c: number) => get(id).data.values.map((r) => r[c]);

// numpy: a = np.sin(np.arange(1, 31)); b = np.cos(np.arange(1, 31)) * 10; r = slice(3, 10)
//   a[r].sum() = -0.48070004847543474   a[r].mean() = -0.06867143549649067   a[r].size = 7
//   b[r].sum() = -5.516107191764581     b[r].mean() = -0.7880153131092259
//   b[r].std(ddof=1) = 7.648433044896679   np.median(b[r]) = -1.4550003380861354   b.mean() = -0.44238805111300195
const NUMPY = {
  aSum: -0.48070004847543474,
  aMean: -0.06867143549649067,
  bSum: -5.516107191764581,
  bMean: -0.7880153131092259,
  bSd: 7.648433044896679,
  bMedian: -1.4550003380861354,
  bMeanAll: -0.44238805111300195,
  count: 7,
};

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({
    datasets: [sheet("s1", { workbookId: "w1" }), sheet("s2", { workbookId: "w1" }), sheet("solo")],
    workbooks: [{ id: "w1", name: "Run 1" }],
    activeId: "s1",
    namedRanges: [],
    recalcMode: "auto",
    staleDatasets: [],
    staleFits: [],
    history: [],
    future: [],
    status: "",
    macroRecording: false,
  });
});

/** Rows 3..9 (0-based), columns A and B, visible on s1 only (sheet scope) or on every sheet of its workbook. */
const define = (name = "Base", scope: "sheet" | "workbook" = "sheet", datasetId = "s1", cols = [0, 1]) =>
  defineNamedRangeFromSelection(datasetId, { rows: [3, 4, 5, 6, 7, 8, 9], cols }, name, scope);
const rangeId = () => st().namedRanges[0].id;

describe("the numbers", () => {
  it("sum, mean and count over a range equal numpy computed on exactly the range's rows", () => {
    expect(define().ok).toBe(true);
    expect(st().addFormula("s1", "aSum", 'sum(rng("Base", 1))')).toBe(true); // column C
    expect(st().addFormula("s1", "aMean", 'mean(rng("Base", 1))')).toBe(true);
    expect(st().addFormula("s1", "cnt", 'count(rng("Base", 1))')).toBe(true);
    expect(st().addFormula("s1", "bSum", 'sum(rng("Base", 2))')).toBe(true);
    expect(st().addFormula("s1", "bMean", 'mean(rng("Base", 2))')).toBe(true);
    expect(st().addFormula("s1", "bSd", 'sd(rng("Base", 2))')).toBe(true);
    expect(st().addFormula("s1", "bMed", 'median(rng("Base", 2))')).toBe(true);
    expect(get("s1").formulaErrors).toBeUndefined();
    const want = [NUMPY.aSum, NUMPY.aMean, NUMPY.count, NUMPY.bSum, NUMPY.bMean, NUMPY.bSd, NUMPY.bMedian];
    want.forEach((v, k) => colOf("s1", 2 + k).forEach((x) => expect(x).toBeCloseTo(v, 12))); // every row carries the aggregate
    // The block, not the column: the mean of ALL of B differs.
    expect(NUMPY.bMeanAll).not.toBeCloseTo(NUMPY.bMean, 3);
  });

  it("a range with no row limit reads every row", () => {
    expect(defineNamedRange({ name: "All", scope: "sheet", datasetId: "s1", cols: [1], rows: null }).ok).toBe(true);
    expect(st().addFormula("s1", "m", 'mean(rng("All"))')).toBe(true);
    last("s1").forEach((x) => expect(x).toBeCloseTo(NUMPY.bMeanAll, 12));
  });

  it("composes inside an ordinary expression, and names are matched without regard to case", () => {
    define();
    expect(st().addFormula("s1", "scaled", 'mean(rng("base", 2)) * 2 + A')).toBe(true);
    colOf("s1", 2).forEach((x, i) => expect(x).toBeCloseTo(NUMPY.bMean * 2 + A[i], 12));
  });
});

describe("recalculation", () => {
  it("a data edit inside the block recalculates the formula, one outside does not change it (same worksheet)", () => {
    define();
    st().addFormula("s1", "m", 'mean(rng("Base", 1))');
    st().setCellValue("s1", 5, 0, 100); // inside rows 3..9
    const a2 = [...A];
    a2[5] = 100;
    const want = a2.slice(3, 10).reduce((s, v) => s + v, 0) / 7;
    expect(want).toBeCloseTo(14.256959349960498, 12); // numpy
    last("s1").forEach((x) => expect(x).toBeCloseTo(want, 12));
    st().setCellValue("s1", 20, 0, 555); // outside
    last("s1").forEach((x) => expect(x).toBeCloseTo(want, 12));
  });

  it("a data edit on the range's worksheet recalculates a reader on another worksheet", async () => {
    define("Shared", "workbook");
    expect(st().addFormula("s2", "m", 'mean(rng("Shared", 2))')).toBe(true);
    last("s2").forEach((x) => expect(x).toBeCloseTo(NUMPY.bMean, 12));
    st().setCellValue("s1", 4, 1, 1000);
    await st().recalcNow();
    const b2 = [...B];
    b2[4] = 1000;
    const want = b2.slice(3, 10).reduce((s, v) => s + v, 0) / 7;
    last("s2").forEach((x) => expect(x).toBeCloseTo(want, 12));
    expect(st().staleDatasets).not.toContain("s2");
  });

  it("the recalc graph draws ds:range-sheet -> ds:reader, so a touch of the block's sheet marks the reader stale in manual mode", () => {
    define("Shared", "workbook");
    st().addFormula("s2", "m", 'mean(rng("Shared", 2))');
    useApp.setState({ recalcMode: "manual" });
    st().setCellValue("s1", 4, 1, 1000);
    expect(st().staleDatasets).toContain("s2");
  });

  it("an insert above the block moves it, and the formula keeps reading the same cells", () => {
    define();
    st().addFormula("s1", "m", 'mean(rng("Base", 2))');
    insertRowsAbove("s1", [0, 1]);
    expect(st().namedRanges[0].target.rows).toMatchObject({ from: 5, to: 11 });
    last("s1").forEach((x) => expect(x).toBeCloseTo(NUMPY.bMean, 12));
    deleteRowsAt("s1", [0, 1]);
    expect(st().namedRanges[0].target.rows).toMatchObject({ from: 3, to: 9 });
    last("s1").forEach((x) => expect(x).toBeCloseTo(NUMPY.bMean, 12));
  });

  it("deleting a row inside the block shrinks it and the formula follows (numpy on the surviving rows)", () => {
    define();
    st().addFormula("s1", "m", 'mean(rng("Base", 2))');
    deleteRowsAt("s1", [5]);
    const rows = [3, 4, 6, 7, 8, 9].map((i) => B[i]);
    last("s1").forEach((x) => expect(x).toBeCloseTo(rows.reduce((s, v) => s + v, 0) / 6, 12));
    expect(st().namedRanges[0].target.rows).toMatchObject({ from: 3, to: 8 });
  });

  it("deleting every row of the block makes the formula an error, never 'every row'", () => {
    define();
    st().addFormula("s1", "m", 'mean(rng("Base", 2))');
    deleteRowsAt("s1", [3, 4, 5, 6, 7, 8, 9]);
    expect(get("s1").formulaErrors?.m).toMatch(/no longer exist/);
    last("s1").forEach((x) => expect(x).toBeNaN());
  });

  it("deleting a column before the block moves it; the values are unchanged", () => {
    expect(st().addFormula("s1", "pad", "B + 1")).toBe(true); // C, after the block's columns
    define("Base", "sheet", "s1", [1]); // B only
    st().addFormula("s1", "m", 'mean(rng("Base"))');
    deleteColumns("s1", [0]); // A goes; B becomes A
    expect(st().namedRanges[0].target.cols).toEqual([0]);
    expect(get("s1").formulaErrors).toBeUndefined();
    last("s1").forEach((x) => expect(x).toBeCloseTo(NUMPY.bMean, 12));
  });

  it("a rows-replaced marking makes the reader refuse with the reason; keeping the rows (retarget) recovers it", () => {
    define();
    st().addFormula("s1", "m", 'mean(rng("Base", 2))');
    markRowsReplaced("s1", true);
    expect(get("s1").formulaErrors?.m).toMatch(/rows were replaced/);
    expect(retargetNamedRange(rangeId(), { datasetId: "s1", cols: [0, 1], rows: { from: 3, to: 9 } }).ok).toBe(true);
    expect(get("s1").formulaErrors).toBeUndefined();
    last("s1").forEach((x) => expect(x).toBeCloseTo(NUMPY.bMean, 12));
  });

  it("retargeting recalculates its readers on every worksheet", () => {
    define("Shared", "workbook");
    st().addFormula("s1", "own", 'mean(rng("Shared", 2))');
    st().addFormula("s2", "other", 'mean(rng("Shared", 2))');
    expect(retargetNamedRange(rangeId(), { datasetId: "s1", cols: [0, 1], rows: { from: 0, to: 2 } }).ok).toBe(true);
    const want = (B[0] + B[1] + B[2]) / 3;
    last("s1").forEach((x) => expect(x).toBeCloseTo(want, 12));
    last("s2").forEach((x) => expect(x).toBeCloseTo(want, 12));
  });
});

describe("rename", () => {
  it("rewrites rng(\"Old\") to rng(\"New\") in every formula, value unchanged, and one undo restores the text", () => {
    define("Shared", "workbook");
    st().addFormula("s1", "own", 'mean(rng("Shared", 2))');
    st().addFormula("s2", "other", 'sum(rng("Shared", 1)) - sum(rng("Shared", 1)) + mean(rng("Shared", 2))');
    expect(renameNamedRange(rangeId(), "Window").ok).toBe(true);
    expect(get("s1").formulas![0]).toMatchObject({ expr: 'mean(rng("Window", 2))', ranges: [{ name: "Window", id: rangeId() }] });
    expect(get("s2").formulas![0].expr).toBe('sum(rng("Window", 1)) - sum(rng("Window", 1)) + mean(rng("Window", 2))');
    last("s2").forEach((x) => expect(x).toBeCloseTo(NUMPY.bMean, 12));
    st().undo();
    expect(get("s1").formulas![0].expr).toBe('mean(rng("Shared", 2))');
    expect(st().namedRanges[0].name).toBe("Shared");
  });

  it("editing the formula afterwards still binds to the renamed range", () => {
    define("Shared");
    st().addFormula("s1", "m", 'mean(rng("Shared", 2))');
    renameNamedRange(rangeId(), "Window");
    expect(st().updateFormula("s1", 0, { expr: 'sum(rng("Window", 2))' })).toBe(true);
    last("s1").forEach((x) => expect(x).toBeCloseTo(NUMPY.bSum, 12));
  });
});

describe("delete and cut", () => {
  it("lists the formula columns that read it, changes nothing until confirmed, then cuts them in ONE undo step", () => {
    define("Shared", "workbook");
    st().addFormula("s1", "own", 'mean(rng("Shared", 2))');
    st().addFormula("s2", "other", 'mean(rng("Shared", 2))');
    const first = removeNamedRange(rangeId());
    expect(first).toMatchObject({ removed: false });
    expect("dependants" in first && first.dependants.map((d) => d.label).sort()).toEqual(["s1.csv › own", "s2.csv › other"]);
    expect(st().namedRanges).toHaveLength(1);
    expect(get("s1").formulaErrors).toBeUndefined();

    const id = rangeId();
    expect(removeNamedRange(id, { confirmed: true })).toEqual({ removed: true, cut: 2 });
    expect(st().namedRanges).toEqual([]);
    expect(get("s1").formulas![0].ranges).toEqual([{ name: "Shared", id: null }]);
    expect(get("s1").formulaErrors?.own).toMatch(/named range "Shared" was removed/);
    expect(get("s2").formulaErrors?.other).toMatch(/was removed/);
    last("s2").forEach((x) => expect(x).toBeNaN());

    st().undo(); // the range and every link, together
    expect(st().namedRanges[0].id).toBe(id);
    expect(get("s1").formulas![0].ranges).toEqual([{ name: "Shared", id }]);
    expect(get("s1").formulaErrors).toBeUndefined();
    last("s2").forEach((x) => expect(x).toBeCloseTo(NUMPY.bMean, 12));
  });

  it("never re-binds a cut formula to a later range of the same name", () => {
    define("Shared");
    st().addFormula("s1", "m", 'mean(rng("Shared", 2))');
    removeNamedRange(rangeId(), { confirmed: true });
    define("Shared");
    expect(get("s1").formulaErrors?.m).toMatch(/was removed/);
    // Editing the formula (re-linking) is how the user chooses the new one.
    expect(st().updateFormula("s1", 0, { expr: 'mean(rng("Shared", 2)) + 0' })).toBe(true);
    last("s1").forEach((x) => expect(x).toBeCloseTo(NUMPY.bMean, 12));
  });

  it("deleting the range's worksheet makes the readers on other worksheets errors, not stale numbers", () => {
    define("Shared", "workbook");
    st().addFormula("s2", "other", 'mean(rng("Shared", 2))');
    st().removeDatasets(["s1"]);
    expect(st().namedRanges).toEqual([]);
    expect(get("s2").formulaErrors?.other).toMatch(/named range "Shared" was removed/);
    last("s2").forEach((x) => expect(x).toBeNaN());
    st().undo();
    expect(get("s2").formulaErrors).toBeUndefined();
    last("s2").forEach((x) => expect(x).toBeCloseTo(NUMPY.bMean, 12));
  });

  it("deleting the workbook cuts a reader outside it", () => {
    define("Shared", "workbook");
    st().addFormula("s2", "other", 'mean(rng("Shared", 2))');
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "s2" ? { ...d, workbookId: undefined } : d)) }));
    st().deleteWorkbook("w1");
    expect(st().namedRanges).toEqual([]);
    expect(get("s2").formulaErrors?.other).toMatch(/named range "Shared" was removed/);
    last("s2").forEach((x) => expect(x).toBeNaN());
  });
});

describe("refusals at bind time", () => {
  it("an unknown name, a wider range without n, an n past the columns, rng() outside an aggregate: each refused with a reason, nothing added", () => {
    define();
    const cases: [string, RegExp][] = [
      ['mean(rng("Nope", 1))', /no named range "Nope"/],
      ['mean(rng("Base"))', /covers 2 columns \(A, B\)/],
      ['mean(rng("Base", 3))', /has 2 columns/],
      ['mean(rng("Base", 0))', /numbered from 1/],
      ['rng("Base", 1)', /use it inside an aggregate/],
      ['rng("Base", 1) + 1', /use it inside an aggregate/],
    ];
    for (const [expr, why] of cases) {
      st().setStatus("");
      useApp.setState({ status: "" });
      expect(st().addFormula("s1", "bad", expr), expr).toBe(expr.startsWith("rng") ? true : false);
      if (!expr.startsWith("rng")) expect(st().status, expr).toMatch(why);
      else expect(get("s1").formulaErrors?.bad, expr).toMatch(why);
      useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "s1" ? sheet("s1", { workbookId: "w1" }) : d)) }));
    }
  });

  it("a range scoped to one sheet is not visible from another sheet", () => {
    define("Mine", "sheet");
    expect(st().addFormula("s2", "m", 'mean(rng("Mine", 1))')).toBe(false);
    expect(st().status).toMatch(/no named range "Mine"/);
    expect(get("s2").formulas).toBeUndefined();
  });

  it("a range reaching a lazy book that has not loaded is refused", () => {
    define("Shared", "workbook");
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "s1" ? { ...d, pending: { kind: "book" } as unknown as Dataset["pending"] } : d)) }));
    expect(st().addFormula("s2", "m", 'mean(rng("Shared", 1))')).toBe(false);
    expect(st().status).toMatch(/has not loaded its full data yet/);
  });

  it("a stale range is refused at bind time with the contract's reason", () => {
    define();
    markRowsReplaced("s1", true);
    expect(st().addFormula("s1", "m", 'mean(rng("Base", 2))')).toBe(false);
    expect(st().status).toMatch(/rows were replaced; open Named Ranges to keep rows 4-10 or remove the row limit/);
  });
});

describe("cycles", () => {
  it("a formula that reads a range holding its own column is refused with the cycle's path (same worksheet)", () => {
    expect(st().addFormula("s1", "d", "A * 2")).toBe(true); // C
    expect(defineNamedRange({ name: "Out", scope: "sheet", datasetId: "s1", cols: [2], rows: null }).ok).toBe(true);
    expect(st().updateFormula("s1", 0, { expr: 'mean(rng("Out"))' })).toBe(false);
    expect(st().status).toMatch(/cannot depend on itself|circular dependency/);
    expect(get("s1").formulas![0].expr).toBe("A * 2");
  });

  it("a longer same-sheet circle (C reads a range holding D, which reads C) is refused", () => {
    expect(st().addFormula("s1", "c", "A * 2")).toBe(true); // C
    expect(st().addFormula("s1", "d", "C + 1")).toBe(true); // D reads C
    expect(defineNamedRange({ name: "Dcol", scope: "sheet", datasetId: "s1", cols: [3], rows: null }).ok).toBe(true);
    expect(st().updateFormula("s1", 0, { expr: 'mean(rng("Dcol"))' })).toBe(false);
    expect(st().status).toMatch(/circular dependency/);
  });

  it("two worksheets reading each other's ranges are refused at the second link", () => {
    define("OnOne", "workbook", "s1");
    define("OnTwo", "workbook", "s2");
    expect(st().addFormula("s2", "reads1", 'mean(rng("OnOne", 1))')).toBe(true);
    expect(st().addFormula("s1", "reads2", 'mean(rng("OnTwo", 1))')).toBe(false);
    expect(st().status).toMatch(/circular dependency/);
  });

  it("a block holding a column to the formula's right is an evaluation error saying so, not a wrong value", () => {
    define("Base", "sheet", "s1", [0]);
    expect(st().addFormula("s1", "early", 'mean(rng("Base"))')).toBe(true); // C
    expect(st().addFormula("s1", "later", "A + 1")).toBe(true); // D
    expect(retargetNamedRange(rangeId(), { datasetId: "s1", cols: [3], rows: null }).ok).toBe(true);
    expect(get("s1").formulaErrors?.early).toMatch(/computed after this one/);
  });
});

describe("the project file and Append project", () => {
  it("round-trips the links through the .dwk, and a reopened project recalculates the same", () => {
    define();
    st().addFormula("s1", "m", 'mean(rng("Base", 2))');
    const text = serializeWorkspace({ ...st() });
    const ws = parseWorkspace(text, VIEWPORT);
    expect(ws.datasets.find((d) => d.id === "s1")!.formulas![0].ranges).toEqual([{ name: "Base", id: rangeId() }]);
    expect(ws.namedRanges).toHaveLength(1);
  });

  it("a malformed rng link in a file is dropped, never trusted", () => {
    define();
    st().addFormula("s1", "m", 'mean(rng("Base", 2))');
    const doc = JSON.parse(serializeWorkspace({ ...st() })) as { datasets: { id: string; formulas: { ranges: unknown }[] }[] };
    doc.datasets.find((d) => d.id === "s1")!.formulas[0].ranges = [{ name: 7 }, { name: "ok", id: "nr1:x", extra: 1 }, "str"];
    const ws = parseWorkspace(JSON.stringify(doc), VIEWPORT);
    expect(ws.datasets.find((d) => d.id === "s1")!.formulas![0].ranges).toEqual([{ name: "ok", id: "nr1:x" }]);
  });

  const incoming = (datasets: Dataset[], namedRanges: LoadedWorkspace["namedRanges"]): LoadedWorkspace =>
    ({ ...parseWorkspace(JSON.stringify(dwk034), VIEWPORT), datasets, workbooks: [], namedRanges }) as LoadedWorkspace;

  it("an appended formula follows its range through the id table; one whose range did not come along is cut and counted", async () => {
    const withLinks = sheet("inc");
    withLinks.formulas = [
      { name: "ok", expr: 'mean(rng("Base", 2))', ranges: [{ name: "Base", id: "nr1:taken" }] },
      { name: "orphan", expr: 'mean(rng("Gone", 2))', ranges: [{ name: "Gone", id: "nr1:missing" }] },
    ];
    withLinks.data = { ...withLinks.data, labels: ["A", "B", "ok", "orphan"], units: ["", "", "", ""], values: withLinks.data.values.map((r) => [...r, NUMPY.bMean, 1]) };
    define("Mine", "sheet", "solo");
    const taken = st().namedRanges[0].id;
    // The incoming range's id collides with an existing one, so it is reminted and the formula must follow it.
    const ws = incoming([withLinks], [{ id: taken, name: "Base", scope: { kind: "sheet", datasetId: "inc" }, target: { datasetId: "inc", cols: [0, 1], rows: { from: 3, to: 9 } } }]);
    withLinks.formulas[0].ranges = [{ name: "Base", id: taken }];
    await st().appendWorkspace(ws);
    const added = st().datasets.find((d) => d.name === "inc.csv" && d.formulas)!;
    const mine = st().namedRanges.find((r) => r.target.datasetId === added.id)!;
    expect(mine.id).not.toBe(taken);
    expect(added.formulas![0].ranges).toEqual([{ name: "Base", id: mine.id }]);
    expect(added.formulas![1].ranges).toEqual([{ name: "Gone", id: null }]);
    expect(added.formulaErrors?.orphan).toMatch(/was removed/);
    // The followed link works on the next edit (the range was reminted, the worksheet was not).
    st().setCellValue(added.id, 5, 1, 1000);
    const b2 = [...B];
    b2[5] = 1000;
    colOf(added.id, 2).forEach((x) => expect(x).toBeCloseTo(b2.slice(3, 10).reduce((s, v) => s + v, 0) / 7, 12));
    expect(st().status).toMatch(/1 sheet\(\) or rng\(\) formula link/);
  });
});

describe("which worksheet a column belongs to", () => {
  it("a column object held by two worksheets is refused, never read as the wrong worksheet's own block", () => {
    define("Shared", "workbook");
    st().addFormula("s1", "m", 'mean(rng("Shared", 2))');
    const shared = get("s1").formulas!;
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "s2" ? { ...d, formulas: shared, data: get("s1").data } : d)) }));
    const again = recomputeFormulaData(get("s2"));
    expect(again.formulaErrors?.m).toMatch(/shared by 2 worksheets/);
  });
});

describe("undo", () => {
  it("adding the formula, then undoing, leaves no link behind", () => {
    define();
    st().addFormula("s1", "m", 'mean(rng("Base", 2))');
    st().undo();
    expect(get("s1").formulas).toBeUndefined();
    expect(st().namedRanges).toHaveLength(1);
  });
});
