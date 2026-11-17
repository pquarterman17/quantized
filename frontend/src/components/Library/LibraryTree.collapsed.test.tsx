// UX8-I: a workbook holding exactly one sheet and nothing else renders as ONE
// Library row (lib/libraryHierarchy's collapsedSheetOf). PR #741 did this with a
// plain DatasetRow and was reverted for four regressions; each has a test here:
//   1. drag / "Move to folder" must move the WORKBOOK (a sheet's placement
//      follows its workbook; FolderRow only accepts WORKBOOK_DND),
//   2. the shown count must not double,
//   3. (one policy everywhere -- Library.collapsed.test.tsx covers the filtered/
//      focused Tree and Details),
//   4. the workbook-only actions and the workbook selection highlight survive.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryTree from "./LibraryTree";
import { DATASET_DND, WORKBOOK_DND } from "./dnd";
import { useLibraryHierarchyRows } from "./useLibraryHierarchyRows";
import type { Dataset, FolderNode } from "../../lib/types";
import type { WorkbookNode } from "../../lib/workbooks";
import { askConfirm } from "../overlays/ConfirmDialog";
import { useApp } from "../../store/useApp";

vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const folder: FolderNode = { id: "f1", name: "Project", parentId: null, order: 0 };
const ds = (id: string, workbookId: string, name = `${id}.csv`): Dataset => ({
  id,
  name,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
  workbookId,
});
const wb = (id: string, name = id): WorkbookNode => ({ id, name });

function Harness() {
  const rows = useLibraryHierarchyRows();
  return <LibraryTree rows={rows} onFilterTag={() => {}} />;
}
const sheetRow = (id: string): HTMLElement => document.querySelector(`[data-ds-id="${id}"]`) as HTMLElement;
const folderRow = (id: string): HTMLElement => document.querySelector(`[data-lib-row="folder:${id}"]`) as HTMLElement;

/** A dataTransfer stub that remembers what the drag source stored. */
function makeTransfer() {
  const data: Record<string, string> = {};
  return {
    data,
    effectAllowed: "",
    get types() { return Object.keys(data); },
    setData: (t: string, v: string) => { data[t] = v; },
    getData: (t: string) => data[t] ?? "",
  };
}
function fire(el: Element, type: string, dataTransfer: unknown) {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dataTransfer, configurable: true });
  Object.defineProperty(evt, "clientX", { value: 10, configurable: true });
  Object.defineProperty(evt, "clientY", { value: 120, configurable: true });
  fireEvent(el, evt);
}

beforeEach(() => {
  useApp.setState({
    folders: [folder],
    workbooks: [wb("w1", "data"), wb("w2", "other")],
    datasets: [ds("d1", "w1", "data.csv"), ds("d2", "w2", "other.csv")],
    expandedFolders: ["f1"],
    expandedWorkbookIds: [],
    librarySelection: null,
    workbookLastChild: {},
    activeId: null,
    selectedIds: [],
    trash: [],
    history: [],
    confirmRemove: false,
  });
  vi.mocked(askConfirm).mockReset().mockResolvedValue(true);
});

describe("one row per single-sheet workbook", () => {
  it("renders the sheet only: no workbook header, no second row", () => {
    render(<Harness />);
    expect(document.querySelector('[data-lib-row^="workbook:"]')).toBeNull();
    expect(screen.getAllByRole("treeitem").map((el) => el.getAttribute("aria-label"))).toEqual(["Project", "data.csv", "other.csv"]);
    // The workbook's own row key is carried for reveal/focus lookups.
    expect(sheetRow("d1").getAttribute("data-lib-wb")).toBe("workbook:w1");
  });

  it("re-expands when the workbook gains a second sheet", () => {
    render(<Harness />);
    act(() => useApp.setState((s) => ({ datasets: [...s.datasets, ds("d1b", "w1", "second.csv")] })));
    expect(document.querySelector('[data-lib-row="workbook:w1"]')).not.toBeNull();
    expect(sheetRow("d1")).toBeNull(); // a real workbook again: its sheets sit under the caret
    act(() => useApp.setState({ expandedWorkbookIds: ["w1"] }));
    expect(sheetRow("d1").hasAttribute("data-lib-wb")).toBe(false);
  });
});

describe("regression 1: drag and Move to folder move the WORKBOOK", () => {
  it("the grip emits WORKBOOK_DND (plus the sheet's DATASET_DND for plot windows)", () => {
    render(<Harness />);
    const dt = makeTransfer();
    fire(sheetRow("d2").querySelector(".qzk-drag-handle")!, "dragstart", dt);
    expect(dt.data[WORKBOOK_DND]).toBe("w2");
    expect(dt.data[DATASET_DND]).toBe("d2");
  });

  it("dropping the grip's payload on a folder moves the workbook and its sheet", () => {
    render(<Harness />);
    const dt = makeTransfer();
    fire(sheetRow("d2").querySelector(".qzk-drag-handle")!, "dragstart", dt);
    fire(folderRow("f1"), "drop", dt);
    const s = useApp.getState();
    expect(s.workbooks.find((w) => w.id === "w2")!.folderId).toBe("f1");
    expect(s.datasets.find((d) => d.id === "d2")!.folderId).toBe("f1");
  });

  it("the menu's Move to folder moves the workbook (a dataset move would no-op)", () => {
    render(<Harness />);
    fireEvent.contextMenu(sheetRow("d2"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByText('Move to "Project"'));
    expect(useApp.getState().workbooks.find((w) => w.id === "w2")!.folderId).toBe("f1");
    expect(useApp.getState().datasets.find((d) => d.id === "d2")!.folderId).toBe("f1");
  });

  it("a multi-selection's Move acts on every selected row's workbook", () => {
    render(<Harness />);
    act(() => useApp.getState().selectIds(["d1", "d2"]));
    fireEvent.contextMenu(sheetRow("d1"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByText('Move 2 selected to "Project"'));
    expect(useApp.getState().workbooks.map((w) => w.folderId)).toEqual(["f1", "f1"]);
  });
});

describe("regression 4: workbook actions and selection", () => {
  const menuLabels = (): string[] => screen.getAllByRole("menuitem").map((el) => el.textContent ?? "");

  it("the row menu merges the workbook's actions with the dataset's", () => {
    render(<Harness />);
    fireEvent.contextMenu(sheetRow("d1"), { clientX: 5, clientY: 5 });
    const labels = menuLabels();
    for (const want of [
      "Rename workbook…", "Reimport All", "Reimport Available Sources", "Browse", "Combine…",
      "Copy", "Duplicate", "Reveal Source", "Properties…", "Delete", "Quick Plot",
      "Plot (make active)", "Add tag…",
    ]) expect(labels.some((l) => l.startsWith(want))).toBe(true);
    // Each shared entry appears once: the workbook's Rename/Duplicate replace the sheet's.
    expect(labels.filter((l) => l.startsWith("Rename"))).toHaveLength(1);
    expect(labels.filter((l) => l === "Duplicate")).toHaveLength(1);
  });

  it("Rename workbook renames the workbook and the sheet together, in one Undo step", () => {
    render(<Harness />);
    fireEvent.contextMenu(sheetRow("d1"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByText("Rename workbook…"));
    const input = document.querySelector(".qzk-ds-name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    let s = useApp.getState();
    expect(s.workbooks.find((w) => w.id === "w1")!.name).toBe("Renamed");
    expect(s.datasets.find((d) => d.id === "d1")!.name).toBe("Renamed");
    expect(sheetRow("d1")).toHaveTextContent("Renamed");
    act(() => s.undo());
    s = useApp.getState();
    expect(s.workbooks.find((w) => w.id === "w1")!.name).toBe("data");
    expect(s.datasets.find((d) => d.id === "d1")!.name).toBe("data.csv");
  });

  it("a workbook selection highlights the collapsed row", () => {
    render(<Harness />);
    act(() => useApp.getState().setLibrarySelection({ kind: "workbook", id: "w1" }));
    expect(sheetRow("d1")).toHaveAttribute("aria-selected", "true");
    expect(sheetRow("d1").className).toContain("selected");
    expect(sheetRow("d2")).toHaveAttribute("aria-selected", "false");
  });

  it("Delete from the menu deletes the workbook and its sheet", async () => {
    render(<Harness />);
    fireEvent.contextMenu(sheetRow("d1"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByText("Delete"));
    expect(askConfirm).toHaveBeenCalledOnce();
    await act(() => Promise.resolve());
    const s = useApp.getState();
    expect(s.workbooks.some((w) => w.id === "w1")).toBe(false);
    expect(s.datasets.some((d) => d.id === "d1")).toBe(false);
  });

  it("Delete on the focused row does the same through the keyboard", async () => {
    render(<Harness />);
    sheetRow("d1").focus();
    fireEvent.keyDown(sheetRow("d1"), { key: "Delete" });
    expect(askConfirm).toHaveBeenCalledOnce();
    await act(() => Promise.resolve());
    expect(useApp.getState().workbooks.some((w) => w.id === "w1")).toBe(false);
  });
});

describe("selection gestures behave as dataset rows (UX8-C)", () => {
  it("click selects, Shift-click ranges over the rows as shown, double-click opens", () => {
    render(<Harness />);
    fireEvent.click(sheetRow("d1"));
    expect(useApp.getState().selectedIds).toEqual(["d1"]);
    fireEvent.click(sheetRow("d2"), { shiftKey: true });
    expect(useApp.getState().selectedIds).toEqual(["d1", "d2"]);
    fireEvent.doubleClick(sheetRow("d2"));
    expect(useApp.getState().activeId).toBe("d2");
  });

  it("Ctrl+A selects every collapsed row's sheet", () => {
    render(<Harness />);
    sheetRow("d1").focus();
    fireEvent.keyDown(sheetRow("d1"), { key: "a", ctrlKey: true });
    expect(useApp.getState().selectedIds).toEqual(["d1", "d2"]);
  });

  it("ArrowLeft from the row goes to its folder (the workbook's parent)", () => {
    useApp.setState((s) => ({ workbooks: s.workbooks.map((w) => (w.id === "w1" ? { ...w, folderId: "f1" } : w)) }));
    render(<Harness />);
    sheetRow("d1").focus();
    fireEvent.keyDown(sheetRow("d1"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(folderRow("f1"));
  });
});
