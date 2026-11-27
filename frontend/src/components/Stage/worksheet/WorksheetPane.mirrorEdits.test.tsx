// Every way into a mirror cell, through the REAL worksheet: a double-click, the
// Delete key, Fill Down, Cut and Paste each refuse with the reason in the
// status line AND a toast, and leave the values alone. A categorical source's
// labels show in the mirror's cells.

import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadFormulaExtension } from "../../../lib/formulaExt";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { createMirror } from "../../../store/mirrorColumn";
import { useToasts } from "../../../store/toasts";
import { useWorksheetReveal } from "../../../store/worksheetReveal";
import { clickMenuItem } from "../../../test/contextMenuNav";
import WorksheetPane from "./WorksheetPane";

const mk = (id: string, name: string, rows: number[][], labels: string[], cat?: Record<number, string[]>): Dataset => ({
  id,
  name,
  data: { time: rows.map((_, i) => i), values: rows, labels, units: labels.map(() => ""), metadata: {}, ...(cat ? { cat_levels: cat } : {}) },
});
const cell = (pos: number, col: number): HTMLElement => document.querySelector<HTMLElement>(`[role=gridcell][id$="-r${pos}-c${col + 1}"]`)!;
const grid = (): HTMLElement => document.getElementById(document.querySelector("[role=grid]")!.id)!;
const WHY = "T (mirror) follows Run 2 > A: edit it there (Go to Source), or Detach to make it ordinary values";
const mirrorValues = () => useApp.getState().datasets.find((d) => d.id === "mir")!.data.values.map((r) => r[1]);

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({
    datasets: [mk("src", "Run 2", [[10, 0], [20, 1], [30, 2]], ["T", "grade"], { 1: ["lo", "hi", "mid"] }), mk("mir", "Summary", [[100], [200], [300]], ["Q"])],
    activeId: "mir",
    worksheetId: null,
    selection: null,
    selectedIds: [],
    worksheetSelections: {},
    history: [],
    future: [],
    status: "",
    statusDanger: null,
    recalcMode: "auto",
    staleDatasets: [],
  });
  useWorksheetReveal.setState({ rowReveal: null });
  useToasts.setState({ toasts: [] });
});

const refused = () => {
  expect(useApp.getState().status).toBe(WHY);
  expect(useToasts.getState().toasts.map((t) => t.msg)).toContain(WHY);
  expect(mirrorValues()).toEqual([10, 20, 30]);
};

describe("a mirror cell refuses every edit entry point with the reason", () => {
  beforeEach(() => {
    createMirror("mir", "src", 0);
    useToasts.setState({ toasts: [] });
    useApp.setState({ status: "", statusDanger: null });
  });

  it("a double-click", () => {
    render(<WorksheetPane datasetId="mir" />);
    fireEvent.mouseDown(cell(1, 1), { button: 0 });
    fireEvent.doubleClick(cell(1, 1));
    refused();
    expect(document.querySelector(".qzk-cell-edit")).toBeNull(); // no editor opened
  });

  it("Delete and Backspace", () => {
    render(<WorksheetPane datasetId="mir" />);
    fireEvent.mouseDown(cell(0, 1), { button: 0 });
    fireEvent.keyDown(grid(), { key: "Delete" });
    refused();
    useApp.setState({ status: "" });
    fireEvent.keyDown(grid(), { key: "Backspace" });
    expect(useApp.getState().status).toBe(WHY);
  });

  it("Fill Down over the mirror's cells", () => {
    render(<WorksheetPane datasetId="mir" />);
    fireEvent.mouseDown(cell(0, 1), { button: 0 });
    fireEvent.mouseDown(cell(2, 1), { button: 0, shiftKey: true });
    fireEvent.keyDown(grid(), { key: "d", ctrlKey: true });
    refused();
  });

  it("Cut", () => {
    render(<WorksheetPane datasetId="mir" />);
    fireEvent.mouseDown(cell(0, 1), { button: 0 });
    fireEvent.keyDown(grid(), { key: "x", ctrlKey: true });
    refused();
  });

  it("Paste, from the keyboard and from the cell menu", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { readText: () => Promise.resolve("5\n6"), writeText: () => Promise.resolve() } });
    try {
      render(<WorksheetPane datasetId="mir" />);
      fireEvent.mouseDown(cell(0, 1), { button: 0 });
      fireEvent.keyDown(grid(), { key: "v", ctrlKey: true });
      await waitFor(() => expect(useApp.getState().status).toBe(WHY));
      refused();
      useApp.setState({ status: "" });
      useToasts.setState({ toasts: [] });
      fireEvent.contextMenu(cell(0, 1), { clientX: 20, clientY: 20 });
      clickMenuItem(/^PasteCtrl/);
      await waitFor(() => expect(useApp.getState().status).toBe(WHY));
      refused();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Clear from the cell menu", () => {
    render(<WorksheetPane datasetId="mir" />);
    fireEvent.mouseDown(cell(0, 1), { button: 0 });
    fireEvent.contextMenu(cell(0, 1), { clientX: 20, clientY: 20 });
    clickMenuItem(/^Clear contents/);
    refused();
  });

  it("Set Column Values, from the header menu and from Ctrl+Q", async () => {
    render(<WorksheetPane datasetId="mir" />);
    fireEvent.contextMenu(document.querySelector<HTMLElement>('[role=columnheader][data-col="1"]')!, { clientX: 10, clientY: 10 });
    clickMenuItem(/^Set column values/i);
    await waitFor(() => expect(useApp.getState().status).toBe(WHY)); // the dialog is a lazy chunk
    refused();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    useApp.setState({ status: "" });
    useToasts.setState({ toasts: [] });
    fireEvent.mouseDown(cell(0, 1), { button: 0 });
    fireEvent.keyDown(grid(), { key: "q", ctrlKey: true });
    await waitFor(() => expect(useApp.getState().status).toBe(WHY));
    refused();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(useApp.getState().datasets.find((d) => d.id === "mir")!.formulas![0].expr).toBe('sheet("Run 2", A)');
  });

  it("Delete across the mirror AND an ordinary column still clears the ordinary one", () => {
    render(<WorksheetPane datasetId="mir" />);
    fireEvent.mouseDown(cell(0, 0), { button: 0 });
    fireEvent.mouseDown(cell(0, 1), { button: 0, shiftKey: true });
    fireEvent.keyDown(grid(), { key: "Delete" });
    const mir = useApp.getState().datasets.find((d) => d.id === "mir")!;
    expect(Number.isNaN(mir.data.values[0][0])).toBe(true);
    expect(mirrorValues()).toEqual([10, 20, 30]);
  });
});

describe("a categorical source column", () => {
  it("shows its labels in the mirror's cells, and follows a renamed level", async () => {
    createMirror("mir", "src", 1);
    render(<WorksheetPane datasetId="mir" />);
    expect([0, 1, 2].map((r) => cell(r, 1).textContent)).toEqual(["lo", "hi", "mid"]);
    const { renameLevel } = await import("../../../store/levelRename");
    renameLevel("src", 1, 1, "high");
    await waitFor(() => expect(cell(1, 1).textContent).toBe("high"));
  });

  it("an ordinary computed column still shows its numbers", () => {
    useApp.getState().addFormula("mir", "Double", "A * 2");
    render(<WorksheetPane datasetId="mir" />);
    expect(cell(0, 1).textContent).toBe("200.0000");
  });
});
