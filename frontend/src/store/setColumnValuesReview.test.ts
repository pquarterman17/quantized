// Review fixes for Set Column Values / Set Row Count (gap audit 4, lane B
// review): each case here failed before its fix.
//   H1  a range-only change keeps the column's unit and σ binding
//   H2  Set Row Count never applies a count chosen against a loading
//       book's preview to its full rows
//   M1  a re-derived sheet's data columns are neither offered nor reported
//       as written
//   M2  a loading book is refused, never written from its preview
//   M3  the stored range is read back from the syntax tree (after a column
//       delete re-serialises the formula), and re-ranging replaces it

import { beforeEach, describe, expect, it } from "vitest";

import "../lib/formulaRefs";
import { targetKind, targetOptions, unwrapRange, wrapRange } from "../lib/setColumnValues";
import type { Dataset } from "../lib/types";
import { addDerivedColumn } from "./derivedColumnRun";
import { applySetColumnValues } from "./setColumnValuesRun";
import { useApp } from "./useApp";
import { deleteColumns } from "./worksheetColumns";
import { setRowCount } from "./worksheetFill";

const book = (over: Partial<Dataset> = {}): Dataset => ({
  id: "b",
  name: "Book1",
  data: {
    time: [0, 1, 2, 3],
    values: [
      [2, 0.1, 9],
      [4, 0.1, 8],
      [6, 0.3, 7],
      [8, 0.2, 6],
    ],
    labels: ["Temp", "dTemp", "Count"],
    units: ["K", "K", ""],
    metadata: {},
  },
  errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }],
  ...over,
});

const st = () => useApp.getState();
const ds = () => st().datasets.find((d) => d.id === "b")!;
const col = (c: number) => ds().data.values.map((r) => r[c]);

beforeEach(() => {
  useApp.setState({ datasets: [book()], activeId: "b", history: [], future: [], status: "", plotWindows: [] });
});

describe("H1: a range-only change keeps the unit and the σ binding", () => {
  it("D = A * 2 with its σ, then limited to rows 2–3: unit, σ link and error bars survive", async () => {
    expect(await addDerivedColumn("b", { name: "D", expr: "A * 2", propagate: true })).toMatchObject({ ok: true });
    const d = ds().data.labels.indexOf("D");
    const s = ds().data.labels.indexOf("σ(D)");
    expect(ds().data.units[d]).toBe("K");
    const before = st().history.length;
    const r = await applySetColumnValues("b", { target: { kind: "column", col: d }, name: "D", expr: "A * 2", range: { from: 2, to: 3 } });
    expect(r.ok).toBe(true);
    expect(st().history.length).toBe(before + 1); // one undo step for both columns
    expect(ds().data.units[d]).toBe("K");
    expect(ds().formulas?.find((f) => f.name === "D")?.derived?.sigma).toBe("σ(D)");
    expect(ds().formulaErrors ?? {}).toEqual({});
    expect(col(d)).toEqual([NaN, 8, 12, NaN]);
    expect(col(s)).toEqual([NaN, 0.2, 0.6, NaN]); // the σ column follows the range
  });

  it("a NEW formula gets its unit re-derived instead of dropped", async () => {
    await addDerivedColumn("b", { name: "D", expr: "A * 2", propagate: false });
    const d = ds().data.labels.indexOf("D");
    await applySetColumnValues("b", { target: { kind: "column", col: d }, name: "D", expr: "A * A", range: { from: 1, to: 4 } });
    expect(ds().data.units[d]).toBe("K²");
  });
});

describe("H2: Set Row Count on a loading book", () => {
  it("a count chosen against the preview's 2 rows is refused once the full 4 rows arrive", async () => {
    const full = book();
    const preview = book({ pending: { kind: "path", path: "p", book: "b" } as unknown as Dataset["pending"] });
    preview.data = { ...preview.data, time: [0, 1], values: preview.data.values.slice(0, 2) };
    useApp.setState({
      datasets: [preview],
      resolveDataset: async () => {
        useApp.setState({ datasets: [full] });
        return full;
      },
    });
    setRowCount("b", 3); // "add one row" against the 2 the user sees
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(ds().data.time).toEqual([0, 1, 2, 3]); // NOT cut to 3
    expect(st().status).toMatch(/nothing changed: the worksheet has 4 rows, not the 2 shown/);
  });

  it("refuses when the count shown is not the count now", () => {
    setRowCount("b", 2, 10);
    expect(ds().data.time).toHaveLength(4);
    setRowCount("b", 2, 4);
    expect(ds().data.time).toHaveLength(2);
  });
});

describe("M1/M2: read-only and loading sheets", () => {
  it("a re-derived sheet: data columns not offered, and a write is refused — never reported as done", async () => {
    useApp.setState({ datasets: [book({ derivedFrom: { datasetId: "src", pipeline: "p" } })] });
    expect(targetOptions(ds(), "X").map((o) => o.value)).toEqual(["new"]);
    expect(targetKind(ds(), { kind: "column", col: 0 })).toBe("readonly");
    const r = await applySetColumnValues("b", { target: { kind: "column", col: 0 }, name: "", expr: "A * 100", range: { from: 1, to: 4 } });
    expect(r.ok).toBe(false);
    expect(col(0)).toEqual([2, 4, 6, 8]);
  });

  it("a loading book is refused for every target: its rows are the preview's", async () => {
    useApp.setState({ datasets: [book({ pending: { kind: "path", path: "p", book: "b" } as unknown as Dataset["pending"] })] });
    for (const target of [{ kind: "new" } as const, { kind: "column", col: 0 } as const]) {
      const r = await applySetColumnValues("b", { target, name: "Z", expr: "A", range: { from: 1, to: 4 } });
      expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/still loading/) });
    }
    expect(col(0)).toEqual([2, 4, 6, 8]);
  });
});

describe("M3: the stored range survives a rewrite and is replaced, not nested", () => {
  it("reads the range back after deleting an earlier column re-serialises the formula", async () => {
    await applySetColumnValues("b", { target: { kind: "new" }, name: "D", expr: "C * 2", range: { from: 2, to: 3 } });
    deleteColumns("b", [1]); // dTemp: C becomes B, the formula is rewritten token by token
    const stored = ds().formulas![0].expr;
    expect(stored).not.toBe("if(row() >= 2 and row() <= 3, B * 2, nan)"); // respaced
    expect(unwrapRange(stored)).toEqual({ expr: "B * 2", from: "2", to: "3" });
  });

  it("re-ranging replaces the old range: rows 3–4 of a 2–3 column are 3–4", () => {
    const once = wrapRange("A", { from: 2, to: 3 }, 4);
    expect(wrapRange(once, { from: 3, to: 4 }, 4)).toBe("if(row() >= 3 and row() <= 4, A, nan)");
    expect(wrapRange(" if ( row ( ) >= 2 and row ( ) <= 3 , A , nan ) ", { from: 1, to: 4 }, 4)).toBe("A");
  });
});
