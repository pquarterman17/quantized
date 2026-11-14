// Editing the Long Name / Units / Comments header rows in place (worksheet
// audit #12: none could be edited), and the column menu's structure section.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import WorksheetPane from "./WorksheetPane";
import { columnEditItems } from "./worksheetEditMenus";

const sheet = (): Dataset => ({
  id: "w",
  name: "Book1",
  data: { time: [1], values: [[10, 20]], labels: ["A", "Twice"], units: ["", ""], metadata: { x_column_name: "X" } },
  formulas: [{ name: "Twice", expr: "A * 2", deps: ["A"] }],
});

beforeEach(() => {
  useApp.setState({ datasets: [sheet()], activeId: "w", worksheetId: null, history: [], future: [], status: "" });
});

describe("header-row editor", () => {
  it("double-click a header, edit the three rows, Enter applies (one undo step)", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.doubleClick(document.querySelector("[role=columnheader][data-col='0']")!);
    const dialog = screen.getByRole("dialog", { name: "Edit header of A" });
    expect(dialog).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Long Name, A" }), { target: { value: "Signal" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Units, A" }), { target: { value: "mV" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Comments, A" }), { target: { value: "probe 1" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Comments, A" }), { key: "Enter" });
    const ds = useApp.getState().datasets[0];
    expect(ds.data.labels[0]).toBe("Signal");
    expect(ds.data.units[0]).toBe("mV");
    expect(ds.columnProps).toEqual({ 0: { comment: "probe 1" } });
    expect(useApp.getState().history).toHaveLength(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("probe 1")).toBeInTheDocument(); // the Comments row shows
  });

  it("Escape closes it without applying", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.doubleClick(document.querySelector("[role=columnheader][data-col='-1']")!);
    fireEvent.change(screen.getByRole("textbox", { name: "Long Name, X" }), { target: { value: "Time" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Long Name, X" }), { key: "Escape" });
    expect(useApp.getState().datasets[0].data.metadata.x_column_name).toBe("X");
    expect(useApp.getState().history).toEqual([]);
  });
});

describe("column structure menu", () => {
  const ctx = (targets: number[]) => ({
    baseCount: 1,
    targets,
    editHeader: vi.fn(),
    setColumnValues: vi.fn(),
    numberFormat: vi.fn(),
    insertColumn: vi.fn(),
    addColumn: vi.fn(),
    deleteColumns: vi.fn(),
    moveColumn: vi.fn(),
    sortWorksheet: vi.fn(),
  });
  const labels = (items: ReturnType<typeof columnEditItems>) => items.flatMap((i) => ("label" in i ? [i.label] : []));

  it("offers Set Column Values only on a computed column, and never deletes or moves X", () => {
    expect(labels(columnEditItems(1, ctx([1])))).toContain("Set Column Values… (edit formula)");
    expect(labels(columnEditItems(0, ctx([0])))).not.toContain("Set Column Values… (edit formula)");
    const x = columnEditItems(-1, ctx([-1]));
    const del = x.find((i) => "label" in i && i.label === "Delete column") as { disabled?: boolean; title?: string };
    expect(del.disabled).toBe(true);
    expect(del.title).toMatch(/X column/);
    const move = x.find((i) => "label" in i && i.label === "Move column") as { disabled?: boolean };
    expect(move.disabled).toBe(true);
    expect(labels(columnEditItems(0, ctx([0, 1])))).toContain("Delete 2 columns");
  });
});
