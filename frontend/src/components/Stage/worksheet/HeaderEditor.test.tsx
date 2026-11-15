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
    fill: vi.fn(),
    setRowCount: vi.fn(),
  });
  const labels = (items: ReturnType<typeof columnEditItems>) => items.flatMap((i) => ("label" in i ? [i.label] : []));

  it("offers Set Column Values on every column (editing the formula of a computed one), and never deletes or moves X", () => {
    expect(labels(columnEditItems(1, ctx([1])))).toContain("Set Column Values… (edit formula)");
    expect(labels(columnEditItems(0, ctx([0])))).toContain("Set Column Values…");
    expect(labels(columnEditItems(-1, ctx([-1])))).toContain("Set Column Values…");
    const x = columnEditItems(-1, ctx([-1]));
    const del = x.find((i) => "label" in i && i.label === "Delete column") as { disabled?: boolean; title?: string };
    expect(del.disabled).toBe(true);
    expect(del.title).toMatch(/X column/);
    const move = x.find((i) => "label" in i && i.label === "Move column") as { disabled?: boolean };
    expect(move.disabled).toBe(true);
    expect(labels(columnEditItems(0, ctx([0, 1])))).toContain("Delete 2 columns");
  });

  it("Fill column with and Set row count (G12): fill is refused on a computed column", () => {
    const c = ctx([0]);
    const fill = columnEditItems(0, c).find((i) => "label" in i && i.label === "Fill column with") as { submenu: { label: string; run: () => void }[] };
    expect(fill.submenu.map((i) => i.label)).toEqual(["Row numbers", "Linear sequence…", "Uniform random numbers…", "Normal random numbers…"]);
    fill.submenu[0].run();
    expect(c.fill).toHaveBeenCalledWith("rownum");
    const onComputed = columnEditItems(1, ctx([1])).find((i) => "label" in i && i.label === "Fill column with") as { disabled?: boolean; title?: string };
    expect(onComputed.disabled).toBe(true);
    expect(onComputed.title).toMatch(/formula/);
    expect(labels(columnEditItems(0, c))).toContain("Set row count…");
  });
});

describe("user-parameter header rows", () => {
  it("adds a parameter in the header editor, shows it under the header, then edits it on another column", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.doubleClick(document.querySelector("[role=columnheader][data-col='0']")!);
    fireEvent.change(screen.getByRole("textbox", { name: "New parameter name, A" }), { target: { value: "Temperature" } });
    fireEvent.change(screen.getByRole("textbox", { name: "New parameter value, A" }), { target: { value: "300 K" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "New parameter value, A" }), { key: "Enter" });
    expect(screen.getByText("Temperature: 300 K")).toBeInTheDocument();
    expect(useApp.getState().history).toHaveLength(1);

    // the parameter is now a row for every column: edit B's value
    fireEvent.doubleClick(document.querySelector("[role=columnheader][data-col='1']")!);
    fireEvent.change(screen.getByRole("textbox", { name: "Parameter Temperature, Twice" }), { target: { value: "10 K" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Parameter Temperature, Twice" }), { key: "Enter" });
    expect(screen.getByText("Temperature: 10 K")).toBeInTheDocument();
    expect(screen.getByText("Temperature: 300 K")).toBeInTheDocument();
  });

  it("the X column has no parameter section", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.doubleClick(document.querySelector("[role=columnheader][data-col='-1']")!);
    expect(screen.queryByRole("textbox", { name: /New parameter name/ })).toBeNull();
  });

  it("offers the legend and curve-order entries only when the host wires them (value columns)", () => {
    const base = { baseCount: 1, targets: [0], editHeader: vi.fn(), setColumnValues: vi.fn(), numberFormat: vi.fn(), insertColumn: vi.fn(), addColumn: vi.fn(), deleteColumns: vi.fn(), moveColumn: vi.fn(), sortWorksheet: vi.fn(), fill: vi.fn(), setRowCount: vi.fn() };
    const names = (items: ReturnType<typeof columnEditItems>) => items.flatMap((i) => ("label" in i ? [i.label] : []));
    expect(names(columnEditItems(0, base))).not.toContain("Order curves by parameter…");
    const wired = { ...base, legendFromParams: vi.fn(), orderByParam: vi.fn() };
    expect(names(columnEditItems(0, wired))).toEqual(expect.arrayContaining(["Legend label from parameters…", "Order curves by parameter…"]));
    expect(names(columnEditItems(-1, wired))).not.toContain("Order curves by parameter…");
  });

  it("Apply is ONE undo step for the header rows and every parameter edit together", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.doubleClick(document.querySelector("[role=columnheader][data-col='0']")!);
    fireEvent.change(screen.getByRole("textbox", { name: "Units, A" }), { target: { value: "mV" } });
    fireEvent.change(screen.getByRole("textbox", { name: "New parameter name, A" }), { target: { value: "Sample" } });
    fireEvent.change(screen.getByRole("textbox", { name: "New parameter value, A" }), { target: { value: "S1" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Units, A" }), { key: "Enter" });
    const st = useApp.getState();
    expect(st.datasets[0].data.units[0]).toBe("mV");
    expect(st.history).toHaveLength(1);
    st.undo();
    const back = useApp.getState().datasets[0];
    expect(back.data.units[0]).toBe("");
    expect(back.data.metadata.label_rows).toBeUndefined();
  });

  it("x marks a parameter for removal without closing, so typed edits survive; Cancel keeps it", () => {
    const d = sheet();
    d.data.metadata = { ...d.data.metadata, label_rows: [{ index: 0, role: "label", name: "T", x: "T", cells: ["5", ""] }] };
    useApp.setState({ datasets: [d] });
    render(<WorksheetPane datasetId="w" />);
    fireEvent.doubleClick(document.querySelector("[role=columnheader][data-col='0']")!);
    fireEvent.change(screen.getByRole("textbox", { name: "Units, A" }), { target: { value: "mV" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove parameter T" }));
    expect(screen.getByRole("dialog", { name: "Edit header of A" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Units, A" })).toHaveValue("mV");
    expect(useApp.getState().datasets[0].data.metadata.label_rows).toHaveLength(1); // not applied yet
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const after = useApp.getState().datasets[0];
    expect(after.data.units[0]).toBe("mV");
    expect(after.data.metadata.label_rows).toEqual([]);
    expect(useApp.getState().history).toHaveLength(1);
  });

  it("Cancel after x leaves the parameter in place", () => {
    const d = sheet();
    d.data.metadata = { ...d.data.metadata, label_rows: [{ index: 0, role: "label", name: "T", x: "T", cells: ["5", ""] }] };
    useApp.setState({ datasets: [d] });
    render(<WorksheetPane datasetId="w" />);
    fireEvent.doubleClick(document.querySelector("[role=columnheader][data-col='0']")!);
    fireEvent.click(screen.getByRole("button", { name: "Remove parameter T" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useApp.getState().datasets[0].data.metadata.label_rows).toHaveLength(1);
  });
});
