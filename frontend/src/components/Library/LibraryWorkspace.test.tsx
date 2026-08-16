import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryWorkspace from "./LibraryWorkspace";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

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
  });
});

describe("LibraryWorkspace — PR E wide Tile browser", () => {
  it("browses a workbook in place and shows an honest table preview, not an inferred plot", () => {
    useApp.setState({
      workbooks: [{ id: "w1", name: "Magnetic sweep" }],
      datasets: [worksheet("run-1", "w1")],
    });
    render(<LibraryWorkspace onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("gridcell", { name: "Magnetic sweep, Workbook" }));
    expect(useApp.getState().librarySelection).toEqual({ kind: "workbook", id: "w1" });
    expect(screen.getByRole("grid", { name: "Magnetic sweep items" })).toBeInTheDocument();
    expect(screen.getByLabelText("Data preview for run-1.csv")).toBeInTheDocument();
    expect(screen.getByText("Field")).toBeInTheDocument();
    expect(screen.getByText(/3 rows × 2 columns/)).toBeInTheDocument();
  });

  it("single-click selects a child without changing the active plot; double-click opens it", () => {
    useApp.setState({
      workbooks: [{ id: "w1", name: "Run" }],
      datasets: [worksheet("a", "w1")],
      librarySelection: { kind: "workbook", id: "w1" },
      activeId: null,
    });
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const tile = screen.getByRole("gridcell", { name: "a.csv, Worksheet" });

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

  it("keeps one keyboard entry tile and moves focus with arrow keys", () => {
    useApp.setState({
      workbooks: [{ id: "w1", name: "Run" }],
      datasets: [worksheet("a", "w1"), worksheet("b", "w1")],
      librarySelection: { kind: "workbook", id: "w1" },
    });
    render(<LibraryWorkspace onClose={vi.fn()} />);
    const first = screen.getByRole("gridcell", { name: "a.csv, Worksheet" });
    const second = screen.getByRole("gridcell", { name: "b.csv, Worksheet" });
    expect(first).toHaveAttribute("tabindex", "0");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(second).toHaveFocus();
  });
});
