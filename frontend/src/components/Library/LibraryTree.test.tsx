// LIBRARY_WORKBOOK_UX_PLAN PR C: keyboard traversal, focus-survives-removal,
// and Origin multi-sheet ordering over the flattened hierarchy. Mouse vs
// disclosure separation and the remembered-child open live in
// WorkbookRow.test.tsx; this file covers the container-level roving focus
// and the render dispatch across kinds.
//
// LibraryTree takes `rows` as a prop (computed once by Library.tsx via
// useLibraryHierarchyRows) rather than owning the hook itself — this harness
// mirrors that exact wiring so the test exercises the real reactive path
// (expansion toggles re-flattening the hierarchy) instead of a frozen array.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import LibraryTree from "./LibraryTree";
import { useLibraryHierarchyRows } from "./useLibraryHierarchyRows";
import { createFigureDocument } from "../../lib/figureDocument";
import { defaultPlotView } from "../../lib/plotview";
import type { Dataset, FolderNode } from "../../lib/types";
import type { WorkbookNode } from "../../lib/workbooks";
import { useApp } from "../../store/useApp";

const fld = (id: string, parentId: string | null = null): FolderNode => ({ id, name: id, parentId, order: 0 });
const wb = (id: string, folderId?: string): WorkbookNode => ({ id, name: id, folderId });
const ds = (id: string, workbookId?: string, originBook?: string, order?: number): Dataset => ({
  id,
  name: `${id}.dat`,
  data: {
    time: [0, 1],
    values: [[1], [2]],
    labels: ["M"],
    units: [""],
    metadata: originBook ? { origin_book: originBook } : {},
  },
  ...(workbookId ? { workbookId } : {}),
  ...(order !== undefined ? { order } : {}),
});

const noop = () => {};

function Harness() {
  const rows = useLibraryHierarchyRows();
  return <LibraryTree rows={rows} onFilterTag={noop} />;
}

const folderRow = (id: string): HTMLElement => document.querySelector(`[data-lib-row="folder:${id}"]`) as HTMLElement;
const workbookRow = (id: string): HTMLElement => document.querySelector(`[data-lib-row="workbook:${id}"]`) as HTMLElement;
const worksheetRow = (id: string): HTMLElement => document.querySelector(`[data-ds-id="${id}"]`) as HTMLElement;

beforeEach(() => {
  useApp.setState({
    folders: [],
    workbooks: [],
    datasets: [],
    originFigures: [],
    editableFigures: [],
    figureDocs: [],
    pages: [],
    reports: [],
    expandedFolders: [],
    expandedWorkbookIds: [],
    librarySelection: null,
    workbookLastChild: {},
    activeId: null,
    selectedIds: [],
  });
});

describe("LibraryTree — keyboard traversal (Up/Down/Left/Right/Enter)", () => {
  beforeEach(() => {
    useApp.setState({
      folders: [fld("f1")],
      workbooks: [wb("w1", "f1")],
      datasets: [ds("d1", "w1"), ds("d2", "w1")],
      expandedFolders: ["f1"],
      expandedWorkbookIds: [],
    });
  });

  it("Down moves folder -> workbook; Right expands the collapsed workbook in place (no focus move); a second Right moves into its first child", () => {
    render(<Harness />);
    folderRow("f1").focus();
    fireEvent.keyDown(folderRow("f1"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(workbookRow("w1"));

    fireEvent.keyDown(workbookRow("w1"), { key: "ArrowRight" });
    expect(useApp.getState().expandedWorkbookIds).toContain("w1");
    expect(document.activeElement).toBe(workbookRow("w1")); // no focus move yet

    fireEvent.keyDown(workbookRow("w1"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(worksheetRow("d1")); // first child, source order
  });

  it("Down/Up traverse sibling worksheets once the workbook is expanded", () => {
    useApp.setState({ expandedWorkbookIds: ["w1"] });
    render(<Harness />);
    worksheetRow("d1").focus();
    fireEvent.keyDown(worksheetRow("d1"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(worksheetRow("d2"));
    fireEvent.keyDown(worksheetRow("d2"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(worksheetRow("d1"));
  });

  it("Left on a leaf worksheet moves to its parent workbook", () => {
    useApp.setState({ expandedWorkbookIds: ["w1"] });
    render(<Harness />);
    worksheetRow("d1").focus();
    fireEvent.keyDown(worksheetRow("d1"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(workbookRow("w1"));
  });

  it("Left on an expanded workbook collapses it in place (no focus move)", () => {
    useApp.setState({ expandedWorkbookIds: ["w1"] });
    render(<Harness />);
    workbookRow("w1").focus();
    fireEvent.keyDown(workbookRow("w1"), { key: "ArrowLeft" });
    expect(useApp.getState().expandedWorkbookIds).not.toContain("w1");
    expect(document.activeElement).toBe(workbookRow("w1"));
  });

  it("Enter on a workbook opens its remembered/first child (same as double-click)", () => {
    render(<Harness />);
    workbookRow("w1").focus();
    fireEvent.keyDown(workbookRow("w1"), { key: "Enter" });
    expect(useApp.getState().activeId).toBe("d1");
  });

  it("Enter on a worksheet activates it, mirroring a click", () => {
    useApp.setState({ expandedWorkbookIds: ["w1"] });
    render(<Harness />);
    worksheetRow("d2").focus();
    fireEvent.keyDown(worksheetRow("d2"), { key: "Enter" });
    expect(useApp.getState().activeId).toBe("d2");
  });

  it("Down/Up are no-ops at either end of the flattened list", () => {
    render(<Harness />);
    folderRow("f1").focus();
    fireEvent.keyDown(folderRow("f1"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(folderRow("f1"));
  });

  it("Escape blurs the focused row", () => {
    render(<Harness />);
    folderRow("f1").focus();
    expect(document.activeElement).toBe(folderRow("f1"));
    fireEvent.keyDown(folderRow("f1"), { key: "Escape" });
    expect(document.activeElement).not.toBe(folderRow("f1"));
  });
});

describe("LibraryTree — focus survives removal of the focused row", () => {
  it("falls back to the nearest surviving row by previous position", () => {
    useApp.setState({ datasets: [ds("d1"), ds("d2"), ds("d3")] });
    render(<Harness />);
    worksheetRow("d2").focus();
    expect(document.activeElement).toBe(worksheetRow("d2"));
    act(() => {
      useApp.getState().removeDataset("d2");
    });
    expect(document.activeElement).toBe(worksheetRow("d3")); // took d2's old index
  });

  it("never steals focus that moved elsewhere for an unrelated reason", () => {
    useApp.setState({ datasets: [ds("d1"), ds("d2")] });
    render(
      <>
        <input aria-label="elsewhere" />
        <Harness />
      </>,
    );
    worksheetRow("d1").focus();
    screen.getByLabelText("elsewhere").focus();
    act(() => {
      useApp.getState().removeDataset("d1");
    });
    expect(document.activeElement).toBe(screen.getByLabelText("elsewhere"));
  });
});

describe("LibraryTree — Origin multi-sheet ordering (L0.16)", () => {
  // lib/libraryHierarchy.ts (PR B) orders worksheet children by the generic
  // `Dataset.order` field via lib/order.ts's byOrder — it has no Origin-
  // specific sheet-number comparator of its own (confirmed against
  // libraryHierarchy.test.ts's own ordering fixtures). This proves the tree
  // renders whatever order that field encodes; datasets carry `.order` set
  // to their sheet position, matching what a sheet-sorted membership (PR
  // A1's deriveWorkbooks already sorts `sortedMembers` by origin sheet
  // number) is expected to stamp.
  it("renders sheets in sheet-number order regardless of input/insertion order", () => {
    // Deliberately scrambled INSERTION order but correctly-keyed `.order` —
    // proves the tree sorts by the order field rather than reflecting
    // insertion position by accident.
    useApp.setState({
      workbooks: [{ id: "w1", name: "Book1", originBook: "Book1" }],
      datasets: [
        ds("sheet3", "w1", "Book1@3", 2),
        ds("sheet1", "w1", "Book1", 0),
        ds("sheet2", "w1", "Book1@2", 1),
      ],
      expandedWorkbookIds: ["w1"],
    });
    render(<Harness />);
    const names = Array.from(document.querySelectorAll(".qzk-ds-name")).map((el) => el.textContent);
    expect(names).toEqual(["sheet1.dat", "sheet2.dat", "sheet3.dat"]);
  });
});

describe("LibraryTree — kind dispatch", () => {
  it("renders a workbook's non-worksheet children (editable figure) once expanded", () => {
    useApp.setState({
      workbooks: [wb("w1")],
      datasets: [ds("d1", "w1")],
      expandedWorkbookIds: ["w1"],
      editableFigures: [createFigureDocument({ id: "fig1", name: "My Figure", datasetId: "d1", view: defaultPlotView() })],
    });
    render(<Harness />);
    expect(screen.getByText(/My Figure/)).toBeInTheDocument();
  });
});
