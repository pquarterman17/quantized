// Ctrl+A on the worksheet grid selects every cell WITHOUT moving the viewport
// and keeps the cell that was active before it, as Excel does (gap audit 6,
// lane N / P8). It used to place the cursor on the LAST cell, which raised a
// reveal (the view jumped bottom-right); and the first fix left that last cell
// active while off-screen, so typing edited an invisible cell and the next
// arrow key jumped there anyway. jsdom does not scroll, so the checks read the
// active cell (aria-activedescendant) — which is where a reveal would aim.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import WorksheetPane from "./WorksheetPane";

const N = 300;
const big = (): Dataset => ({
  id: "w",
  name: "Book1",
  data: {
    time: Array.from({ length: N }, (_, i) => i),
    values: Array.from({ length: N }, (_, i) => [i * 10]),
    labels: ["A"],
    units: [""],
    metadata: { x_column_name: "X" },
  },
});

beforeEach(() => {
  useApp.setState({ datasets: [big()], activeId: "w", worksheetId: null, history: [], future: [], status: "" });
});

const grid = () => screen.getByRole("grid");
const cellAt = (pos: number, col: number) => document.querySelector<HTMLElement>(`[role=gridcell][id$="-r${pos}-c${col + 1}"]`)!;
const active = () => grid().getAttribute("aria-activedescendant");
const key = (k: string, opts: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(grid(), { key: k, ...opts });

function selectAllFromCell(pos: number, col: number) {
  render(<WorksheetPane datasetId="w" />);
  fireEvent.mouseDown(cellAt(pos, col));
  grid().focus();
  const id = active();
  key("a", { ctrlKey: true });
  return id;
}

describe("worksheet Ctrl+A", () => {
  it("selects everything, keeps the active cell where it was, and copies the full block", async () => {
    let clip = "";
    Object.assign(navigator, { clipboard: { readText: () => Promise.resolve(clip), writeText: (t: string) => ((clip = t), Promise.resolve()) } });
    const before = selectAllFromCell(2, 0);
    expect(active()).toBe(before); // not the last cell (old place() moved it, and the view with it)
    expect(cellAt(2, 0)).toHaveAttribute("aria-selected", "true");
    await act(async () => {
      key("c", { ctrlKey: true });
    });
    const lines = clip.split("\n");
    expect(lines).toHaveLength(N);
    expect(lines[N - 1]).toBe(`${N - 1}\t${(N - 1) * 10}`);
  });

  it("an arrow key then moves from the pre-select-all cell and collapses the selection", () => {
    selectAllFromCell(2, 0);
    key("ArrowDown");
    expect(active()).toBe(cellAt(3, 0).id);
    expect(cellAt(2, 0)).toHaveAttribute("aria-selected", "false");
  });

  it("typing after Ctrl+A edits the pre-select-all cell, not the last one", () => {
    selectAllFromCell(2, 0);
    key("7");
    const input = document.activeElement as HTMLInputElement;
    expect(input.value).toBe("7");
    fireEvent.change(input, { target: { value: "75" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useApp.getState().datasets[0].data.values[2]).toEqual([75]);
    expect(useApp.getState().datasets[0].data.values[N - 1]).toEqual([(N - 1) * 10]);
  });

  it("Delete still clears the whole selection", () => {
    selectAllFromCell(2, 0);
    key("Delete");
    expect(useApp.getState().datasets[0].data.values[N - 1]).toEqual([NaN]);
  });

  it("with the previously active column hidden, the active cell moves to a shown column (never a hidden one)", () => {
    const d = big();
    d.data = { ...d.data, values: d.data.values.map((r) => [r[0]!, r[0]! + 1, r[0]! + 2]), labels: ["A", "B", "C"], units: ["", "", ""] };
    useApp.setState({ datasets: [d] });
    render(<WorksheetPane datasetId="w" />);
    fireEvent.mouseDown(cellAt(2, 1));
    grid().focus();
    act(() => useApp.setState({ datasets: [{ ...d, hiddenCols: [1] }] }));
    key("a", { ctrlKey: true });
    const id = active();
    expect(id).not.toMatch(/-r2-c2$/); // c2 = channel index 1, the hidden one
    expect(id).toMatch(/-r2-c(1|3)$/); // a shown neighbour, same row
    key("ArrowDown");
    const next = active();
    expect(next).not.toMatch(/-c2$/);
    expect(next).toMatch(/-r3-c/);
  });

  it("hiding the remembered active column AFTER Ctrl+A: the active cell and the next arrow key stay on shown columns", () => {
    const d = big();
    d.data = { ...d.data, values: d.data.values.map((r) => [r[0]!, r[0]! + 1, r[0]! + 2]), labels: ["A", "B", "C"], units: ["", "", ""] };
    useApp.setState({ datasets: [d] });
    render(<WorksheetPane datasetId="w" />);
    fireEvent.mouseDown(cellAt(2, 1));
    grid().focus();
    key("a", { ctrlKey: true });
    act(() => useApp.setState({ datasets: [{ ...d, hiddenCols: [1] }] }));
    expect(active()).not.toMatch(/-r2-c2$/);
    key("ArrowDown");
    expect(active()).not.toMatch(/-c2$/);
    expect(active()).toMatch(/-r3-c/);
  });
});
