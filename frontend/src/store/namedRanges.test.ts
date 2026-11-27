// Named ranges through the REAL store (ROW_RANGE_CONTRACT section 5, slice R4a): define from a selection, rename,
// retarget, delete with a dependants confirmation, follow column and row edits, go with their worksheet or workbook,
// ride the project file (gated at v9) and Append project, and come back with undo.

import { beforeEach, describe, expect, it } from "vitest";

import dwk034 from "../lib/__fixtures__/workspace/v4-0.34.0.dwk.json";
import { namedRangeIssue, sanitizeNamedRanges, type NamedRange } from "../lib/namedRanges";
import type { Dataset } from "../lib/types";
import { parseWorkspace, serializeWorkspace, WORKSPACE_VERSION_POST_045, type LoadedWorkspace } from "../lib/workspace";
import { featuresV045WouldDrop } from "../lib/workspaceForwardCompat";
import { deleteRowsAt, insertRowsAbove } from "./moveRows";
import {
  defineNamedRange,
  defineNamedRangeFromSelection,
  registerNamedRangeDependants,
  removeNamedRange,
  renameNamedRange,
  retargetNamedRange,
} from "./namedRanges";
import { sortWorksheetRows } from "./sortRows";
import { useApp } from "./useApp";
import { deleteColumns, insertColumn, moveColumn } from "./worksheetColumns";

const VIEWPORT = { width: 1600, height: 900 };
const sheet = (id: string, extra: Partial<Dataset> = {}): Dataset => ({
  id,
  name: `${id}.csv`,
  data: {
    time: Array.from({ length: 30 }, (_, i) => i),
    values: Array.from({ length: 30 }, (_, i) => [30 - i, i * 2, i * 3]),
    labels: ["A", "B", "C"],
    units: ["", "", ""],
    metadata: {},
  },
  ...extra,
});
const st = () => useApp.getState();
const ranges = () => st().namedRanges;
const one = (): NamedRange => ranges()[0];

beforeEach(() => {
  useApp.setState({
    datasets: [sheet("s1", { workbookId: "w1" }), sheet("s2", { workbookId: "w1" }), sheet("solo")],
    workbooks: [{ id: "w1", name: "Run 1" }],
    activeId: "s1",
    namedRanges: [],
    history: [],
    future: [],
    status: "",
  });
});

/** A block of rows 3..9 (0-based), columns A and B. */
const define = (name = "Base", scope: "sheet" | "workbook" = "sheet", datasetId = "s1") =>
  defineNamedRangeFromSelection(datasetId, { rows: [3, 4, 5, 6, 7, 8, 9], cols: [0, 1] }, name, scope);

describe("define", () => {
  it("makes a range from a selection: the columns and the one contiguous block of rows, as ONE undo step", () => {
    expect(define().ok).toBe(true);
    expect(one()).toMatchObject({ name: "Base", scope: { kind: "sheet", datasetId: "s1" }, target: { datasetId: "s1", cols: [0, 1], rows: { from: 3, to: 9 } } });
    expect(one().id).toMatch(/^nr1:/);
    expect(st().status).toMatch(/Base.*s1\.csv A:B rows 4-10/);
    st().undo();
    expect(ranges()).toEqual([]);
    st().redo();
    expect(ranges()).toHaveLength(1);
  });

  it("refuses a selection with gaps, naming them, and changes nothing", () => {
    const r = defineNamedRangeFromSelection("s1", { rows: [1, 2, 5], cols: [0] }, "Gappy");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/gaps \(rows 2-3, 6\)/);
    expect(ranges()).toEqual([]);
    expect(st().history).toHaveLength(0); // no undo step for a refusal
  });

  it("refuses an empty selection, a bad name, a column off the sheet, a block past the end, a duplicate column and a missing sheet", () => {
    expect(defineNamedRangeFromSelection("s1", { rows: [], cols: [0] }, "x").ok).toBe(false);
    for (const name of ["", "   ", 'has"quote', "tab\tname", "x".repeat(65)]) {
      expect(defineNamedRange({ name, scope: "sheet", datasetId: "s1", cols: [0], rows: null }).ok, name).toBe(false);
    }
    expect(defineNamedRange({ name: "a", scope: "sheet", datasetId: "s1", cols: [7], rows: null }).ok).toBe(false);
    expect(defineNamedRange({ name: "a", scope: "sheet", datasetId: "s1", cols: [0], rows: { from: 25, to: 40 } }).ok).toBe(false);
    expect(defineNamedRange({ name: "a", scope: "sheet", datasetId: "s1", cols: [0, 0], rows: null }).ok).toBe(false);
    expect(defineNamedRange({ name: "a", scope: "sheet", datasetId: "gone", cols: [0], rows: null }).ok).toBe(false);
    expect(ranges()).toEqual([]);
  });

  it("X (-1) may be in the block; a workbook scope needs a sheet that is in a workbook", () => {
    expect(defineNamedRange({ name: "T", scope: "sheet", datasetId: "s1", cols: [-1, 0], rows: null }).ok).toBe(true);
    expect(defineNamedRange({ name: "W", scope: "workbook", datasetId: "solo", cols: [0], rows: null }).ok).toBe(false);
    expect(defineNamedRange({ name: "W", scope: "workbook", datasetId: "s1", cols: [0], rows: null }).ok).toBe(true);
    expect(ranges().map((r) => r.scope.kind)).toEqual(["sheet", "workbook"]);
  });

  it("names are unique case-insensitively across a workbook and ALL its sheets, but not between workbooks or standalone sheets", () => {
    expect(define("Base", "workbook", "s1").ok).toBe(true);
    expect(define("base", "sheet", "s2").ok).toBe(false); // another sheet of the same workbook: no shadowing
    expect(define("BASE", "workbook", "s2").ok).toBe(false);
    expect(define("Base", "sheet", "solo").ok).toBe(true); // a sheet in no workbook is its own group
    expect(define("Base", "sheet", "solo").ok).toBe(false);
    expect(ranges()).toHaveLength(2);
  });
});

describe("rename and retarget", () => {
  it("rename keeps the id; a taken name (any case) is refused; one undo", () => {
    define("Base", "workbook", "s1");
    define("Other", "workbook", "s2");
    const id = one().id;
    expect(renameNamedRange(id, "Baseline").ok).toBe(true);
    expect(one()).toMatchObject({ id, name: "Baseline" });
    expect(renameNamedRange(id, "OTHER").ok).toBe(false);
    expect(one().name).toBe("Baseline");
    st().undo();
    expect(one().name).toBe("Base");
  });

  it("retarget moves the block, a sheet-scoped name follows its sheet, and keeping the rows clears stale", () => {
    define();
    const id = one().id;
    useApp.setState({ namedRanges: [{ ...one(), rowsStale: true }] });
    expect(retargetNamedRange(id, { datasetId: "s2", cols: [2], rows: { from: 0, to: 4 } }).ok).toBe(true);
    expect(one()).toMatchObject({ scope: { kind: "sheet", datasetId: "s2" }, target: { datasetId: "s2", cols: [2], rows: { from: 0, to: 4 } } });
    expect(one().rowsStale).toBeUndefined();
    expect(retargetNamedRange(id, { datasetId: "s2", cols: [], rows: null }).ok).toBe(false);
    st().undo();
    expect(one()).toMatchObject({ target: { datasetId: "s1" }, rowsStale: true });
  });

  it("a workbook-scoped name cannot be pointed at a sheet outside its workbook", () => {
    define("Base", "workbook", "s1");
    expect(retargetNamedRange(one().id, { datasetId: "solo", cols: [0], rows: null }).ok).toBe(false);
    expect(one().target.datasetId).toBe("s1");
  });
});

describe("columns follow their columns", () => {
  it("insert before the block moves it; insert after leaves it; delete drops that column; move reorders; one undo each", () => {
    define(); // A, B
    insertColumn("s1", 1); // between A and B: B becomes channel 2
    expect(one().target.cols).toEqual([0, 2]);
    st().undo();
    expect(one().target.cols).toEqual([0, 1]);
    insertColumn("s1", 3); // after everything
    expect(one().target.cols).toEqual([0, 1]);
    deleteColumns("s1", [0]);
    expect(one().target.cols).toEqual([0]); // B is now channel 0
    st().undo();
    expect(one().target.cols).toEqual([0, 1]);
  });

  it("move reorders: A moved to the right of C leaves B at 0 and A at 2", () => {
    define();
    moveColumn("s1", 0, 2);
    expect(one().target.cols).toEqual([2, 0]);
  });

  it("a block that loses all its columns is kept and reported broken, never widened", () => {
    defineNamedRange({ name: "OnlyA", scope: "sheet", datasetId: "s1", cols: [0], rows: null });
    deleteColumns("s1", [0]);
    expect(one().target.cols).toEqual([]);
    expect(namedRangeIssue(one(), st().datasets)).toMatch(/every column of the block was deleted/);
    st().undo();
    expect(one().target.cols).toEqual([0]);
  });

  it("a range on another sheet is untouched by this sheet's column edit", () => {
    define("Base", "sheet", "s2");
    const before = ranges();
    deleteColumns("s1", [0]);
    expect(ranges()).toBe(before);
  });
});

describe("rows follow their rows", () => {
  it("insert above moves the block, inside grows it, after leaves it; undo restores", () => {
    define(); // rows 3..9
    insertRowsAbove("s1", [0]);
    expect(one().target.rows).toEqual({ from: 4, to: 10 });
    insertRowsAbove("s1", [7]);
    expect(one().target.rows).toEqual({ from: 4, to: 11 });
    insertRowsAbove("s1", [20]);
    expect(one().target.rows).toEqual({ from: 4, to: 11 });
    st().undo();
    st().undo();
    expect(one().target.rows).toEqual({ from: 4, to: 10 });
  });

  it("delete keeps the survivors contiguous; deleting every row keeps the range flagged, never 'all rows'", () => {
    define();
    deleteRowsAt("s1", [0, 5]);
    expect(one().target.rows).toEqual({ from: 2, to: 7 });
    deleteRowsAt("s1", [2, 3, 4, 5, 6, 7]);
    expect(one().target.rows?.was).toBe("rows 3-8");
    expect(namedRangeIssue(one(), st().datasets)).toMatch(/rows 3-8 no longer exist/);
    st().undo();
    expect(one().target.rows).toEqual({ from: 2, to: 7 });
  });

  it("sort leaves the positions alone and the status line says so", () => {
    define();
    sortWorksheetRows("s1", 0, 1);
    expect(one().target.rows).toEqual({ from: 3, to: 9 });
    expect(st().status).toMatch(/1 row range is by position/);
  });

  it("a range with no row limit is unaffected by row edits", () => {
    defineNamedRange({ name: "All", scope: "sheet", datasetId: "s1", cols: [0], rows: null });
    insertRowsAbove("s1", [2]);
    expect(one().target.rows).toBeNull();
  });
});

describe("delete, with dependants", () => {
  it("a range with no dependants deletes at once, in one undo step", () => {
    define();
    expect(removeNamedRange(one().id)).toEqual({ removed: true, cut: 0 });
    expect(ranges()).toEqual([]);
    st().undo();
    expect(ranges()).toHaveLength(1);
  });

  it("a dependant blocks an unconfirmed delete, which returns it for the dialog; confirmed, the link is cut and one undo restores both", () => {
    define();
    const id = one().id;
    useApp.setState({ savedRois: [{ id: "roi-uses-range" } as never], history: [] });
    const off = registerNamedRangeDependants({
      find: (s, rid) => (rid === id && s.savedRois.length ? [{ kind: "test link", label: "roi-uses-range" }] : []),
      cut: () => ({ savedRois: [] }),
    });
    try {
      expect(removeNamedRange(id)).toEqual({ removed: false, dependants: [{ kind: "test link", label: "roi-uses-range" }] });
      expect(ranges()).toHaveLength(1);
      expect(st().history).toHaveLength(0);
      expect(removeNamedRange(id, { confirmed: true })).toEqual({ removed: true, cut: 1 });
      expect(ranges()).toEqual([]);
      expect(st().savedRois).toEqual([]);
      expect(st().history).toHaveLength(1);
      st().undo();
      expect(ranges()).toHaveLength(1);
      expect(st().savedRois).toHaveLength(1);
    } finally {
      off();
    }
  });

  it("an unknown id is refused with a reason", () => {
    expect(removeNamedRange("nr1:nope")).toMatchObject({ removed: false, reason: expect.stringMatching(/no longer exists/) });
  });
});

describe("goes with its worksheet or workbook", () => {
  it("deleting the target worksheet drops its ranges; another sheet's stay; undo restores", () => {
    define("First", "sheet", "s1");
    define("Second", "sheet", "s2");
    st().removeDatasets(["s1"]);
    expect(ranges().map((r) => r.name)).toEqual(["Second"]);
    st().undo();
    expect(ranges().map((r) => r.name)).toEqual(["First", "Second"]);
  });

  it("deleting a workbook drops its sheet- and workbook-scoped ranges, not a standalone sheet's", () => {
    define("W", "workbook", "s1");
    define("S", "sheet", "s2");
    define("Keep", "sheet", "solo");
    st().deleteWorkbook("w1");
    expect(ranges().map((r) => r.name)).toEqual(["Keep"]);
    st().undo();
    expect(ranges()).toHaveLength(3);
  });

  it("an id that is gone stays gone: a new range with the same name is a different id (nothing re-binds)", () => {
    define("Base");
    const first = one().id;
    removeNamedRange(first);
    define("Base");
    expect(one().id).not.toBe(first);
  });
});

describe("the project file", () => {
  it("saves and reopens ranges (scope, stale, a deleted-away range), written at v9 and gated", () => {
    define("Base", "workbook", "s1");
    define("Edge", "sheet", "solo");
    useApp.setState({ namedRanges: [{ ...ranges()[0], rowsStale: true }, { ...ranges()[1], target: { ...ranges()[1].target, rows: { from: 3, to: 2, was: "rows 4-10" } } }] });
    const text = serializeWorkspace({ ...st() });
    expect((JSON.parse(text) as { version: number }).version).toBe(WORKSPACE_VERSION_POST_045);
    expect(featuresV045WouldDrop(JSON.parse(text))).toContain("Workspace.namedRanges");
    const back = parseWorkspace(text, VIEWPORT);
    expect(back.namedRanges).toEqual(ranges());
    expect(back.migrationWarnings).toEqual([]);
  });

  it("a project with no range writes no key (an ordinary project is unchanged)", () => {
    const text = serializeWorkspace({ ...st() });
    expect(JSON.parse(text)).not.toHaveProperty("namedRanges");
    expect(parseWorkspace(text, VIEWPORT).namedRanges).toEqual([]);
  });

  it("loading a project REPLACES the live ranges: none leaks from the previous project", () => {
    define("Mine");
    const ws = parseWorkspace(JSON.stringify(dwk034), VIEWPORT);
    st().loadWorkspace({ ...ws, namedRanges: undefined });
    expect(ranges()).toEqual([]);
  });

  it("an unreadable range is dropped with a warning: malformed, a missing worksheet, a scope that does not match, a taken name", () => {
    const sheets = [{ id: "s1", workbookId: "w1" }, { id: "s2", workbookId: "w1" }, { id: "solo" }] as unknown as Dataset[];
    const good = { id: "nr1:a", name: "Base", scope: { kind: "sheet", datasetId: "s1" }, target: { datasetId: "s1", cols: [0], rows: { from: 0, to: 3 } } };
    const warnings: string[] = [];
    const out = sanitizeNamedRanges(
      [
        good,
        { ...good, id: "nr1:dup" }, // the name is taken within the workbook
        { ...good, id: "nr1:b", name: "Gone", scope: { kind: "sheet", datasetId: "zz" }, target: { datasetId: "zz", cols: [0], rows: null } },
        { ...good, id: "nr1:c", name: "Mismatch", scope: { kind: "sheet", datasetId: "s2" } }, // sheet scope on another sheet than its block
        { ...good, id: "nr1:d", name: "WrongBook", scope: { kind: "workbook", workbookId: "w2" } },
        { ...good, id: "nr1:e", name: "NoCols", target: { datasetId: "s1", cols: "x", rows: null } },
        { ...good, id: "nr1:f", name: 'bad"name' },
        "junk",
        { ...good, id: "nr1:g", name: "Other", target: { datasetId: "s1", cols: [1, 1], rows: null } },
      ],
      sheets,
      [{ id: "w1" }],
      (m) => warnings.push(m),
    );
    expect(out.map((r) => r.id)).toEqual(["nr1:a"]);
    expect(warnings).toEqual(["8 named ranges were unreadable and not loaded."]);
    expect(sanitizeNamedRanges("nope", sheets, [])).toEqual([]);
  });

  it("a block that has outgrown its sheet loads, and is reported broken, not dropped", () => {
    const sheets = [{ id: "s1", name: "s1", data: sheet("s1").data }] as unknown as Dataset[];
    const raw = [{ id: "nr1:a", name: "Tall", scope: { kind: "sheet", datasetId: "s1" }, target: { datasetId: "s1", cols: [2], rows: { from: 100, to: 120 } } }];
    const out = sanitizeNamedRanges(raw, sheets, []);
    expect(out).toHaveLength(1);
    expect(namedRangeIssue(out[0], sheets)).toMatch(/beyond the worksheet/);
  });
});

describe("Append project", () => {
  const incoming = (datasets: Dataset[], namedRanges: NamedRange[], workbooks = [{ id: "src-wb", name: "Book9" }]): LoadedWorkspace =>
    ({ ...parseWorkspace(JSON.stringify(dwk034), VIEWPORT), datasets, workbooks, namedRanges }) as LoadedWorkspace;
  const incomingRange = (name: string, datasetId: string, scope: NamedRange["scope"]): NamedRange => ({
    id: `nr1:${name}`,
    name,
    scope,
    target: { datasetId, cols: [0], rows: { from: 1, to: 4 } },
  });

  it("remaps ranges through the id tables, drops one whose worksheet did not come along (counted), keeps a standalone sheet's name in its own group, and one undo removes them all", async () => {
    define("Base", "sheet", "solo");
    // The appended sheet collides with the id "solo": it gets a fresh id, and its range must follow it.
    const ws = incoming([sheet("solo"), sheet("other", { workbookId: "src-wb" })], [
      incomingRange("Base", "solo", { kind: "sheet", datasetId: "solo" }),
      incomingRange("InBook", "other", { kind: "workbook", workbookId: "src-wb" }),
      incomingRange("Orphan", "not-there", { kind: "sheet", datasetId: "not-there" }),
    ]);
    const before = ranges();
    await st().appendWorkspace(ws);
    const byName = Object.fromEntries(ranges().map((r) => [r.name, r]));
    // Both standalone sheets are called "Base": each is its own group, so neither renames.
    expect(ranges().map((r) => r.name).sort()).toEqual(["Base", "Base", "InBook"]);
    const byTarget = (id: string) => ranges().find((r) => r.target.datasetId === id)!;
    const reId = st().datasets.find((d) => d.id !== "solo" && d.id !== "s1" && d.id !== "s2" && d.name.startsWith("solo"))!;
    expect(byTarget("solo").scope).toEqual({ kind: "sheet", datasetId: "solo" }); // the existing range, unchanged
    expect(byTarget(reId.id).scope).toEqual({ kind: "sheet", datasetId: reId.id }); // followed its re-id'd sheet
    const newWb = st().workbooks.find((w) => w.id !== "w1")!;
    expect(byName["InBook"].scope).toEqual({ kind: "workbook", workbookId: newWb.id });
    expect(st().status).toMatch(/1 named range dropped/);
    st().undo();
    expect(ranges()).toEqual(before);
  });

  it("an incoming id that is already taken is reminted, so ids stay unique", async () => {
    define("Mine", "sheet", "solo");
    const taken = one().id;
    const ws = incoming([sheet("n1")], [{ ...incomingRange("Theirs", "n1", { kind: "sheet", datasetId: "n1" }), id: taken }], []);
    await st().appendWorkspace(ws);
    expect(new Set(ranges().map((r) => r.id)).size).toBe(2);
  });
});
