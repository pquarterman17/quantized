// Code bug-hunt BH-03: a STALE row style (its arrays no longer match the rows,
// e.g. after a correction trimmed rows) must stay out of every row operation.
// sliceRowStyle used to remap it anyway, and because a remap always emits
// `n` entries the result looked valid: colours on the wrong measurements.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBookData } from "../lib/api";
import { resetBookTransportForTests } from "../lib/bookData";
import { usableRowStyle } from "../lib/rowStyle";
import type { Dataset } from "../lib/types";
import { warmCellEdit } from "./cellEdit";
import { sortWorksheetRowsBy } from "./sortRows";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  fetchBookData: vi.fn(),
}));

// 4 rows, but the style was written for 6 (two rows were trimmed since).
const stale = (): Dataset => ({
  id: "d1",
  name: "s.csv",
  data: { time: [10, 20, 30, 40], values: [[2], [0], [1], [3]], labels: ["Y"], units: [""], metadata: {} },
  rowStyle: { color: ["s1", "s2", "s3", "s4", "s5", "s6"] },
});
const st = () => useApp.getState();
const ds = () => st().datasets[0];

beforeAll(async () => { await warmCellEdit(); });
beforeEach(() => {
  resetBookTransportForTests();
  vi.mocked(fetchBookData).mockReset().mockReturnValue(new Promise(() => {}));
  useApp.setState({ datasets: [stale()], activeId: "d1", history: [], future: [], status: "" });
});

describe("a stale row style is never re-aligned by a row operation", () => {
  it("sort does not turn a stale array into a valid-looking one", () => {
    sortWorksheetRowsBy("d1", [{ col: 0, dir: -1 }]);
    expect(ds().data.time).toEqual([40, 10, 30, 20]);
    expect(usableRowStyle(ds())).toBeUndefined();
  });
  it("insert and delete rows do not either", () => {
    st().insertRows("d1", 1, 2);
    expect(usableRowStyle(ds())).toBeUndefined();
    st().deleteRows("d1", [0]);
    expect(usableRowStyle(ds())).toBeUndefined();
  });
});
