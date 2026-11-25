// G24 row states: the store half. Apply / clear are undoable (one step each) and
// restore exactly; the states move with their rows through sort, insert and
// delete; a saved project round-trips them; a pending (lazy) book defers the
// apply behind its load. Colours are theme slots, so the same project drawn
// under another theme follows the palette.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBookData } from "../lib/api";
import { resetBookTransportForTests } from "../lib/bookData";
import type { Dataset } from "../lib/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { warmCellEdit } from "./cellEdit";
import { applyRowStyleByColumn, clearRowStyle } from "./rowStyleActions";
import { sortWorksheetRowsBy } from "./sortRows";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  fetchBookData: vi.fn(),
}));

const sheet = (): Dataset => ({
  id: "d1",
  name: "s.csv",
  data: {
    time: [10, 20, 30, 40],
    values: [[2, 5], [0, 6], [1, 7], [0, 8]],
    labels: ["Sample", "Y"],
    units: ["", ""],
    metadata: {},
    cat_levels: { 0: ["a", "b", "c"] },
  },
});
const st = () => useApp.getState();
const ds = () => st().datasets[0];
const BY_SAMPLE = { column: 0, mode: "levels", color: true, marker: true } as const;

beforeAll(async () => { await warmCellEdit(); });
beforeEach(() => {
  resetBookTransportForTests();
  vi.mocked(fetchBookData).mockReset().mockReturnValue(new Promise(() => {}));
  useApp.setState({ datasets: [sheet()], activeId: "d1", history: [], future: [], status: "" });
});

describe("apply / clear / undo / redo", () => {
  it("colors and marks by a column as ONE undo step; undo restores exactly, redo re-applies", () => {
    const pre = st().datasets;
    expect(applyRowStyleByColumn("d1", BY_SAMPLE)).toBeNull();
    expect(ds().rowStyle?.color).toEqual(["s3", "s1", "s2", "s1"]);
    expect(ds().rowStyle?.marker).toEqual(["triangle", "circle", "square", "circle"]);
    expect(st().history).toHaveLength(1);
    const post = st().datasets;
    st().undo();
    expect(st().datasets).toEqual(pre);
    expect(ds().rowStyle).toBeUndefined();
    st().redo();
    expect(st().datasets).toEqual(post);
  });

  it("clear removes colours, markers and legend, and undo brings them back", () => {
    applyRowStyleByColumn("d1", BY_SAMPLE);
    const withStyle = st().datasets;
    clearRowStyle("d1");
    expect(ds().rowStyle).toBeUndefined();
    st().undo();
    expect(st().datasets).toEqual(withStyle);
  });

  it("clearing a dataset with no states records nothing", () => {
    clearRowStyle("d1");
    expect(st().history).toHaveLength(0);
  });

  it("a refused build says why and changes nothing", () => {
    expect(applyRowStyleByColumn("d1", { ...BY_SAMPLE, color: false, marker: false })).toMatch(/Choose/);
    expect(st().history).toHaveLength(0);
    expect(ds().rowStyle).toBeUndefined();
  });

  it("does not touch the analysis view: no exclusion, no data change", () => {
    const data = ds().data;
    applyRowStyleByColumn("d1", BY_SAMPLE);
    expect(ds().data).toBe(data);
    expect(ds().excludedRows).toBeUndefined();
  });
});

describe("states move with their rows", () => {
  it("sort", () => {
    applyRowStyleByColumn("d1", { ...BY_SAMPLE, marker: false });
    sortWorksheetRowsBy("d1", [{ col: 1, dir: -1 }]); // Y descending: rows 3,2,1,0
    expect(ds().data.time).toEqual([40, 30, 20, 10]);
    expect(ds().rowStyle?.color).toEqual(["s1", "s2", "s1", "s3"]);
  });

  it("insert and delete rows", () => {
    applyRowStyleByColumn("d1", { ...BY_SAMPLE, marker: false });
    st().insertRows("d1", 1, 1);
    expect(ds().rowStyle?.color).toEqual(["s3", "", "s1", "s2", "s1"]);
    st().deleteRows("d1", [0, 1]);
    expect(ds().rowStyle?.color).toEqual(["s1", "s2", "s1"]);
    expect(ds().data.time.length).toBe(3);
  });
});

describe("save / load round trip", () => {
  it("a saved project restores the states and the legend; a hand-damaged file is cleaned", () => {
    applyRowStyleByColumn("d1", BY_SAMPLE);
    const text = serializeWorkspace({ datasets: st().datasets });
    const back = parseWorkspace(text).datasets[0];
    expect(back.rowStyle).toEqual(ds().rowStyle);
    // A stale array (rows no longer match) is dropped on load rather than kept.
    const edited = JSON.parse(text) as { datasets: { rowStyle: { color: string[] } }[] };
    edited.datasets[0].rowStyle.color = ["s1"];
    expect(parseWorkspace(JSON.stringify(edited)).datasets[0].rowStyle?.marker).toBeDefined();
    expect(parseWorkspace(JSON.stringify(edited)).datasets[0].rowStyle?.color).toBeUndefined();
  });

  it("a project without row states writes no rowStyle key (older files are byte-stable)", () => {
    expect(serializeWorkspace({ datasets: st().datasets })).not.toContain("rowStyle");
  });
});

describe("a lazy (pending) book", () => {
  it("defers the apply behind its load instead of indexing preview rows", () => {
    useApp.setState({ datasets: [{ ...sheet(), pending: { kind: "path", path: "/x.opju", bookId: "B", rows: 4, cols: 2 } }] });
    expect(applyRowStyleByColumn("d1", BY_SAMPLE)).toBeNull();
    expect(ds().rowStyle).toBeUndefined();
    expect(vi.mocked(fetchBookData)).toHaveBeenCalled();
  });
});
