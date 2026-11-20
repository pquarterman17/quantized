// The virtual "Unresolved Origin figures (N)" tree node: collapsed by default,
// one per import, mouse + keyboard disclosure, and its members stay ordinary,
// selectable, inspectable Origin figure rows.

import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import LibraryTree from "./LibraryTree";
import { useLibraryHierarchyRows } from "./useLibraryHierarchyRows";
import type { OriginFigureEntry } from "../../lib/originFigures";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

const ds = (id: string, workbookId: string): Dataset => ({
  id, name: `${id}.dat`, workbookId,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
});
const entry = (id: string, datasetId: string | null): OriginFigureEntry => ({
  id, stem: "Proj", datasetId, siblingIds: ["d1"],
  figure: {
    name: id, x_from: 0, x_to: 1, x_log: false, y_from: 0, y_to: 1, y_log: false,
    n_curves: 0, annotations: [],
  },
});

function Harness() {
  const rows = useLibraryHierarchyRows();
  return <LibraryTree rows={rows} onFilterTag={() => {}} />;
}
const row = (key: string): HTMLElement | null => document.querySelector(`[data-lib-row="${key}"]`);
const GROUP = "origin-group:unresolved-d1";

beforeEach(() => {
  useApp.setState({
    folders: [{ id: "f1", name: "Proj", parentId: null, order: 0 }],
    workbooks: [{ id: "w1", name: "Book1", folderId: "f1" }],
    datasets: [ds("d1", "w1")],
    originFigures: [entry("good", "d1"), entry("u1", null), entry("u2", null), entry("u3", null)],
    editableFigures: [], figureDocs: [], pages: [], reports: [],
    expandedFolders: ["f1"], expandedWorkbookIds: ["w1"], expandedOriginGroupIds: [],
    librarySelection: null, workbookLastChild: {}, activeId: null, selectedIds: [],
  });
});

describe("Unresolved Origin figures group (tree)", () => {
  it("is ONE collapsed node labelled with the count; resolved figures stay under their book", () => {
    render(<Harness />);
    const group = row(GROUP)!;
    expect(group).toHaveAttribute("role", "treeitem");
    expect(group).toHaveAttribute("aria-expanded", "false");
    expect(group).toHaveAttribute("aria-level", "2");
    expect(group).toHaveAttribute("aria-selected", "false");
    expect(group).toHaveAttribute("aria-label", expect.stringContaining("Unresolved Origin figures (3)"));
    expect(group).toHaveTextContent("Unresolved Origin figures (3)");
    expect(row("origin-figure:u1")).toBeNull();
    expect(row("origin-figure:good")).not.toBeNull();
    expect(document.querySelectorAll('[data-lib-row^="origin-group:"]')).toHaveLength(1);
  });

  it("a click expands and collapses it; members then render one level deeper and read as unresolved", () => {
    render(<Harness />);
    fireEvent.click(row(GROUP)!);
    expect(row(GROUP)).toHaveAttribute("aria-expanded", "true");
    const u1 = row("origin-figure:u1")!;
    expect(u1).toHaveAttribute("aria-level", "3");
    expect(u1).toHaveAttribute("aria-description", expect.stringContaining("unresolved"));
    fireEvent.click(row(GROUP)!);
    expect(row("origin-figure:u1")).toBeNull();
  });

  it("keyboard: → expands, → again enters, ← returns to the group, ← collapses; Enter and Space toggle", () => {
    render(<Harness />);
    row(GROUP)!.focus();
    fireEvent.keyDown(row(GROUP)!, { key: "ArrowRight" });
    expect(row(GROUP)).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(row(GROUP)!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(row("origin-figure:u1"));
    fireEvent.keyDown(row("origin-figure:u1")!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("origin-figure:u2"));
    fireEvent.keyDown(row("origin-figure:u2")!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(row(GROUP));
    fireEvent.keyDown(row(GROUP)!, { key: "ArrowLeft" });
    expect(row(GROUP)).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(row(GROUP)!, { key: "Enter" });
    expect(row(GROUP)).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(row(GROUP)!, { key: " " });
    expect(row(GROUP)).toHaveAttribute("aria-expanded", "false");
  });

  it("the group is never selected (nor persisted); its members are selectable and inspectable", () => {
    render(<Harness />);
    fireEvent.click(row(GROUP)!);
    expect(useApp.getState().librarySelection).toBeNull();
    fireEvent.click(row("origin-figure:u2")!);
    expect(useApp.getState().librarySelection).toEqual({ kind: "origin-figure", id: "u2" });
    expect(row("origin-figure:u2")).toHaveAttribute("aria-selected", "true");
    expect(row(GROUP)).toHaveAttribute("aria-selected", "false");
    // "Why unresolved": the row's own description and Recover entry survive.
    expect(row("origin-figure:u2")).toHaveAttribute("aria-description", expect.stringContaining("Recover"));
  });

  it("two unresolved figures group; one does not", () => {
    useApp.setState({ originFigures: [entry("good", "d1"), entry("u1", null)] });
    const { unmount } = render(<Harness />);
    expect(row(GROUP)).toBeNull();
    expect(row("origin-figure:u1")).not.toBeNull();
    unmount();
    useApp.setState({ originFigures: [entry("u1", null), entry("u2", null)] });
    render(<Harness />);
    expect(row(GROUP)).toHaveTextContent("Unresolved Origin figures (2)");
    expect(row("origin-figure:u1")).toBeNull();
  });
});
