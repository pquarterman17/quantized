// Cell notes through the REAL store (ROW_RANGE_CONTRACT 7.2, R6): a note follows its cell through sort,
// insert, delete, Extract and every column operation, edits are one undo step and coalesce, limits and
// refusals say why, and a project holding a note is written at v9 (older releases refuse it).

import { beforeEach, describe, expect, it } from "vitest";

import { planExtract } from "../components/Stage/worksheet/extractRows";
import dwk034 from "../lib/__fixtures__/workspace/v4-0.34.0.dwk.json";
import { CELL_NOTES_KEY, MAX_NOTE_CHARS, noteAt, noteCount } from "../lib/cellNotes";
import type { Dataset } from "../lib/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { insertRowsAbove, deleteRowsAt } from "./moveRows";
import { setCellNote } from "./cellNotes";
import { sortWorksheetRows } from "./sortRows";
import { useApp } from "./useApp";
import { deleteColumns, insertColumn, moveColumn } from "./worksheetColumns";

/** Row r holds x = 10 * (r + 1) and column A = [3, 1, 4, 2][r], so sorting by A reorders every row. */
const sheet = (extra: Partial<Dataset> = {}): Dataset => ({
  id: "s",
  name: "s.csv",
  data: {
    time: [10, 20, 30, 40],
    values: [[3, 30, 300], [1, 10, 100], [4, 40, 400], [2, 20, 200]],
    labels: ["A", "B", "C"],
    units: ["", "", ""],
    metadata: {},
  },
  ...extra,
});
const st = () => useApp.getState();
const ds = () => st().datasets[0];
const note = (row: number, col: number) => noteAt(ds().data.metadata, row, col);

beforeEach(() => {
  useApp.setState({ datasets: [sheet()], activeId: "s", history: [], future: [], status: "" });
});

describe("a note follows its cell", () => {
  it("through sort: the cell holding value 4 (row 2) moves to the top when sorted descending", () => {
    expect(setCellNote("s", 2, 1, "the 40 reading")).toBe(true);
    sortWorksheetRows("s", 0, -1); // A descending: 4, 3, 2, 1
    expect(ds().data.values.map((r) => r[1])).toEqual([40, 30, 20, 10]);
    expect(note(0, 1)).toBe("the 40 reading");
    expect(note(2, 1)).toBeUndefined();
    expect(noteCount(ds().data.metadata)).toBe(1);
    st().undo(); // the sort comes back, notes and rows together
    expect(note(2, 1)).toBe("the 40 reading");
  });

  it("through insert (a note below shifts down, above stays) and delete (the noted row's note goes with it)", () => {
    setCellNote("s", 1, 0, "above");
    setCellNote("s", 3, 2, "below");
    insertRowsAbove("s", [2]);
    expect(note(1, 0)).toBe("above");
    expect(note(4, 2)).toBe("below");
    expect(note(3, 2)).toBeUndefined();
    deleteRowsAt("s", [1]); // the noted row itself
    expect(noteCount(ds().data.metadata)).toBe(1);
    expect(note(3, 2)).toBe("below"); // row 4 -> 3 after the insert and the delete
    st().undo();
    expect(note(1, 0)).toBe("above");
    expect(note(4, 2)).toBe("below");
  });

  it("through Extract: the child holds the note on the extracted row, in the extracted order", () => {
    setCellNote("s", 3, 1, "kept");
    setCellNote("s", 0, 1, "left behind");
    const plan = planExtract(ds().data, [3, 1])!;
    expect(noteAt(plan.data.metadata, 0, 1)).toBe("kept");
    expect(noteCount(plan.data.metadata)).toBe(1);
    expect(noteCount(ds().data.metadata)).toBe(2); // the source is untouched
  });

  it("through column insert, move and delete (-1 is X and never shifts)", () => {
    setCellNote("s", 0, -1, "on x");
    setCellNote("s", 0, 1, "on B");
    insertColumn("s", 0); // a blank column before A: B is now column 2
    expect(note(0, 2)).toBe("on B");
    expect(note(0, 1)).toBeUndefined();
    expect(note(0, -1)).toBe("on x");
    moveColumn("s", 2, 0); // B moves to the front
    expect(note(0, 0)).toBe("on B");
    deleteColumns("s", [0]); // ... and is deleted: its note goes
    expect(noteCount(ds().data.metadata)).toBe(1);
    expect(note(0, -1)).toBe("on x");
    st().undo();
    expect(note(0, 0)).toBe("on B");
  });

  it("through a column insert on a sheet with a computed column: values recompute AND the note moves", () => {
    useApp.setState({
      datasets: [sheet({ formulas: [{ name: "twice", expr: "A*2", deps: ["A"] }], data: { ...sheet().data, labels: ["A", "B", "C", "twice"], units: ["", "", "", ""], values: sheet().data.values.map((r) => [...r, r[0] * 2]) } })],
    });
    setCellNote("s", 2, 2, "on C");
    insertColumn("s", 1);
    expect(ds().data.labels.length).toBe(5);
    expect(note(2, 3)).toBe("on C");
    expect(ds().data.values.map((r) => r[ds().data.labels.indexOf("twice")])).toEqual([6, 2, 8, 4]); // not clobbered by the remap
  });
});

describe("edits", () => {
  it("one undo step per edit; consecutive edits of ONE note fold into one step, another cell starts a new one", () => {
    setCellNote("s", 0, 0, "first");
    setCellNote("s", 0, 0, "second");
    expect(st().history).toHaveLength(1);
    setCellNote("s", 1, 0, "other cell");
    expect(st().history).toHaveLength(2);
    st().undo();
    expect(note(1, 0)).toBeUndefined();
    expect(note(0, 0)).toBe("second");
    st().undo();
    expect(note(0, 0)).toBeUndefined(); // both edits of the first note undone at once
    expect(ds().data.metadata[CELL_NOTES_KEY]).toBeUndefined();
  });

  it("blank or null text deletes; deleting the last note removes the key (so the file is no longer gated)", () => {
    setCellNote("s", 0, 0, "x");
    setCellNote("s", 0, 0, "   ");
    expect(note(0, 0)).toBeUndefined();
    expect(CELL_NOTES_KEY in ds().data.metadata).toBe(false);
    expect(setCellNote("s", 0, 0, null)).toBe(false); // nothing to delete
  });

  it("refuses with a reason: too long, off the sheet, past 2,000 notes, a re-derived sheet", () => {
    expect(setCellNote("s", 0, 0, "x".repeat(MAX_NOTE_CHARS + 1))).toBe(false);
    expect(st().status).toMatch(/at most 2,000 characters/);
    expect(setCellNote("s", 99, 0, "x")).toBe(false);
    expect(setCellNote("s", 0, 7, "x")).toBe(false);
    expect(st().status).toMatch(/outside the sheet/);
    const many: Record<string, Record<string, string>> = { 0: {} };
    for (let i = 0; i < 2000; i += 1) many[0][String(i)] = "n";
    useApp.setState({ datasets: [sheet({ data: { ...sheet().data, metadata: { [CELL_NOTES_KEY]: many } } })] });
    expect(setCellNote("s", 1, 1, "one too many")).toBe(false);
    expect(st().status).toMatch(/at most 2,000 notes/);
    expect(setCellNote("s", 1, 0, "edit in place is fine")).toBe(true); // an existing note may still change
    useApp.setState({ datasets: [sheet({ derivedFrom: { sourceId: "x", steps: [] } as never })] });
    expect(setCellNote("s", 0, 0, "x")).toBe(false);
  });
});

describe("a project holding a note", () => {
  const ws = (d: Dataset) => {
    const w = parseWorkspace(JSON.stringify(dwk034), { width: 1600, height: 900 });
    w.datasets = [d];
    return w;
  };
  const version = (text: string) => (JSON.parse(text) as { version: number }).version;
  const READER_V045_ACCEPTS = (text: string) => [1, 2, 3, 4, 5, 6, 7, 8].includes(version(text)); // v0.45.0's own gate

  it("is written at v9 and refused by the v0.45.0 reader; deleting the note makes it readable again", () => {
    setCellNote("s", 0, 0, "kept in the file");
    expect(version(serializeWorkspace(ws(ds())))).toBe(9);
    expect(READER_V045_ACCEPTS(serializeWorkspace(ws(ds())))).toBe(false);
    setCellNote("s", 0, 0, null);
    expect(READER_V045_ACCEPTS(serializeWorkspace(ws(ds())))).toBe(true);
  });

  it("round-trips the note through save and reopen", () => {
    setCellNote("s", 2, 1, "survives");
    const back = parseWorkspace(serializeWorkspace(ws(ds())), { width: 1600, height: 900 });
    expect(noteAt(back.datasets[0].data.metadata, 2, 1)).toBe("survives");
  });
});
