// The "Origin link tables" tree node: collapsed by default, a disclosure with
// the "linked cells not resolved" note, and its books stay ordinary rows.

import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import LibraryTree from "./LibraryTree";
import { useLibraryHierarchyRows } from "./useLibraryHierarchyRows";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

const sheet = (id: string, workbookId: string): Dataset => ({
  id, name: `${id}`, workbookId,
  data: { time: [], values: [], labels: [], units: [], metadata: { origin_book: workbookId, origin_link_table: true } },
});

function Harness() {
  const rows = useLibraryHierarchyRows();
  return <LibraryTree rows={rows} onFilterTag={() => {}} />;
}
const row = (key: string): HTMLElement | null => document.querySelector(`[data-lib-row="${key}"]`);
const GROUP = "origin-group:link-tables-f1";

beforeEach(() => {
  useApp.setState({
    folders: [{ id: "f1", name: "Proj", parentId: null, order: 0 }],
    workbooks: [
      { id: "t1", name: "Table1", folderId: "f1", originBook: "Table1" },
      { id: "t2", name: "Table2", folderId: "f1", originBook: "Table2" },
    ],
    datasets: [sheet("d1", "t1"), sheet("d2", "t2")],
    originFigures: [], editableFigures: [], figureDocs: [], pages: [], reports: [],
    expandedFolders: ["f1"], expandedWorkbookIds: [], expandedOriginGroupIds: [],
    librarySelection: null, workbookLastChild: {}, activeId: null, selectedIds: [],
  });
});

describe("Origin link tables group (tree)", () => {
  it("is one collapsed node with the unresolved note; books are hidden until opened", () => {
    render(<Harness />);
    const group = row(GROUP)!;
    expect(group).toHaveAttribute("aria-expanded", "false");
    expect(group).toHaveTextContent("Origin link tables");
    expect(group).toHaveTextContent("linked cells not resolved");
    expect(group).toHaveAttribute("aria-label", expect.stringContaining("linked cells not resolved"));
    expect(row("workbook:t1")).toBeNull();
  });

  it("a click discloses the books (kept, not dropped) and a second click collapses", () => {
    render(<Harness />);
    fireEvent.click(row(GROUP)!);
    expect(row(GROUP)).toHaveAttribute("aria-expanded", "true");
    expect(row("workbook:t1")).not.toBeNull();
    expect(row("workbook:t2")).not.toBeNull();
    fireEvent.click(row(GROUP)!);
    expect(row("workbook:t1")).toBeNull();
  });
});
