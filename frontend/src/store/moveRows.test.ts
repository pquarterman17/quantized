// Worksheet row structure (worksheet audit #12/#13): Move Rows up/down/top/
// bottom did not exist, and the data sort took one key only. Moves and sorts
// carry every ROW_INDEXED_SIDECARS cell and the exclusion marks with the row,
// as one undo step.

import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../lib/types";
import { deleteRowsAt, insertRowsAbove, moveRowsOrder, moveWorksheetRows } from "./moveRows";
import { sortOrderBy, sortWorksheetRowsBy } from "./sortRows";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const sheet = (): Dataset => ({
  id: "s",
  name: "s.csv",
  data: {
    time: [1, 2, 3, 4],
    values: [[2, 9], [1, 8], [2, 7], [1, 6]],
    labels: ["Group", "Value"],
    units: ["", ""],
    metadata: { text_columns: { Sample: ["a", "b", "c", "d"] }, origin_complex_imaginary: { Z: [0.1, 0.2, 0.3, 0.4] } },
  },
  excludedRows: [1],
});

const st = () => useApp.getState();
const ds = () => st().datasets[0];
const sample = () => (ds().data.metadata.text_columns as Record<string, string[]>).Sample;

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useApp.setState({ datasets: [sheet()], activeId: "s", history: [], future: [], status: "" });
});

describe("moveRowsOrder", () => {
  it("moves a block as a unit, one step or to an end; null when nothing moves", () => {
    expect(moveRowsOrder(5, [1, 2], "up")).toEqual([1, 2, 0, 3, 4]);
    expect(moveRowsOrder(5, [1, 2], "down")).toEqual([0, 3, 1, 2, 4]);
    expect(moveRowsOrder(5, [3, 1], "top")).toEqual([1, 3, 0, 2, 4]);
    expect(moveRowsOrder(5, [0, 2], "bottom")).toEqual([1, 3, 4, 0, 2]);
    expect(moveRowsOrder(5, [0], "up")).toBeNull();
    expect(moveRowsOrder(5, [], "down")).toBeNull();
  });
});

describe("Move Rows", () => {
  it("moves numbers, text and imaginary sidecars and the exclusion mark together; one undo step", () => {
    expect(moveWorksheetRows("s", [1], "down")).toEqual([2]);
    expect(ds().data.time).toEqual([1, 3, 2, 4]);
    expect(sample()).toEqual(["a", "c", "b", "d"]);
    expect((ds().data.metadata.origin_complex_imaginary as Record<string, number[]>).Z).toEqual([0.1, 0.3, 0.2, 0.4]);
    expect(ds().excludedRows).toEqual([2]);
    expect(st().history.map((h) => h.label)).toEqual(["move rows"]);
    st().undo();
    expect(ds().data.time).toEqual([1, 2, 3, 4]);
    expect(ds().excludedRows).toEqual([1]);
  });

  it("a row already at the top says so and records nothing", () => {
    expect(moveWorksheetRows("s", [0], "up")).toBeNull();
    expect(st().status).toMatch(/already at the top/);
    expect(st().history).toEqual([]);
  });

  it("insert above / delete from the row menu say what they did", () => {
    insertRowsAbove("s", [2, 1]);
    expect(ds().data.time).toEqual([1, NaN, NaN, 2, 3, 4]);
    expect(sample()).toEqual(["a", "", "", "b", "c", "d"]);
    expect(st().status).toMatch(/inserted 2 rows above row 2/);
    deleteRowsAt("s", [1, 2]);
    expect(ds().data.time).toEqual([1, 2, 3, 4]);
    expect(st().status).toMatch(/deleted 2 rows/);
  });
});

describe("Sort worksheet by several keys", () => {
  it("a later key orders only the rows the earlier keys tie, and is one undo step", () => {
    expect(sortOrderBy(ds(), [{ col: 0, dir: 1 }, { col: 1, dir: 1 }])).toEqual([3, 1, 2, 0]);
    sortWorksheetRowsBy("s", [{ col: 0, dir: 1 }, { col: "Sample", dir: -1 }]);
    expect(sample()).toEqual(["d", "b", "c", "a"]);
    expect(st().status).toMatch(/sorted 4 rows by "Group" \(ascending\), then "Sample" \(descending\)/);
    expect(st().history).toHaveLength(1);
  });
});
