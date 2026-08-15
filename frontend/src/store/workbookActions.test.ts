// LIBRARY_WORKBOOK_UX_PLAN PR C: the first workbook mutations.

import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "./useApp";
import { workbookDeleteBlockers } from "./workbookActions";
import { createFigureDocument } from "../lib/figureDocument";
import { defaultPlotView } from "../lib/plotview";
import type { ReportEntry } from "../lib/report";
import type { Dataset } from "../lib/types";
import type { WorkbookNode } from "../lib/workbooks";

type AppOriginFigure = ReturnType<typeof useApp.getState>["originFigures"][number];
type AppFigureDoc = ReturnType<typeof useApp.getState>["figureDocs"][number];

const wb = (id: string, folderId?: string): WorkbookNode => ({ id, name: `wb-${id}`, folderId });
const ds = (id: string, workbookId?: string, folderId?: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
  workbookId,
  folderId,
});

describe("workbookActions slice", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [ds("d1", "w1"), ds("d2", "w1"), ds("d3", "w2")],
      workbooks: [wb("w1"), wb("w2")],
      folders: [{ id: "f1", name: "Folder 1", parentId: null, order: 0 }],
      originFigures: [],
      editableFigures: [],
      figureDocs: [],
      reports: [],
      activeId: null,
      selectedIds: [],
      trash: [],
      history: [],
      future: [],
    });
  });

  describe("renameWorkbook", () => {
    it("renames the workbook", () => {
      useApp.getState().renameWorkbook("w1", "Renamed");
      expect(useApp.getState().workbooks.find((w) => w.id === "w1")?.name).toBe("Renamed");
    });

    it("trims whitespace", () => {
      useApp.getState().renameWorkbook("w1", "  Trimmed  ");
      expect(useApp.getState().workbooks.find((w) => w.id === "w1")?.name).toBe("Trimmed");
    });

    it("is a no-op on a blank name", () => {
      useApp.getState().renameWorkbook("w1", "   ");
      expect(useApp.getState().workbooks.find((w) => w.id === "w1")?.name).toBe("wb-w1");
      expect(useApp.getState().history).toHaveLength(0);
    });

    it("is undoable", () => {
      useApp.getState().renameWorkbook("w1", "Renamed");
      useApp.getState().undo();
      expect(useApp.getState().workbooks.find((w) => w.id === "w1")?.name).toBe("wb-w1");
    });
  });

  describe("moveWorkbookToFolder", () => {
    it("moves the workbook and syncs every member dataset's folderId", () => {
      useApp.getState().moveWorkbookToFolder("w1", "f1");
      const s = useApp.getState();
      expect(s.workbooks.find((w) => w.id === "w1")?.folderId).toBe("f1");
      expect(s.datasets.find((d) => d.id === "d1")?.folderId).toBe("f1");
      expect(s.datasets.find((d) => d.id === "d2")?.folderId).toBe("f1");
      // w2's own member is untouched.
      expect(s.datasets.find((d) => d.id === "d3")?.folderId).toBeUndefined();
    });

    it("moving to null clears folderId back to the Library root", () => {
      useApp.getState().moveWorkbookToFolder("w1", "f1");
      useApp.getState().moveWorkbookToFolder("w1", null);
      const s = useApp.getState();
      expect(s.workbooks.find((w) => w.id === "w1")?.folderId).toBeUndefined();
      expect(s.datasets.find((d) => d.id === "d1")?.folderId).toBeUndefined();
    });

    it("is undoable", () => {
      useApp.getState().moveWorkbookToFolder("w1", "f1");
      useApp.getState().undo();
      const s = useApp.getState();
      expect(s.workbooks.find((w) => w.id === "w1")?.folderId).toBeUndefined();
      expect(s.datasets.find((d) => d.id === "d1")?.folderId).toBeUndefined();
    });
  });

  describe("deleteWorkbook", () => {
    it("routes every member dataset through Trash (recoverable) and removes the node", () => {
      useApp.getState().deleteWorkbook("w1");
      const s = useApp.getState();
      expect(s.workbooks.map((w) => w.id)).toEqual(["w2"]);
      expect(s.datasets.map((d) => d.id)).toEqual(["d3"]);
      expect(s.trash.map((e) => e.dataset.id).sort()).toEqual(["d1", "d2"]);
    });

    it("a workbook with no members just removes the node (no Trash entries)", () => {
      useApp.setState({ workbooks: [...useApp.getState().workbooks, wb("empty")] });
      useApp.getState().deleteWorkbook("empty");
      expect(useApp.getState().workbooks.map((w) => w.id)).toEqual(["w1", "w2"]);
      expect(useApp.getState().trash).toHaveLength(0);
    });

    it("is a no-op for an unknown id", () => {
      useApp.getState().deleteWorkbook("nope");
      expect(useApp.getState().workbooks).toHaveLength(2);
      expect(useApp.getState().history).toHaveLength(0);
    });

    it("ONE history entry — a single Undo restores the workbook node AND its member datasets together (PR #139 review)", () => {
      useApp.getState().deleteWorkbook("w1");
      expect(useApp.getState().history.length).toBe(1); // one Delete, one Undo
      useApp.getState().undo();
      const s = useApp.getState();
      expect(s.workbooks.map((w) => w.id).sort()).toEqual(["w1", "w2"]);
      expect(s.datasets.map((d) => d.id).sort()).toEqual(["d1", "d2", "d3"]);
      expect(s.datasets.filter((d) => d.workbookId === "w1").map((d) => d.id).sort()).toEqual(["d1", "d2"]); // membership intact
    });
  });

  describe("deleteWorkbook — L0.45 dependent gate (PR #139 review)", () => {
    // A dependent artifact referencing ANY member disables Delete entirely:
    // the state must be unchanged afterwards (no trash, no history snapshot)
    // and workbookDeleteBlockers names the reason the menu shows. One case
    // per artifact kind the gate covers.
    const originFig = (datasetId: string): AppOriginFigure => ({
      id: "g1",
      stem: "Moke",
      datasetId,
      siblingIds: [datasetId],
      figure: { name: "G", x_from: 0, x_to: 1, x_log: false, y_from: 0, y_to: 1, y_log: false, n_curves: 1, annotations: [] },
    });
    const report = (datasetId: string): ReportEntry => ({
      id: "r1",
      name: "R",
      datasetId,
      report: { title: "R", sections: [] },
    });
    const pubFig = (datasetId: string): AppFigureDoc => ({
      id: "p1",
      name: "P",
      datasetId,
      live: true,
      config: { xKey: null, yKeys: null, xScale: "linear", yScale: "linear", title: "", xLabel: "", yLabel: "", style: "line", fmt: "png", dpi: 150, overrides: null, seriesStyles: null },
    });

    const dependents: Array<[string, () => void]> = [
      ["recovered Origin figure", () => useApp.setState({ originFigures: [originFig("d1")] })],
      ["report", () => useApp.setState({ reports: [report("d2")] })],
      ["publication figure binding", () => useApp.setState({ figureDocs: [pubFig("d1")] })],
      ["editable figure binding", () => useApp.setState({
        editableFigures: [createFigureDocument({ id: "e1", name: "E", datasetId: "d1", view: defaultPlotView() })],
      })],
    ];

    it.each(dependents)("a %s referencing a member disables Delete — state unchanged", (_kind, seed) => {
      seed();
      const before = useApp.getState().datasets;
      expect(workbookDeleteBlockers(useApp.getState(), "w1")).toMatch(/PR M/);
      useApp.getState().deleteWorkbook("w1");
      const s = useApp.getState();
      expect(s.workbooks.map((w) => w.id)).toEqual(["w1", "w2"]);
      expect(s.datasets).toBe(before); // untouched — not even a new array
      expect(s.trash).toHaveLength(0);
      expect(s.history).toHaveLength(0); // no snapshot recorded for a refused delete
    });

    it("dependents on a DIFFERENT workbook's members do not block", () => {
      useApp.setState({ reports: [report("d3")] }); // d3 belongs to w2
      expect(workbookDeleteBlockers(useApp.getState(), "w1")).toBeNull();
      useApp.getState().deleteWorkbook("w1");
      expect(useApp.getState().workbooks.map((w) => w.id)).toEqual(["w2"]);
    });
  });
});
