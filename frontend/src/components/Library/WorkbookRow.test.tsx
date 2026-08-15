// LIBRARY_WORKBOOK_UX_PLAN PR C, L0.5/L0.6: the disclosure arrow toggles
// expansion WITHOUT selecting or opening; a plain row click selects; a
// double-click (or Enter, tested in LibraryTree.test.tsx) opens the
// remembered child.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import WorkbookRow from "./WorkbookRow";
import { WORKBOOK_DND } from "./dnd";
import { buildLibraryHierarchy, type LibraryNode } from "../../lib/libraryHierarchy";
import type { Dataset } from "../../lib/types";
import type { WorkbookNode } from "../../lib/workbooks";
import { useApp } from "../../store/useApp";

const wb = (id: string, name = id): WorkbookNode => ({ id, name });
const ds = (id: string, workbookId: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
  workbookId,
});

function workbookNode(workbooks: WorkbookNode[], datasets: Dataset[], id: string) {
  const hierarchy = buildLibraryHierarchy({ folders: [], workbooks, datasets });
  const node = hierarchy.byKey.get(`workbook:${id}`);
  if (!node || node.kind !== "workbook") throw new Error("fixture workbook missing");
  return node as Extract<LibraryNode, { kind: "workbook" }>;
}

describe("WorkbookRow — disclosure vs select vs open (L0.5/L0.6)", () => {
  beforeEach(() => {
    useApp.setState({
      workbooks: [wb("w1")],
      datasets: [ds("d1", "w1"), ds("d2", "w1")],
      folders: [],
      expandedWorkbookIds: [],
      librarySelection: null,
      workbookLastChild: {},
      activeId: null,
      selectedIds: [],
    });
  });

  const node = () => workbookNode(useApp.getState().workbooks, useApp.getState().datasets, "w1");

  it("clicking the disclosure caret expands without selecting or opening", () => {
    const { container } = render(<WorkbookRow node={node()} depth={0} expanded={false} hasChildren />);
    fireEvent.click(container.querySelector(".qzk-group-caret")!);
    expect(useApp.getState().expandedWorkbookIds).toContain("w1");
    expect(useApp.getState().librarySelection).toBeNull();
    expect(useApp.getState().activeId).toBeNull();
  });

  it("clicking the caret again collapses it", () => {
    useApp.setState({ expandedWorkbookIds: ["w1"] });
    const { container } = render(<WorkbookRow node={node()} depth={0} expanded hasChildren />);
    fireEvent.click(container.querySelector(".qzk-group-caret")!);
    expect(useApp.getState().expandedWorkbookIds).not.toContain("w1");
  });

  it("a single click on the row body selects, without expanding or opening", () => {
    const { container } = render(<WorkbookRow node={node()} depth={0} expanded={false} hasChildren />);
    fireEvent.click(container.querySelector(".qzk-workbook-row")!);
    expect(useApp.getState().librarySelection).toEqual({ kind: "workbook", id: "w1" });
    expect(useApp.getState().expandedWorkbookIds).toEqual([]);
    expect(useApp.getState().activeId).toBeNull();
  });

  it("double-click opens the first worksheet for a workbook with no remembered child", () => {
    const { container } = render(<WorkbookRow node={node()} depth={0} expanded={false} hasChildren />);
    fireEvent.doubleClick(container.querySelector(".qzk-workbook-row")!);
    expect(useApp.getState().activeId).toBe("d1"); // first worksheet, source order
    expect(useApp.getState().workbookLastChild.w1).toBe("worksheet:d1");
  });

  it("double-click reopens the remembered child, not the first worksheet", () => {
    useApp.setState({ workbookLastChild: { w1: "worksheet:d2" } });
    const { container } = render(<WorkbookRow node={node()} depth={0} expanded={false} hasChildren />);
    fireEvent.doubleClick(container.querySelector(".qzk-workbook-row")!);
    expect(useApp.getState().activeId).toBe("d2");
  });

  it("double-clicking the caret does not open", () => {
    const { container } = render(<WorkbookRow node={node()} depth={0} expanded={false} hasChildren />);
    fireEvent.doubleClick(container.querySelector(".qzk-group-caret")!);
    expect(useApp.getState().activeId).toBeNull();
  });

  it("shows the worksheet-count chip", () => {
    render(<WorkbookRow node={node()} depth={0} expanded={false} hasChildren />);
    expect(screen.getByTitle("2 worksheets")).toHaveTextContent("2");
  });

  it("a childless workbook shows the placeholder glyph, and the caret doesn't toggle", () => {
    useApp.setState({ datasets: [] });
    const { container } = render(<WorkbookRow node={node()} depth={0} expanded={false} hasChildren={false} />);
    fireEvent.click(container.querySelector(".qzk-group-caret")!);
    expect(useApp.getState().expandedWorkbookIds).toEqual([]);
  });
});

describe("WorkbookRow — context menu (L0.36)", () => {
  beforeEach(() => {
    useApp.setState({
      workbooks: [wb("w1")],
      datasets: [ds("d1", "w1")],
      folders: [],
      librarySelection: null,
    });
  });

  const node = () => workbookNode(useApp.getState().workbooks, useApp.getState().datasets, "w1");

  it("right-click selects the workbook and opens its menu", () => {
    const { container } = render(<WorkbookRow node={node()} depth={0} expanded={false} hasChildren />);
    fireEvent.contextMenu(container.querySelector(".qzk-workbook-row")!);
    expect(useApp.getState().librarySelection).toEqual({ kind: "workbook", id: "w1" });
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("ContextMenu key opens the same menu", () => {
    const { container } = render(<WorkbookRow node={node()} depth={0} expanded={false} hasChildren />);
    const row = container.querySelector(".qzk-workbook-row")!;
    fireEvent.keyDown(row, { key: "ContextMenu" });
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("the resting-cue '⋯' button opens the same menu", () => {
    render(<WorkbookRow node={node()} depth={0} expanded={false} hasChildren />);
    fireEvent.click(screen.getByTitle("More actions"));
    expect(screen.getByText("Open")).toBeInTheDocument();
  });
});

describe("WorkbookRow — drag starts only from the handle (PR C review fix: WORKBOOK_DND drag source)", () => {
  beforeEach(() => {
    useApp.setState({
      workbooks: [wb("w1")],
      datasets: [ds("d1", "w1")],
      folders: [],
      librarySelection: null,
      activeDrag: null,
    });
  });

  const node = () => workbookNode(useApp.getState().workbooks, useApp.getState().datasets, "w1");

  function fireDragStart(el: Element, dataTransfer: unknown) {
    const evt = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(evt, "dataTransfer", { value: dataTransfer, configurable: true });
    fireEvent(el, evt);
  }

  it("does not arm a drag from the row body — only the grip handle", () => {
    const { container } = render(<WorkbookRow node={node()} depth={0} expanded={false} hasChildren />);
    const row = container.querySelector(".qzk-workbook-row")!;
    const handle = container.querySelector(".qzk-drag-handle")!;
    expect(row.getAttribute("draggable")).not.toBe("true");
    expect(handle.getAttribute("draggable")).toBe("true");

    const setData = vi.fn();
    fireDragStart(row, { setData });
    expect(setData).not.toHaveBeenCalled();

    fireDragStart(handle, { setData });
    expect(setData).toHaveBeenCalledWith(WORKBOOK_DND, "w1");
  });

  it("flags activeDrag on dragstart, clears it on dragend", () => {
    const { container } = render(<WorkbookRow node={node()} depth={0} expanded={false} hasChildren />);
    const handle = container.querySelector(".qzk-drag-handle")!;
    fireDragStart(handle, { setData: () => {} });
    expect(useApp.getState().activeDrag).toEqual({ kind: "workbook", id: "w1" });
    fireEvent.dragEnd(handle);
    expect(useApp.getState().activeDrag).toBeNull();
  });
});
