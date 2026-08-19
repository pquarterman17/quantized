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

// P1.6b item 7: setCellValue/setCellBlock guard categorical cells rather than
// writing an unvalidated raw code, and a new setCategoricalCell gives the
// worksheet UI a level-aware entry point (pick-existing / extend-the-table /
// clear-to-missing — see cellEdit.ts's header for the ruling).
const catDs = (): Dataset => ({
  id: "d1",
  name: "grades.dat",
  data: {
    time: [0, 1, 2],
    values: [[0], [1], [2]],
    labels: ["Grade"],
    units: [""],
    metadata: {},
    cat_levels: { 0: ["Pass", "OK", "Fail"] },
  },
});

describe("setCellValue — categorical guard (P1.6b)", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [catDs()], activeId: "d1" });
  });

  it("refuses an out-of-range code, leaving the cell untouched", () => {
    useApp.getState().setCellValue("d1", 0, 0, 99);
    expect(active().data.values[0][0]).toBe(0); // unchanged
    expect(useApp.getState().status).toMatch(/not a valid level code/);
  });

  it("refuses a non-integer code", () => {
    useApp.getState().setCellValue("d1", 0, 0, 1.5);
    expect(active().data.values[0][0]).toBe(0);
  });

  it("accepts an in-range existing code", () => {
    useApp.getState().setCellValue("d1", 0, 0, 2);
    expect(active().data.values[0][0]).toBe(2);
  });

  it("NaN (clear to missing) is always allowed", () => {
    useApp.getState().setCellValue("d1", 0, 0, Number.NaN);
    expect(active().data.values[0][0]).toBeNaN();
  });

  it("a plain (non-categorical) column is unaffected by the guard", () => {
    useApp.setState({ datasets: [ds()], activeId: "d1" });
    useApp.getState().setCellValue("d1", 0, 0, 12345);
    expect(active().data.values[0][0]).toBe(12345);
  });
});

describe("setCellBlock — categorical guard (P1.6b)", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [catDs()], activeId: "d1" });
  });

  it("skips an invalid categorical cell but applies the rest of the block", () => {
    useApp.getState().setCellBlock(
      "d1",
      [
        { row: 0, col: 0, value: 99 }, // invalid — skipped
        { row: 1, col: 0, value: 2 }, // valid — applied
      ],
      "paste cells",
    );
    expect(active().data.values[0][0]).toBe(0); // untouched
    expect(active().data.values[1][0]).toBe(2);
  });

  // Adversarial review P2: a partial paste must say what it skipped and
  // why — matching setCellValue's voice two paragraphs above, not staying
  // silent the way the pre-existing computed-column filter did.
  it("reports how many cells it skipped, not silently (matches setCellValue's voice)", () => {
    useApp.getState().setCellBlock(
      "d1",
      [
        { row: 0, col: 0, value: 99 }, // invalid — skipped
        { row: 1, col: 0, value: 2 }, // valid — applied
      ],
      "paste cells",
    );
    expect(useApp.getState().status).toMatch(/skipped 1/);
  });

  it("reports a full refusal (not silence) when EVERY cell is invalid", () => {
    useApp.getState().setCellBlock("d1", [{ row: 0, col: 0, value: 99 }], "paste cells");
    expect(active().data.values[0][0]).toBe(0); // unchanged
    expect(useApp.getState().status).toMatch(/skipped|invalid|nothing/i);
  });

  it("reports nothing when the whole block applies cleanly", () => {
    useApp.setState({ status: "" });
    useApp.getState().setCellBlock("d1", [{ row: 0, col: 0, value: 2 }], "paste cells");
    expect(useApp.getState().status).toBe("");
  });
});

describe("setCategoricalCell (P1.6b: level picker / extend-the-table / clear)", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [catDs()], activeId: "d1" });
  });

  it("picks an EXISTING level by exact label, writing its code", () => {
    useApp.getState().setCategoricalCell("d1", 0, 0, "Fail");
    expect(active().data.values[0][0]).toBe(2);
    expect(active().data.cat_levels?.[0]).toEqual(["Pass", "OK", "Fail"]); // table unchanged
  });

  it("picks an existing level case-insensitively", () => {
    useApp.getState().setCategoricalCell("d1", 0, 0, "fail");
    expect(active().data.values[0][0]).toBe(2);
  });

  // Adversarial review P2: a case-insensitive match under the explicit
  // "type a new level" gesture is CORRECT (no near-duplicate created) but
  // was WRONG-FEEDBACK silent — the user typed "fail" expecting a new
  // level and got no sign it resolved to the existing "Fail" instead.
  it("reports a case-insensitive match under the typed-new-level path, not silently", () => {
    useApp.getState().setCategoricalCell("d1", 0, 0, "fail");
    expect(useApp.getState().status).toMatch(/matched existing level "Fail"/i);
  });

  it("reports NOTHING extra for an exact-case match (not a surprising resolution)", () => {
    useApp.setState({ status: "" });
    useApp.getState().setCategoricalCell("d1", 0, 0, "Fail"); // exact case — the expected/unsurprising pick
    expect(useApp.getState().status).toBe("");
  });

  it("EXTENDS the level table for a genuinely new label", () => {
    useApp.getState().setCategoricalCell("d1", 0, 0, "Incomplete");
    expect(active().data.cat_levels?.[0]).toEqual(["Pass", "OK", "Fail", "Incomplete"]);
    expect(active().data.values[0][0]).toBe(3); // the newly appended code
  });

  it("is ONE undo entry for the whole extend-the-table commit", () => {
    const before = active().data;
    useApp.getState().setCategoricalCell("d1", 0, 0, "Incomplete");
    useApp.getState().undo();
    expect(active().data).toEqual(before);
  });

  it("clears to missing (NaN) on blank input — never a refusal", () => {
    useApp.getState().setCategoricalCell("d1", 0, 0, "   ");
    expect(active().data.values[0][0]).toBeNaN();
    expect(active().data.cat_levels?.[0]).toEqual(["Pass", "OK", "Fail"]); // table unchanged
  });

  it("refuses a non-categorical column", () => {
    useApp.setState({ datasets: [ds()], activeId: "d1" });
    useApp.getState().setCategoricalCell("d1", 0, 0, "whatever");
    expect(active().data.values[0][0]).toBe(10); // unchanged (ds()'s original value)
  });
});

describe("insertRows / deleteRows (MAIN #34)", () => {
  const withExclusions = () => ({
    ...ds(),
    excludedRows: [0, 2],
  });

  it("inserts blank rows at the position", () => {
    useApp.getState().insertRows("d1", 1, 2);
    const d = active().data;
    expect(d.time).toHaveLength(5);
    expect(d.time[0]).toBe(0);
    expect(d.time[1]).toBeNaN();
    expect(d.time[2]).toBeNaN();
    expect(d.time[3]).toBe(1);
    expect(d.values[1].every(Number.isNaN)).toBe(true);
  });

  it("REMAPS row exclusions on insert instead of discarding them", () => {
    // An explicit insert knows exactly what moved, so throwing away the user's
    // exclusions would be needless damage.
    useApp.setState({ datasets: [withExclusions()], activeId: "d1" });
    useApp.getState().insertRows("d1", 1, 1);
    expect(active().excludedRows).toEqual([0, 3]);
  });

  it("deletes the named rows", () => {
    useApp.getState().deleteRows("d1", [1]);
    expect(active().data.time).toEqual([0, 2]);
    expect(active().data.values).toEqual([
      [10, 100],
      [30, 300],
    ]);
  });

  it("REMAPS row exclusions on delete, dropping the deleted ones", () => {
    useApp.setState({ datasets: [withExclusions()], activeId: "d1" });
    useApp.getState().deleteRows("d1", [0]);
    // row 0 was excluded and is gone; row 2 shifts up to 1.
    expect(active().excludedRows).toEqual([1]);
  });

  it("ignores out-of-range rows rather than corrupting the grid", () => {
    useApp.getState().deleteRows("d1", [99, -1]);
    expect(active().data.time).toHaveLength(3);
  });

  it("is a single undo entry for the whole structural change", () => {
    useApp.getState().insertRows("d1", 0, 3);
    expect(active().data.time).toHaveLength(6);
    useApp.getState().undo();
    expect(active().data.time).toHaveLength(3);
  });

  it("no-ops on an empty or non-positive request", () => {
    const before = active();
    useApp.getState().insertRows("d1", 0, 0);
    useApp.getState().deleteRows("d1", []);
    expect(active()).toBe(before);
  });

  it("does nothing for an unknown dataset", () => {
    expect(() => useApp.getState().deleteRows("nope", [0])).not.toThrow();
  });
});
