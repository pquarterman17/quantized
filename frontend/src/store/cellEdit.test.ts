// setCellBlock (MAIN_PLAN #34): the bulk cell write. The single most important
// property is that a paste is ONE undoable operation — as N setCellValue calls
// it would take N presses of Ctrl+Z to reverse, which is not a usable model.

import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "./useApp";
import type { Dataset } from "../lib/types";

const ds = (): Dataset => ({
  id: "d1",
  name: "scan.dat",
  data: {
    time: [0, 1, 2],
    values: [
      [10, 100],
      [20, 200],
      [30, 300],
    ],
    labels: ["A", "B"],
    units: ["", ""],
    metadata: {},
  },
});

const active = () => useApp.getState().datasets[0];

beforeEach(() => {
  useApp.setState({ datasets: [ds()], activeId: "d1" });
});

describe("setCellBlock", () => {
  it("writes every edit in one pass", () => {
    useApp.getState().setCellBlock(
      "d1",
      [
        { row: 0, col: 0, value: 11 },
        { row: 2, col: 1, value: 333 },
      ],
      "paste cells",
    );
    expect(active().data.values[0][0]).toBe(11);
    expect(active().data.values[2][1]).toBe(333);
    expect(active().data.values[1][0]).toBe(20); // untouched
  });

  it("writes the x/time column via col -1", () => {
    useApp.getState().setCellBlock("d1", [{ row: 1, col: -1, value: 99 }], "paste cells");
    expect(active().data.time[1]).toBe(99);
  });

  it("is ONE undo entry regardless of how many cells changed", () => {
    const before = useApp.getState().datasets[0].data.values[0][0];
    useApp.getState().setCellBlock(
      "d1",
      [
        { row: 0, col: 0, value: 1 },
        { row: 1, col: 0, value: 2 },
        { row: 2, col: 0, value: 3 },
      ],
      "paste cells",
    );
    expect(active().data.values[0][0]).toBe(1);
    useApp.getState().undo();
    // A single undo restores the WHOLE block, not just the last cell.
    expect(active().data.values[0][0]).toBe(before);
    expect(active().data.values[1][0]).toBe(20);
    expect(active().data.values[2][0]).toBe(30);
  });

  it("refuses computed (formula) columns even if an edit names one", () => {
    useApp.setState({
      datasets: [{ ...ds(), formulas: [{ name: "C", expr: "A*2" }] }],
      activeId: "d1",
    });
    // With one formula, only column 0 is writable (labels 2 - formulas 1 = 1).
    useApp.getState().setCellBlock(
      "d1",
      [
        { row: 0, col: 0, value: 7 },
        { row: 0, col: 1, value: 8 },
      ],
      "paste cells",
    );
    expect(active().data.values[0][0]).toBe(7);
    expect(active().data.values[0][1]).not.toBe(8);
  });

  it("ignores out-of-range rows rather than growing the dataset", () => {
    useApp.getState().setCellBlock("d1", [{ row: 99, col: 0, value: 5 }], "paste cells");
    expect(active().data.time).toHaveLength(3);
  });

  it("is a no-op for an empty edit list", () => {
    const before = active();
    useApp.getState().setCellBlock("d1", [], "paste cells");
    expect(active()).toBe(before); // same reference — nothing was set
  });

  it("does nothing for an unknown dataset id", () => {
    expect(() =>
      useApp.getState().setCellBlock("nope", [{ row: 0, col: 0, value: 1 }], "paste cells"),
    ).not.toThrow();
  });
});
