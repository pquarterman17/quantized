import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryWorkspace from "./LibraryWorkspace";
import { createPageDocument } from "../../lib/pageDocument";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import ContextMenu from "../overlays/ContextMenu";

const worksheet = (id: string, workbookId: string): Dataset => ({
  id,
  workbookId,
  name: `${id}.csv`,
  data: {
    time: [0, 1, 2],
    values: [[1, 4], [2, 5], [3, 6]],
    labels: ["Field", "Moment"],
    units: ["T", "emu"],
    metadata: {},
  },
});

beforeEach(() => {
  useApp.setState({
    datasets: [],
    folders: [],
    workbooks: [],
    originFigures: [],
    editableFigures: [],
    figureDocs: [],
    pages: [],
    reports: [],
    selectedIds: [],
    librarySelection: null,
    activeId: null,
    expandedFolders: [],
    expandedWorkbookIds: [],
    revealTarget: null,
    workbookLastChild: {},
    figurePageOpen: false,
    cmdkOpen: false,
    confirmRemove: false,
  });
});

describe("LibraryWorkspace — PR E wide Tile browser", () => {
  it("browses a workbook in place and shows an honest table preview, not an inferred plot", () => {
    useApp.setState({
      workbooks: [{ id: "w1", name: "Magnetic sweep" }],
      datasets: [worksheet("run-1", "w1")],
    });
    render(<LibraryWorkspace onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("listitem", { name: "Magnetic sweep, Workbook" }));
    expect(useApp.getState().librarySelection).toEqual({ kind: "workbook", id: "w1" });
    expect(screen.getByRole("list", { name: "Magnetic sweep items" })).toBeInTheDocument();
    expect(screen.getByLabelText("Data preview for run-1.csv")).toBeInTheDocument();
    expect(screen.getByText("Field")).toBeInTheDocument();
    expect(screen.getByText(/Worksheet · 3 × 2/)).toBeInTheDocument();
  });

  it("single-click selects a child without changing the active plot; double-click opens it", () => {
    useApp.setState({
      workbooks: [{ id: "w1", name: "Run" }],
      datasets: [worksheet("a", "w1")],
      librarySelection: { kind: "workbook", id: "w1" },
      activeId: null,
    });
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const tile = screen.getByRole("listitem", { name: "a.csv, Worksheet" });

    fireEvent.click(tile);
    expect(useApp.getState().selectedIds).toEqual(["a"]);
    expect(useApp.getState().activeId).toBeNull();

    fireEvent.doubleClick(tile);
    expect(useApp.getState().activeId).toBe("a");
  });

  it("Escape returns to the unchanged plot and posts a canonical reveal target", () => {
    const onClose = vi.fn();
    useApp.setState({
      workbooks: [{ id: "w1", name: "Run" }],
      datasets: [worksheet("a", "w1")],
      selectedIds: ["a"],
      activeId: "a",
    });
    render(<LibraryWorkspace onClose={onClose} />);

    fireEvent.keyDown(screen.getByLabelText("Library workspace"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(useApp.getState().revealTarget).toBe("worksheet:a");
    expect(useApp.getState().activeId).toBe("a");
  });

  // OWNER DECISION (Paige, 2026-08-16, PR #145 review follow-up): opening a
  // node whose visible result is a STAGE plot also returns to the plot —
  // otherwise the open happens invisibly behind the tiles. Overlay opens
  // (pages/reports/publication figures) keep the workspace open, and plain
  // browsing (folders) never closes it.
  it("opening a worksheet tile returns to the plot (stage-target open)", () => {
    const onClose = vi.fn();
    useApp.setState({
      workbooks: [{ id: "w1", name: "Run" }],
      datasets: [worksheet("a", "w1")],
      librarySelection: { kind: "workbook", id: "w1" },
    });
    render(<LibraryWorkspace onClose={onClose} />);
    const tile = screen.getByRole("listitem", { name: "a.csv, Worksheet" });

    fireEvent.doubleClick(tile);
    expect(useApp.getState().activeId).toBe("a"); // the open happened…
    expect(onClose).toHaveBeenCalledOnce(); // …and it is VISIBLE: back to the plot
    expect(useApp.getState().revealTarget).toBe("worksheet:a"); // revealed in the tree
  });

  it("Enter on a workbook tile resolves its remembered child and returns to the plot", () => {
    const onClose = vi.fn();
    useApp.setState({
      workbooks: [{ id: "w1", name: "Run" }],
      datasets: [worksheet("a", "w1")],
    });
    render(<LibraryWorkspace onClose={onClose} />);
    const tile = screen.getByRole("listitem", { name: "Run, Workbook" });
    tile.focus();
    fireEvent.keyDown(tile, { key: "Enter" });
    expect(useApp.getState().activeId).toBe("a"); // L0.6 first-worksheet fallback
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opening an overlay-target tile (figure page) keeps the workspace open", () => {
    const onClose = vi.fn();
    useApp.setState({
      pages: [createPageDocument({ id: "pg1", name: "Summary Page", rows: 1, cols: 1 })],
    });
    render(<LibraryWorkspace onClose={onClose} />);
    const tile = screen.getByRole("listitem", { name: "Summary Page, Figure page" });

    fireEvent.doubleClick(tile);
    expect(useApp.getState().figurePageOpen).toBe(true); // the overlay opened above
    expect(onClose).not.toHaveBeenCalled(); // the workspace stays for more browsing
  });

  it("browsing never closes the workspace: folder open is a disclosure toggle, not a stage target", () => {
    const onClose = vi.fn();
    useApp.setState({
      folders: [{ id: "f1", name: "Growth", parentId: null, order: 0 }],
      workbooks: [{ id: "w1", name: "Run", folderId: "f1" }],
      datasets: [worksheet("a", "w1")],
    });
    render(<LibraryWorkspace onClose={onClose} />);
    const folderTile = screen.getByRole("listitem", { name: "Growth, Folder" });
    fireEvent.click(folderTile); // browse in
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("listitem", { name: "Run, Workbook" })).toBeInTheDocument();

    // Double-click on the folder itself (via breadcrumb-back first): open =
    // toggleFolderExpanded — sidebar disclosure, nothing stage-bound.
    fireEvent.click(screen.getByRole("button", { name: "Project" })); // breadcrumb to root
    fireEvent.doubleClick(screen.getByRole("listitem", { name: "Growth, Folder" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(useApp.getState().expandedFolders).toContain("f1"); // the toggle ran
  });

  it("keeps one keyboard entry tile and moves focus with arrow keys", () => {
    useApp.setState({
      workbooks: [{ id: "w1", name: "Run" }],
      datasets: [worksheet("a", "w1"), worksheet("b", "w1")],
      librarySelection: { kind: "workbook", id: "w1" },
    });
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const first = screen.getByRole("listitem", { name: "a.csv, Worksheet" });
    const second = screen.getByRole("listitem", { name: "b.csv, Worksheet" });
    expect(first).toHaveAttribute("tabindex", "0");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(second).toHaveFocus();
  });

  it("Delete removes the focused worksheet instead of an unrelated selection", () => {
    useApp.setState({
      workbooks: [{ id: "w1", name: "Run" }],
      datasets: [worksheet("a", "w1"), worksheet("b", "w1")],
      selectedIds: ["a"],
    });
    render(<LibraryWorkspace onClose={vi.fn()} />);

    const second = screen.getByRole("listitem", { name: "b.csv, Worksheet" });
    second.focus();
    fireEvent.keyDown(second, { key: "Delete" });

    expect(useApp.getState().datasets.map((dataset) => dataset.id)).toEqual(["a"]);
  });

  it("shows true pending dimensions and an on-demand placeholder", () => {
    useApp.setState({
      workbooks: [{ id: "w1", name: "Run" }],
      datasets: [{
        ...worksheet("lazy", "w1"),
        data: { time: [], values: [], labels: [], units: [], metadata: {} },
        pending: { kind: "path", path: "/run.opj", bookId: "Book2", rows: 5000, cols: 7 },
      }],
      librarySelection: { kind: "workbook", id: "w1" },
    });
    render(<LibraryWorkspace onClose={vi.fn()} />);

    expect(screen.getByText("On demand")).toBeInTheDocument();
    expect(screen.getByText(/Worksheet · 5,000 × 7/)).toBeInTheDocument();
  });

  it("formats preview values with the shared scientific formatter", () => {
    const data = worksheet("wide", "w1");
    data.data.values[0][0] = 1e8;
    useApp.setState({
      workbooks: [{ id: "w1", name: "Run" }],
      datasets: [data],
      librarySelection: { kind: "workbook", id: "w1" },
    });
    render(<LibraryWorkspace onClose={vi.fn()} />);

    expect(screen.getByText("1.00000e+8")).toBeInTheDocument();
  });

  it("lets the command palette and context menu own Escape", () => {
    const onClose = vi.fn();
    useApp.setState({ cmdkOpen: true });
    const { rerender } = render(<LibraryWorkspace onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    useApp.setState({ cmdkOpen: false });
    rerender(
      <>
        <LibraryWorkspace onClose={onClose} />
        <ContextMenu x={0} y={0} items={[{ label: "Open", run: vi.fn() }]} onClose={vi.fn()} />
      </>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
