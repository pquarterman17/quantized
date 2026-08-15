// LIBRARY_WORKBOOK_UX_PLAN PR C: the first workbook mutations.

import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "./useApp";
import type { WorkbookNode } from "../lib/workbooks";
import type { Dataset } from "../lib/types";

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

    it("is undoable — two undo presses restore the datasets and the workbook node", () => {
      useApp.getState().deleteWorkbook("w1");
      expect(useApp.getState().history.length).toBe(2); // removeDatasets + delete workbook
      useApp.getState().undo(); // restores the workbook node
      useApp.getState().undo(); // restores the member datasets (out of Trash)
      const s = useApp.getState();
      expect(s.workbooks.map((w) => w.id).sort()).toEqual(["w1", "w2"]);
      expect(s.datasets.map((d) => d.id).sort()).toEqual(["d1", "d2", "d3"]);
    });
  });
});
