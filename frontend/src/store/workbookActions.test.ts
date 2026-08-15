// LIBRARY_WORKBOOK_UX_PLAN PR C: the first workbook mutations.

import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "./useApp";
import { workbookDeleteBlockers } from "./workbookActions";
import { createFigureDocument } from "../lib/figureDocument";
import { defaultPlotView } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import type { WorkbookNode } from "../lib/workbooks";

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

  describe("deleteWorkbook — fail-closed until PR M (PR #139 review, round 3)", () => {
    // Both prior reviews drew this boundary: EITHER an atomic workbook-aware
    // Trash package OR disable until PR M. Trash today stores only Dataset
    // snapshots, so even a dependent-free delete loses the grouping — the
    // command is therefore disabled unconditionally, and the store action
    // fails closed so no caller can bypass the UI gate.
    it("reports the stable disabled reason regardless of dependents", () => {
      expect(workbookDeleteBlockers(useApp.getState(), "w1")).toBe(
        "Workbook Delete arrives with dependency-aware Trash (PR M)",
      );
      useApp.setState({
        editableFigures: [createFigureDocument({ id: "e1", name: "E", datasetId: "d1", view: defaultPlotView() })],
      });
      expect(workbookDeleteBlockers(useApp.getState(), "w1")).toMatch(/PR M/);
    });

    it("a direct deleteWorkbook call leaves state byte-for-byte unchanged — zero dependents included", () => {
      const before = useApp.getState();
      useApp.getState().deleteWorkbook("w1");
      const s = useApp.getState();
      expect(s.workbooks).toBe(before.workbooks); // untouched references, not just equal values
      expect(s.datasets).toBe(before.datasets);
      expect(s.trash).toHaveLength(0);
      expect(s.history).toHaveLength(0); // no snapshot recorded for a refused delete
    });

    it("ordinary standalone worksheet delete -> Trash -> restore stays green (unchanged path)", () => {
      useApp.getState().removeDatasets(["d3"]);
      expect(useApp.getState().trash.map((e) => e.dataset.id)).toEqual(["d3"]);
      useApp.getState().restoreFromTrash("d3");
      expect(useApp.getState().datasets.some((d) => d.id === "d3")).toBe(true);
      expect(useApp.getState().trash).toHaveLength(0);
    });
  });
});
