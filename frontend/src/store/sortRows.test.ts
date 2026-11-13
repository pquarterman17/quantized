// Worksheet column "Sort ascending / descending" is a DATA sort (Origin's
// column Sort): it used to reorder the view only — no status line, no history
// entry, so Ctrl+Z skipped past it and undid the action before.

import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../lib/types";
import { sortOrder, sortWorksheetRows } from "./sortRows";
import { useApp } from "./useApp";

const sheet = (): Dataset => ({
  id: "s",
  name: "s.csv",
  data: {
    time: [10, 20, 30, 40],
    values: [[3, 1], [Number.NaN, 2], [1, 3], [2, 4]],
    labels: ["Signal", "Ref"],
    units: ["", ""],
    metadata: { text_columns: { Sample: ["c", "nan-row", "a", "b"] } },
  },
  excludedRows: [2],
});

const st = () => useApp.getState();
const ds = () => st().datasets[0];

beforeEach(() => {
  useApp.setState({ datasets: [sheet()], activeId: "s", history: [], future: [], status: "" });
});

describe("worksheet column sort", () => {
  it("moves whole rows (numbers, text cells, excluded marks), blanks last, with a status and ONE undo step", () => {
    sortWorksheetRows("s", 0, 1);
    expect(ds().data.time).toEqual([30, 40, 10, 20]);
    expect(ds().data.values.map((r) => r[1])).toEqual([3, 4, 1, 2]);
    expect((ds().data.metadata.text_columns as Record<string, string[]>).Sample).toEqual(["a", "b", "c", "nan-row"]);
    expect(ds().excludedRows).toEqual([0]); // the excluded row (x = 30) moved to the top
    expect(st().status).toMatch(/sorted 4 rows by "Signal" \(ascending\)/);
    expect(st().history.map((h) => h.label)).toEqual(["sort rows"]);
    st().undo();
    expect(ds().data.time).toEqual([10, 20, 30, 40]);
    expect(ds().excludedRows).toEqual([2]);
  });

  it("descending keeps blanks last; a computed column is recomputed from the sorted rows", () => {
    const base = sheet();
    const data = { ...base.data, values: base.data.values.map((r) => [...r, r[0] * 2]), labels: ["Signal", "Ref", "twice"], units: ["", "", ""] };
    useApp.setState({ datasets: [{ ...base, data, formulas: [{ name: "twice", expr: "A*2", deps: ["A"] }] }] });
    sortWorksheetRows("s", 0, -1);
    expect(ds().data.time).toEqual([10, 40, 30, 20]);
    expect(ds().data.values.map((r) => r[2])).toEqual([6, 4, 2, Number.NaN]);
  });

  it("an already-sorted column says so and records nothing; sortOrder is stable", () => {
    sortWorksheetRows("s", -1, 1);
    expect(st().status).toMatch(/already sorted/);
    expect(st().history).toEqual([]);
    const tied: Dataset = { ...sheet(), data: { ...sheet().data, values: [[1, 0], [1, 0], [0, 0], [1, 0]] } };
    expect(sortOrder(tied, 0, -1)).toEqual([0, 1, 3, 2]);
  });
});
