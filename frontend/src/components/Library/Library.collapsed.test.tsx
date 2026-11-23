// UX8-I regression 2 and 3: one collapse policy for EVERY view, and a shown
// count that equals the rows the view renders. PR #741 collapsed only the
// unfiltered Tree (a content-type filter or a focus brought the header back,
// and "N shown" doubled).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import Library from "./Library";
import { LIBRARY_VIEW_PREFS_KEY } from "../../lib/libraryViewPrefs";
import type { Dataset, FolderNode } from "../../lib/types";
import { useApp } from "../../store/useApp";

const ds = (id: string, workbookId: string): Dataset => ({
  id,
  name: `${id}.csv`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
  workbookId,
});
const folder: FolderNode = { id: "f1", name: "Project", parentId: null, order: 0 };

beforeAll(async () => {
  await import("./LibraryTree"); // lazy chunk: preload so findBy* is not racing it
});

beforeEach(() => {
  localStorage.removeItem(LIBRARY_VIEW_PREFS_KEY);
  useApp.setState({
    folders: [folder],
    workbooks: [
      { id: "w1", name: "data", folderId: "f1", order: 0 },
      { id: "w2", name: "other", folderId: "f1", order: 1 },
      { id: "w3", name: "multi", order: 0 },
    ],
    datasets: [ds("d1", "w1"), ds("d2", "w2"), ds("d3", "w3"), ds("d4", "w3")],
    expandedFolders: ["f1"],
    expandedWorkbookIds: [],
    originFigures: [],
    originFidelity: [],
    smartFolders: [],
    activeId: null,
    selectedIds: [],
    librarySelection: null,
  });
});

const workbookRows = (): number => document.querySelectorAll('[data-lib-row^="workbook:"]').length;

describe("Library — one collapse policy and a matching count", () => {
  it("Tree: single-sheet workbooks are one row; the count is the rows the tree can show", async () => {
    render(<Library />);
    expect(await screen.findByText("d1.csv")).toBeInTheDocument();
    expect(screen.getByText("d2.csv")).toBeInTheDocument();
    expect(workbookRows()).toBe(1); // only the two-sheet "multi" keeps a header
    // folder + 2 collapsed rows + "multi" + its 2 sheets = 6 nodes, not 8.
    expect(screen.getByText("6 shown")).toBeInTheDocument();
  });

  it("a content-type filter keeps the same collapse and counts what it shows", async () => {
    render(<Library />);
    await screen.findByText("d1.csv");
    fireEvent.change(screen.getByRole("combobox", { name: "Show item type" }), { target: { value: "data" } });
    expect(screen.getByText("d1.csv")).toBeInTheDocument();
    expect(document.querySelector('[data-lib-row="workbook:w1"]')).toBeNull();
    expect(document.querySelector('[data-lib-row="workbook:w2"]')).toBeNull();
    expect(screen.getByText("6 shown")).toBeInTheDocument();
  });

  it("a focused folder keeps the collapse", async () => {
    render(<Library />);
    fireEvent.click((await screen.findByText("Project")).closest('[data-lib-row="folder:f1"]')!);
    fireEvent.click(await screen.findByRole("button", { name: "Focus on Project" }));
    expect(await screen.findByText("d1.csv")).toBeInTheDocument();
    expect(document.querySelector('[data-lib-row="workbook:w1"]')).toBeNull();
    expect(screen.getByText("3 shown")).toBeInTheDocument(); // folder + 2 collapsed rows
  });

  it("focusing a one-sheet workbook shows its single row", async () => {
    render(<Library />);
    fireEvent.contextMenu((await screen.findByText("d1.csv")).closest("[data-ds-id]")!, { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByText("Focus on this workbook"));
    expect(await screen.findByRole("navigation", { name: "Focused Library location" })).toHaveTextContent("data");
    expect(screen.getByText("d1.csv")).toBeInTheDocument();
    expect(screen.queryByText("d2.csv")).not.toBeInTheDocument();
    expect(workbookRows()).toBe(0);
  });

  it("Details deliberately lists every entity (workbook and sheet are separate, sortable rows)", async () => {
    useApp.setState({ expandedWorkbookIds: ["w1"] }); // Details honours disclosure like the Tree
    render(<Library viewMode="details" onViewModeChange={() => {}} />);
    expect(await screen.findByText("8 shown")).toBeInTheDocument();
    await screen.findByRole("table", { name: "Library details table" }); // lazy chunk
    expect(document.querySelector('[data-lib-row="workbook:w1"]')).not.toBeNull();
    expect(document.querySelector('[data-lib-row="worksheet:d1"]')).not.toBeNull();
  });
});

describe("Library collapsed (Ctrl+B)", () => {
  it("is inert, so none of its controls can take focus; expanded it is not", () => {
    useApp.setState({ leftCollapsed: true });
    const { container, rerender } = render(<Library />);
    expect(container.querySelector(".qzk-library")!.hasAttribute("inert")).toBe(true);
    useApp.setState({ leftCollapsed: false });
    rerender(<Library />);
    expect(container.querySelector(".qzk-library")!.hasAttribute("inert")).toBe(false);
  });
});
