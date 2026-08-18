// LIBRARY_WORKBOOK_UX_PLAN PR C: the first workbook mutations.

import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "./useApp";
import { workbookDeleteBlockers } from "./workbookActions";
import { createFigureDocument } from "../lib/figureDocument";
import { defaultPlotView } from "../lib/plotview";
import {
  buildQuickPlotTemplateSignature,
  captureQuickPlotTemplateLabels,
  type QuickPlotTemplate,
} from "../lib/quickPlotTemplates";
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

/** A minimal workbook-scoped Quick Plot template (PR H) for the PR M
 *  delete-time pruning tests — mirrors lib/quickPlotTemplates.test.ts's
 *  own `template()` fixture. */
function quickPlotTemplate(id: string, workbookId: string): QuickPlotTemplate {
  const dataset = ds("fixture");
  const mapping = { xKey: 0, yKeys: [1], errorBindings: [], ignoredKeys: [] };
  return {
    id,
    name: id,
    createdAt: "2026-08-19T00:00:00.000Z",
    modifiedAt: "2026-08-19T00:00:00.000Z",
    scope: { kind: "workbook", workbookId },
    technique: "generic",
    signature: buildQuickPlotTemplateSignature(dataset),
    mapping,
    style: "line",
    labels: captureQuickPlotTemplateLabels(dataset, mapping),
  };
}

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
      quickPlotTemplates: [],
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

  describe("deleteWorkbook — dependency-aware, LIFTED (PR M, L0.45)", () => {
    // The unconditional fail-closed gate a prior review drew is lifted:
    // workbookDeleteBlockers always returns null now (the confirm dialog is
    // the real L0.45 gate — see lib/workbookContextActions.ts).
    it("workbookDeleteBlockers always returns null, regardless of dependents", () => {
      expect(workbookDeleteBlockers(useApp.getState(), "w1")).toBeNull();
      useApp.setState({
        editableFigures: [createFigureDocument({ id: "e1", name: "E", datasetId: "d1", view: defaultPlotView() })],
      });
      expect(workbookDeleteBlockers(useApp.getState(), "w1")).toBeNull();
    });

    it("deletes the workbook and moves its members to Trash in ONE history entry", () => {
      useApp.getState().deleteWorkbook("w1");
      const s = useApp.getState();
      expect(s.workbooks.map((w) => w.id)).toEqual(["w2"]);
      expect(s.datasets.map((d) => d.id)).toEqual(["d3"]);
      expect(s.trash.map((e) => e.dataset.id).sort()).toEqual(["d1", "d2"]);
      expect(s.history).toHaveLength(1);
    });

    // "undo happens at source, not from trash" (architecture.test.ts's
    // HISTORY_EXCLUDED doc for `trash`) — a PRE-EXISTING, deliberate
    // convention this test follows, not something PR M changes: undo
    // restores workbooks/datasets/quickPlotTemplates (the real "source"),
    // the same single step every other delete-then-undo path in this
    // codebase already uses.
    it("undo restores the workbook, members, and templates together in one step", () => {
      const before = useApp.getState();
      useApp.getState().deleteWorkbook("w1");
      useApp.getState().undo();
      const s = useApp.getState();
      expect(s.workbooks).toEqual(before.workbooks);
      expect(s.datasets).toEqual(before.datasets);
    });

    // PR H booked finding: pruning a workbook-scoped Quick Plot template
    // when its owning workbook is actually DELETED is PR M's job (H only
    // handles the load-time-dangling and memberless-but-alive cases).
    it("prunes workbook-scoped Quick Plot templates naming the deleted workbook", () => {
      useApp.setState({
        quickPlotTemplates: [
          quickPlotTemplate("t-w1", "w1"), // scoped to the workbook being deleted
          quickPlotTemplate("t-w2", "w2"), // scoped to a DIFFERENT, still-alive workbook
        ],
      });
      useApp.getState().deleteWorkbook("w1");
      expect(useApp.getState().quickPlotTemplates.map((t) => t.id)).toEqual(["t-w2"]);
    });

    it("leaves schema-scoped templates untouched (they never name a workbook)", () => {
      useApp.setState({
        quickPlotTemplates: [{ ...quickPlotTemplate("t-schema", "w1"), scope: { kind: "schema" } }],
      });
      useApp.getState().deleteWorkbook("w1");
      expect(useApp.getState().quickPlotTemplates.map((t) => t.id)).toEqual(["t-schema"]);
    });

    it("undo also restores a pruned template (rides the same atomic set())", () => {
      useApp.setState({ quickPlotTemplates: [quickPlotTemplate("t-w1", "w1")] });
      useApp.getState().deleteWorkbook("w1");
      expect(useApp.getState().quickPlotTemplates).toHaveLength(0);
      useApp.getState().undo();
      expect(useApp.getState().quickPlotTemplates.map((t) => t.id)).toEqual(["t-w1"]);
    });

    it("a nonexistent workbook id is a no-op", () => {
      const before = useApp.getState();
      useApp.getState().deleteWorkbook("ghost");
      const s = useApp.getState();
      expect(s.workbooks).toBe(before.workbooks);
      expect(s.datasets).toBe(before.datasets);
      expect(s.history).toHaveLength(0);
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
