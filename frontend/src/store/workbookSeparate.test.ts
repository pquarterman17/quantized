// Red-first store tests for LIBRARY_WORKBOOK_UX_PLAN PR J slice 1 — separate
// (L0.51), against the real `useApp` store (undo/history + the required
// preview-before-commit gate included).

import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "./useApp";
import type { Dataset } from "../lib/types";
import type { WorkbookNode } from "../lib/workbooks";
import type { ReportEntry } from "../lib/report";

const wb = (id: string, name: string, folderId?: string): WorkbookNode => ({ id, name, folderId });
const ds = (id: string, name: string, workbookId: string | undefined, extra: Partial<Dataset> = {}): Dataset => ({
  id,
  name,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
  workbookId,
  ...extra,
});
const report = (id: string, datasetId: string | null): ReportEntry => ({
  id, name: id, datasetId, report: { title: id, sections: [] },
});

describe("workbookSeparate slice", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [ds("d1", "A.dat", "w1"), ds("d2", "B.dat", "w1")],
      workbooks: [wb("w1", "Source", "f1")],
      folders: [{ id: "f1", name: "Folder", parentId: null, order: 0 }],
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
      separatePreview: null,
    });
  });

  describe("previewSeparateWorksheets", () => {
    it("computes a plan without mutating datasets/workbooks", () => {
      const before = useApp.getState();
      useApp.getState().previewSeparateWorksheets(["d1"]);
      const s = useApp.getState();
      expect(s.datasets).toBe(before.datasets);
      expect(s.workbooks).toBe(before.workbooks);
      expect(s.separatePreview).not.toBeNull();
      expect(s.separatePreview?.movingDatasetIds).toEqual(["d1"]);
      expect(s.history).toHaveLength(0); // preview is not an edit
    });

    it("carries the source workbook's own folder as the new workbook's suggested folder", () => {
      useApp.getState().previewSeparateWorksheets(["d1"]);
      expect(useApp.getState().separatePreview?.newWorkbookFolderId).toBe("f1");
    });
  });

  describe("commitSeparateWorksheets", () => {
    it("refuses with no open preview (preview-before-commit is mandatory)", () => {
      const before = useApp.getState();
      const result = useApp.getState().commitSeparateWorksheets();
      expect(result).toBeNull();
      expect(useApp.getState().workbooks).toBe(before.workbooks);
      expect(useApp.getState().history).toHaveLength(0);
    });

    it("applies exactly the previewed plan: new workbook, moving dataset(s) reassigned, one history entry", () => {
      useApp.getState().previewSeparateWorksheets(["d1"]);
      const newId = useApp.getState().commitSeparateWorksheets();
      const s = useApp.getState();
      expect(newId).not.toBeNull();
      expect(s.workbooks.some((w) => w.id === newId && w.folderId === "f1")).toBe(true);
      expect(s.datasets.find((d) => d.id === "d1")?.workbookId).toBe(newId);
      expect(s.datasets.find((d) => d.id === "d2")?.workbookId).toBe("w1"); // untouched
      expect(s.workbooks.some((w) => w.id === "w1")).toBe(true); // source workbook survives, memberless-but-alive
      expect(s.history).toHaveLength(1);
      expect(s.separatePreview).toBeNull(); // preview clears after commit
    });

    it("moves an exclusively-dependent report along with the separated worksheet", () => {
      useApp.setState({ reports: [report("r1", "d1")] });
      useApp.getState().previewSeparateWorksheets(["d1"]);
      const newId = useApp.getState().commitSeparateWorksheets();
      // The report itself carries no workbookId (placement is derived) — the
      // plan/commit contract is that the DATASET move is the only mutation;
      // this assertion locks that in so a future change can't start writing
      // a field on ReportEntry that doesn't exist.
      expect(useApp.getState().reports[0].datasetId).toBe("d1");
      expect(useApp.getState().datasets.find((d) => d.id === "d1")?.workbookId).toBe(newId);
    });

    it("an explicit name overrides the plan's suggested default", () => {
      useApp.getState().previewSeparateWorksheets(["d1"]);
      const newId = useApp.getState().commitSeparateWorksheets("Custom Name");
      expect(useApp.getState().workbooks.find((w) => w.id === newId)?.name).toBe("Custom Name");
    });

    it("undo restores the pre-separate workbook/worksheet assignment exactly", () => {
      const preWorkbooks = useApp.getState().workbooks;
      const preDatasets = useApp.getState().datasets;
      useApp.getState().previewSeparateWorksheets(["d1"]);
      useApp.getState().commitSeparateWorksheets();
      useApp.getState().undo();
      expect(useApp.getState().workbooks).toBe(preWorkbooks);
      expect(useApp.getState().datasets).toBe(preDatasets);
    });

    it("fails closed (zero mutation) if a previewed worksheet vanished before commit", () => {
      useApp.getState().previewSeparateWorksheets(["d1"]);
      // Simulate a race: d1 got removed after the preview opened.
      useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "d1") }));
      const before = useApp.getState();
      const result = useApp.getState().commitSeparateWorksheets();
      expect(result).toBeNull();
      expect(useApp.getState().workbooks).toBe(before.workbooks);
      expect(useApp.getState().datasets).toBe(before.datasets);
      expect(useApp.getState().history).toHaveLength(0);
    });
  });

  describe("closeSeparatePreview", () => {
    it("clears the preview without mutating datasets/workbooks", () => {
      useApp.getState().previewSeparateWorksheets(["d1"]);
      useApp.getState().closeSeparatePreview();
      expect(useApp.getState().separatePreview).toBeNull();
      expect(useApp.getState().history).toHaveLength(0);
    });
  });
});
