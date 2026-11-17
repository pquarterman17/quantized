// Collapsed single-sheet workbook rows: bulk remove prunes emptied workbooks,
// rename refusal is a clean no-op, and Move never drags unselected siblings.

import { beforeEach, describe, expect, it } from "vitest";

import { renameCollapsedWorkbook, moveToFolderViaWorkbooks } from "./collapsedWorkbookActions";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";
import type { Dataset } from "../lib/types";
import type { WorkbookNode } from "../lib/workbooks";

const wb = (id: string): WorkbookNode => ({ id, name: `wb-${id}` });
const ds = (id: string, workbookId: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
  workbookId,
});

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useApp.setState({
    folders: [{ id: "f1", name: "F", parentId: null, order: 0 }],
    workbooks: [wb("w1"), wb("w2"), wb("w3")],
    datasets: [ds("a", "w1"), ds("b", "w2"), ds("c", "w3"), ds("d", "w3")],
    selectedIds: [], activeId: null, trash: [], history: [], future: [],
  });
});

describe("removeDatasets prunes workbooks it empties", () => {
  it("drops childless workbooks, keeps one that still has a sheet, in one undo step", () => {
    useApp.getState().removeDatasets(["a", "b", "c"]);
    let s = useApp.getState();
    expect(s.workbooks.map((w) => w.id)).toEqual(["w3"]); // d keeps w3 alive
    expect(s.history).toHaveLength(1);
    s.undo();
    s = useApp.getState();
    expect(s.workbooks.map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
    expect(s.datasets.map((d) => d.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("removeDatasets([a]) leaves no empty w1, and leaves unrelated pre-existing workbooks alone", () => {
    useApp.setState({ workbooks: [wb("w1"), wb("w2"), wb("lonely")] });
    useApp.getState().removeDatasets(["a"]);
    expect(useApp.getState().workbooks.map((w) => w.id)).toEqual(["w2", "lonely"]);
  });
});

describe("moveToFolderViaWorkbooks", () => {
  it("moves collapsed rows' workbooks and leaves a multi-sheet book's selected sheet (and sibling) put", () => {
    const stays = moveToFolderViaWorkbooks(["a", "c"], "f1");
    const s = useApp.getState();
    expect(stays).toBe(1);
    expect(s.workbooks.map((w) => w.folderId)).toEqual(["f1", undefined, undefined]);
    expect(s.datasets.map((d) => d.folderId)).toEqual(["f1", undefined, undefined, undefined]);
    expect(useToasts.getState().toasts.some((t) => /1 sheet stays with its workbook/.test(t.msg))).toBe(true);
  });

  it("moves a multi-sheet workbook when every sheet of it is selected", () => {
    expect(moveToFolderViaWorkbooks(["c", "d"], "f1")).toBe(0);
    expect(useApp.getState().workbooks.find((w) => w.id === "w3")!.folderId).toBe("f1");
  });
});

describe("renameCollapsedWorkbook", () => {
  it("renames workbook and sheet together", () => {
    renameCollapsedWorkbook("a", "w1", "Fresh");
    const s = useApp.getState();
    expect(s.workbooks[0].name).toBe("Fresh");
    expect(s.datasets[0].name).toBe("Fresh");
    expect(s.history).toHaveLength(1);
  });

  it("a refused sheet rename leaves the workbook untouched and records no undo entry", () => {
    // Force the refusal: the store action declines and reports, as renameRefusal does.
    useApp.setState({ renameDataset: (() => useApp.getState().setStatus("refused")) as never });
    renameCollapsedWorkbook("a", "w1", "Fresh");
    const s = useApp.getState();
    expect(s.workbooks[0].name).toBe("wb-w1");
    expect(s.datasets[0].name).toBe("a.dat");
    expect(s.history).toHaveLength(0);
  });
});
