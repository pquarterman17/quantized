// Red-first store tests for LIBRARY_WORKBOOK_UX_PLAN PR J slice 1 — combine
// (L0.32-L0.34), against the real `useApp` store (undo/history included).

import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "./useApp";
import type { Dataset } from "../lib/types";
import type { WorkbookNode } from "../lib/workbooks";

const wb = (id: string, name: string): WorkbookNode => ({ id, name });
const ds = (id: string, name: string, workbookId: string | undefined, extra: Partial<Dataset> = {}): Dataset => ({
  id,
  name,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
  workbookId,
  ...extra,
});

describe("workbookCombine slice", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [
        ds("d1", "run1_field.dat", "w1", { source: { kind: "path", path: "/x/run1_field.dat" }, importedAt: "2026-01-01T00:00:00Z" }),
        ds("d2", "run1_temp.dat", "w1"),
        ds("d3", "solo.dat", "w2"),
      ],
      workbooks: [wb("w1", "run1"), wb("w2", "solo")],
      folders: [],
      originFigures: [],
      editableFigures: [],
      figureDocs: [],
      reports: [],
      pages: [],
      quickPlotTemplates: [],
      activeId: null,
      selectedIds: [],
      trash: [],
      history: [],
      future: [],
      status: "",
    });
  });

  it("moves every selected worksheet into ONE new workbook under the given name", () => {
    const newId = useApp.getState().combineWorkbooks({ workbookIds: ["w1"], worksheetIds: ["d3"] }, "Combined");
    const s = useApp.getState();
    expect(newId).not.toBeNull();
    expect(s.workbooks.some((w) => w.id === newId && w.name === "Combined")).toBe(true);
    expect(s.datasets.every((d) => d.workbookId === newId)).toBe(true);
    // Source workbooks are NOT deleted (memberless-but-alive; PR M owns
    // workbook delete/prune machinery, not this PR).
    expect(s.workbooks.some((w) => w.id === "w1")).toBe(true);
    expect(s.workbooks.some((w) => w.id === "w2")).toBe(true);
  });

  it("preserves each worksheet's own source path/import time provenance untouched", () => {
    useApp.getState().combineWorkbooks({ workbookIds: ["w1"], worksheetIds: [] }, "Combined");
    const d1 = useApp.getState().datasets.find((d) => d.id === "d1");
    expect(d1?.source).toEqual({ kind: "path", path: "/x/run1_field.dat" });
    expect(d1?.importedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("suffixes a duplicate worksheet display name visibly rather than overwriting (L0.34)", () => {
    useApp.setState({
      datasets: [ds("d1", "data.dat", "w1"), ds("d2", "data.dat", "w2")],
      workbooks: [wb("w1", "A"), wb("w2", "B")],
    });
    useApp.getState().combineWorkbooks({ workbookIds: ["w1", "w2"], worksheetIds: [] }, "Combined");
    const names = useApp.getState().datasets.map((d) => d.name).sort();
    expect(names).toEqual(["data.dat", "data.dat (2)"]);
  });

  it("is a single undo entry restoring the pre-combine workbook/worksheet assignment exactly", () => {
    const preWorkbooks = useApp.getState().workbooks;
    const preDatasets = useApp.getState().datasets;
    useApp.getState().combineWorkbooks({ workbookIds: ["w1"], worksheetIds: ["d3"] }, "Combined");
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().workbooks).toBe(preWorkbooks);
    expect(useApp.getState().datasets).toBe(preDatasets);
  });

  it("refuses (zero mutation) on an empty selection", () => {
    const before = useApp.getState();
    const result = useApp.getState().combineWorkbooks({ workbookIds: [], worksheetIds: [] }, "Combined");
    expect(result).toBeNull();
    expect(useApp.getState().workbooks).toBe(before.workbooks);
    expect(useApp.getState().datasets).toBe(before.datasets);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("refuses (zero mutation) on a blank name", () => {
    const before = useApp.getState();
    const result = useApp.getState().combineWorkbooks({ workbookIds: ["w1"], worksheetIds: [] }, "   ");
    expect(result).toBeNull();
    expect(useApp.getState().workbooks).toBe(before.workbooks);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("trims the provided name", () => {
    const newId = useApp.getState().combineWorkbooks({ workbookIds: ["w1"], worksheetIds: [] }, "  Trimmed  ");
    expect(useApp.getState().workbooks.find((w) => w.id === newId)?.name).toBe("Trimmed");
  });
});
