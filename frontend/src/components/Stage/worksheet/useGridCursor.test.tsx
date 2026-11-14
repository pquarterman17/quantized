// The worksheet cell cursor end to end in the pane (worksheet audit #4/#5):
// before it, a selected cell could not be typed into (double-click only),
// Enter dropped focus to <body>, arrows/Tab did nothing, a non-number became a
// silent blank, Ctrl+V with no row+column selection created a NEW DATASET, and
// nothing could be typed below the last row. Every check reads store state.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import WorksheetPane from "./WorksheetPane";

const sheet = (): Dataset => ({
  id: "w",
  name: "Book1",
  data: { time: [1, 2], values: [[10], [20]], labels: ["A"], units: [""], metadata: { x_column_name: "X" } },
});

const st = () => useApp.getState();
const ds = () => st().datasets[0];
const grid = () => screen.getByRole("grid");
const cellAt = (pos: number, col: number) => document.querySelector<HTMLElement>(`[role=gridcell][id$="-r${pos}-c${col + 1}"]`)!;
const key = (k: string, opts: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(document.activeElement ?? grid(), { key: k, ...opts });
const editor = () => document.activeElement as HTMLInputElement;

beforeEach(() => {
  useApp.setState({ datasets: [sheet()], activeId: "w", worksheetId: null, history: [], future: [], status: "" });
});

describe("worksheet cell cursor", () => {
  it("click a cell, type to replace it, Enter commits and moves down with focus kept on the grid", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.mouseDown(cellAt(0, 0));
    grid().focus();
    expect(cellAt(0, 0)).toHaveAttribute("aria-selected", "true");
    key("7");
    expect(editor().value).toBe("7");
    fireEvent.change(editor(), { target: { value: "75" } });
    key("Enter");
    expect(ds().data.values[0]).toEqual([75]);
    expect(document.activeElement).toBe(grid());
    expect(grid().getAttribute("aria-activedescendant")).toBe(cellAt(1, 0).id);
  });

  it("arrows and Tab move; F2 keeps the value; Escape cancels the edit", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.mouseDown(cellAt(0, -1));
    grid().focus();
    key("ArrowDown");
    key("Tab");
    expect(grid().getAttribute("aria-activedescendant")).toBe(cellAt(1, 0).id);
    key("F2");
    expect(editor().value).toBe("20");
    fireEvent.change(editor(), { target: { value: "99" } });
    key("Escape");
    expect(ds().data.values[1]).toEqual([20]);
    expect(st().history).toEqual([]);
  });

  it("keys on a focused toolbar button stay the button's: no cursor move, no cell edit", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.mouseDown(cellAt(0, 0));
    const before = grid().getAttribute("aria-activedescendant");
    const stats = screen.getByRole("button", { name: /Stats/ });
    fireEvent.keyDown(stats, { key: "Enter" });
    fireEvent.keyDown(stats, { key: "7" });
    expect(grid().getAttribute("aria-activedescendant")).toBe(before);
    expect(document.querySelector(".qzk-cell-edit")).toBeNull();
  });

  it("a non-number is refused, not written as a blank", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.mouseDown(cellAt(0, 0));
    grid().focus();
    key("a");
    fireEvent.change(editor(), { target: { value: "abc" } });
    key("Enter");
    expect(ds().data.values[0]).toEqual([10]);
    expect(st().status).toMatch(/"abc" is not a number/);
  });

  it("Delete clears the selected cell range in one undo step", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.mouseDown(cellAt(0, -1));
    grid().focus();
    key("ArrowRight", { shiftKey: true });
    key("ArrowDown", { shiftKey: true });
    key("Delete");
    expect(ds().data.time).toEqual([NaN, NaN]);
    expect(ds().data.values).toEqual([[NaN], [NaN]]);
    expect(st().history).toHaveLength(1);
  });

  it("typing into the blank entry row under the data appends a row — one undo step", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.mouseDown(cellAt(1, -1));
    grid().focus();
    key("ArrowDown"); // onto the entry row
    key("3");
    key("Enter");
    expect(ds().data.time).toEqual([1, 2, 3]);
    expect(st().history).toHaveLength(1);
    act(() => st().undo());
    expect(ds().data.time).toEqual([1, 2]);
  });

  it("Ctrl+C copies the cell range as TSV (Excel-ready); Ctrl+D fills the top row down it", async () => {
    let clip = "";
    Object.assign(navigator, { clipboard: { readText: () => Promise.resolve(clip), writeText: (t: string) => ((clip = t), Promise.resolve()) } });
    render(<WorksheetPane datasetId="w" />);
    fireEvent.mouseDown(cellAt(0, -1));
    grid().focus();
    key("ArrowRight", { shiftKey: true });
    key("ArrowDown", { shiftKey: true });
    await act(async () => {
      key("c", { ctrlKey: true });
    });
    expect(clip).toBe("1\t10\n2\t20");
    key("d", { ctrlKey: true });
    expect(ds().data.time).toEqual([1, 1]);
    expect(ds().data.values).toEqual([[10], [10]]);
    expect(st().history).toHaveLength(1);
  });

  it("Ctrl+V on the grid is the worksheet's paste: the global 'paste as new dataset' stays out", async () => {
    let clip = "5\t50\n6\t60\n";
    Object.assign(navigator, { clipboard: { readText: () => Promise.resolve(clip), writeText: (t: string) => ((clip = t), Promise.resolve()) } });
    render(<WorksheetPane datasetId="w" />);
    fireEvent.mouseDown(cellAt(1, -1));
    grid().focus();
    const ev = new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => {
      grid().dispatchEvent(ev);
      await Promise.resolve();
    });
    expect(ev.defaultPrevented).toBe(true); // what useGlobalShortcuts now honours
    await act(async () => {});
    expect(st().datasets).toHaveLength(1);
    expect(ds().data.time).toEqual([1, 5, 6]);
    expect(ds().data.values).toEqual([[10], [50], [60]]);
  });
});
