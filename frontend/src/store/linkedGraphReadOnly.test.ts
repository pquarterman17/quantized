// A LIVE graph's worksheet (`Dataset.linkedCurves`) is a cache the watcher
// rebuilds from its source workbooks, so any data edit or formula column on it
// used to be silently overwritten at the next rebuild. Every editing entry
// point now refuses with one message (lib/rederived.ts), mutating nothing;
// plot styling of the graph is unaffected.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { flushLinkedCurves } from "./linkedCurvesSync";
import { plotSelectedTogether } from "../lib/plotSelectedTogether";
import { LINKED_GRAPH_EDIT_NOTICE } from "../lib/rederived";
import type { Dataset } from "../lib/types";
import { addComputedError } from "./computedErrorRun";
import { addDerivedColumn } from "./derivedColumnRun";
import { insertColumn, deleteColumns, moveColumn, setColumnHeader } from "./worksheetColumns";
import { sortWorksheetRowsBy } from "./sortRows";
import { useApp } from "./useApp";

vi.mock("./paramDialog", () => ({ askParams: vi.fn() }));

const plain = (id: string, y: number[]): Dataset => ({
  id,
  name: id,
  data: { time: [1, 2, 3], values: y.map((v) => [v, v]), labels: ["Y", "Z"], units: ["V", "A"], metadata: {} },
});

const graph = () => useApp.getState().datasets.find((d) => d.linkedCurves)!;

beforeEach(async () => {
  useApp.setState({ datasets: [plain("a", [1, 2, 3]), plain("b", [4, 5, 6])], selectedIds: [], history: [], future: [], status: "" });
  await plotSelectedTogether(["a", "b"]);
  useApp.setState({ status: "", history: [] });
});

describe("a live graph's sheet is read-only for data edits", () => {
  it("refuses cell edits, paste, fill, row insert/delete and categorical edits", () => {
    const g = graph();
    const s = useApp.getState();
    s.setCellValue(g.id, 0, 0, 999);
    s.setCellBlock(g.id, [{ row: 0, col: 0, value: 7 }], "paste cells");
    s.setCellBlock(g.id, [{ row: 0, col: 0, value: 1 }, { row: 1, col: 0, value: 1 }], "fill down");
    s.setCategoricalCell(g.id, 0, 0, "x");
    s.insertRows(g.id, 0, 1);
    s.deleteRows(g.id, [0]);
    expect(graph().data).toBe(g.data);
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().status).toBe(LINKED_GRAPH_EDIT_NOTICE);
  });

  it("refuses column insert/delete/move/rename/sort and formula add", () => {
    const g = graph();
    const attempts: Array<() => unknown> = [
      () => insertColumn(g.id, 0),
      () => deleteColumns(g.id, [0]),
      () => moveColumn(g.id, 0, 1),
      () => setColumnHeader(g.id, 0, { label: "renamed" }),
      () => sortWorksheetRowsBy(g.id, [{ col: 0, dir: -1 }]),
      () => useApp.getState().addFormula(g.id, "twice", "A*2"),
    ];
    for (const run of attempts) {
      useApp.setState({ status: "" });
      run();
      expect(useApp.getState().status).toBe(LINKED_GRAPH_EDIT_NOTICE);
    }
    expect(graph().data).toBe(g.data);
    expect(graph().formulas ?? []).toHaveLength(0);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("addFormula returns false and the graph survives the next rebuild unchanged", () => {
    const g = graph();
    expect(useApp.getState().addFormula(g.id, "twice", "A*2")).toBe(false);
    const a = useApp.getState().datasets.find((d) => d.id === "a")!;
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "a" ? { ...a, data: { ...a.data, values: [[9, 9], [9, 9], [9, 9]] } } : d)),
    }));
    flushLinkedCurves();
    expect(graph().data.labels).toEqual(g.data.labels);
    expect(graph().data.values.map((r) => r[0]).slice(0, 3)).toEqual([9, 9, 9]);
  });

  it("refuses the worksheet's \u0192x-bar and error-column adds (the column would be lost on rebuild)", async () => {
    const g = graph();
    const r = await addDerivedColumn(g.id, { name: "twice", expr: "A*2", propagate: false });
    expect(r).toEqual({ ok: false, error: LINKED_GRAPH_EDIT_NOTICE });
    const e = await addComputedError(g.id, 0, "percent", 5);
    expect(e).toEqual({ ok: false, error: LINKED_GRAPH_EDIT_NOTICE });
    expect(graph().formulas ?? []).toHaveLength(0);
    expect(graph().data).toBe(g.data);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("plot styling of the graph still works", () => {
    useApp.getState().setSeriesStyle(0, { color: "#ff0000" });
    expect(useApp.getState().seriesStyles[0]?.color).toBe("#ff0000");
  });

  it("a plain dataset still accepts the same edits", () => {
    useApp.getState().setCellValue("a", 0, 0, 42);
    expect(useApp.getState().datasets.find((d) => d.id === "a")!.data.values[0][0]).toBe(42);
  });
});
