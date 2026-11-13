// Worksheet column "Sort ascending / descending" is a DATA sort (Origin's
// column Sort): it used to reorder the view only — no status line, no history
// entry, so Ctrl+Z skipped past it and undid the action before.

import { beforeEach, describe, expect, it } from "vitest";

import "../lib/formulaRefs"; // registers cumsum() & co. (lib/formulaExt.ts)
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

describe("sort header claims, locked (review #2 items 7, 8, 11)", () => {
  it("a categorical column sorts by level text; fit row ids move; text-only rows past the end stay put", () => {
    useApp.setState({
      datasets: [
        {
          id: "c",
          name: "c",
          data: {
            time: [1, 2, 3],
            values: [[0, 9], [1, 8], [2, 7]],
            labels: ["Cat", "v"],
            units: ["", ""],
            cat_levels: { 0: ["zeta", "Alpha", "beta"] },
            metadata: { text_columns: { T: ["r0", "r1", "r2", "extra3", "extra4"] }, __quantized_fit_row_ids: { "0": "r1:aa", "2": "r1:cc" } },
          },
        } as Dataset,
      ],
    });
    sortWorksheetRows("c", 0, 1);
    const d = st().datasets[0];
    expect(d.data.values.map((r) => r[1])).toEqual([8, 7, 9]); // Alpha, beta, zeta — not codes 0, 1, 2
    expect((d.data.metadata.text_columns as Record<string, string[]>).T).toEqual(["r1", "r2", "r0", "extra3", "extra4"]);
    expect(d.data.metadata.__quantized_fit_row_ids).toEqual({ "1": "r1:cc", "2": "r1:aa" });
  });

  it("a text column sorts by its cell text, blanks last", () => {
    sortWorksheetRows("s", "Sample", -1);
    expect((ds().data.metadata.text_columns as Record<string, string[]>).Sample).toEqual(["nan-row", "c", "b", "a"]);
    expect(st().status).toMatch(/sorted 4 rows by "Sample" \(descending\)/);
  });

  it("refuses, with the reason, a sheet that reads another through sheet() — and one another sheet reads", () => {
    const reader: Dataset = { ...sheet(), id: "r", name: "Reader", formulas: [{ name: "f", expr: 'sheet("s.csv", A)', sheets: [{ name: "s.csv", id: "s" }] }] };
    reader.data = { ...reader.data, values: reader.data.values.map((row) => [...row, row[0]]), labels: ["Signal", "Ref", "f"], units: ["", "", ""] };
    useApp.setState({ datasets: [sheet(), reader] });
    sortWorksheetRows("r", 1, 1);
    expect(st().status).toMatch(/Can't sort "Reader": "f" reads another worksheet row by row through sheet\(\)/);
    sortWorksheetRows("s", 1, 1);
    expect(st().status).toMatch(/Can't sort "s.csv": "Reader" reads it row by row through sheet\(\)/);
    expect(st().history).toEqual([]);
    expect(ds().data.time).toEqual([10, 20, 30, 40]);
  });

  it("names the formulas that read rows by position (recalculated in the new order)", () => {
    const base = sheet();
    const data = { ...base.data, values: base.data.values.map((r) => [...r, 0]), labels: ["Signal", "Ref", "cs"], units: ["", "", ""] };
    useApp.setState({ datasets: [{ ...base, data, formulas: [{ name: "cs", expr: "cumsum(B)", deps: ["B"] }] }] });
    sortWorksheetRows("s", 1, -1);
    expect(st().status).toMatch(/"cs" reads rows by position and was recalculated in the new order/);
    expect(ds().data.values.map((r) => r[2])).toEqual([4, 7, 9, 10]);
  });

  it("a re-derived sheet is refused; a pending book loads first and sorts nothing yet", () => {
    useApp.setState({ datasets: [{ ...sheet(), derivedFrom: { datasetId: "x", pipeline: "smooth" } }] });
    sortWorksheetRows("s", 0, 1);
    expect(st().history).toEqual([]);
    expect(ds().data.time).toEqual([10, 20, 30, 40]);
    useApp.setState({ datasets: [{ ...sheet(), pending: { rows: 9 } as Dataset["pending"] }], status: "" });
    sortWorksheetRows("s", 0, 1);
    expect(st().status).toMatch(/Loading full data for "s.csv" — sorting will continue/);
    expect(st().history).toEqual([]);
    expect(ds().data.time).toEqual([10, 20, 30, 40]);
  });
});
