// Hide / Show / Freeze columns end to end in the worksheet pane (gap audit 5,
// item 8): the toolbar "Columns" button and the header right-click menu drive
// the store (one undo step each), the header says columns are hidden, the cell
// cursor steps over hidden columns, and a hidden column is still in the data and
// still plottable.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import WorksheetPane from "./WorksheetPane";

const sheet = (): Dataset => ({
  id: "w",
  name: "PPMS",
  data: {
    time: [1, 2],
    values: [
      [10, 20, 30, 40],
      [11, 21, 31, 41],
    ],
    labels: ["Temp", "Field", "Moment", "Error"],
    units: ["K", "Oe", "emu", "emu"],
    metadata: { x_column_name: "Time" },
  },
});

const st = () => useApp.getState();
const ds = () => st().datasets[0];
const grid = () => screen.getByRole("grid");
const headerCols = () => Array.from(document.querySelectorAll<HTMLElement>('[role="columnheader"][data-col]')).map((h) => Number(h.dataset.col));
const cellAt = (pos: number, col: number) => document.querySelector<HTMLElement>(`[role=gridcell][id$="-r${pos}-c${col + 1}"]`)!;
const key = (k: string, opts: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(document.activeElement ?? grid(), { key: k, ...opts });
const header = (col: number) => document.querySelector<HTMLElement>(`[role="columnheader"][data-col="${col}"]`)!;

beforeEach(() => {
  useApp.setState({ datasets: [sheet()], activeId: "w", worksheetId: null, history: [], future: [], status: "" });
});

describe("Columns menu", () => {
  it("hides the right-clicked column in one undo step, keeping its data and plot membership", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.contextMenu(header(1));
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));
    expect(headerCols()).toEqual([-1, 0, 2, 3]);
    expect(ds().hiddenCols).toEqual([1]);
    expect(ds().data.labels).toEqual(["Temp", "Field", "Moment", "Error"]);
    expect(ds().data.values[0]).toEqual([10, 20, 30, 40]);
    expect(st().history).toHaveLength(1);
    // Still a plot channel: the view's plotted set was not touched.
    expect(st().yKeys == null || st().yKeys!.includes(1)).toBe(true);
    // The toolbar now says so.
    expect(screen.getByRole("button", { name: /Columns · 1 hidden/ })).toBeTruthy();
    act(() => st().undo());
    expect(headerCols()).toEqual([-1, 0, 1, 2, 3]);
  });

  it("the toolbar lists hidden columns to show one, and Show all brings every one back", () => {
    useApp.setState({ datasets: [{ ...sheet(), hiddenCols: [1, 2] }] });
    render(<WorksheetPane datasetId="w" />);
    expect(headerCols()).toEqual([-1, 0, 3]);
    fireEvent.click(screen.getByRole("button", { name: /Columns · 2 hidden/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Hidden columns \(2\)/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Show Field" }));
    expect(ds().hiddenCols).toEqual([2]);
    expect(headerCols()).toEqual([-1, 0, 1, 3]);
    fireEvent.click(screen.getByRole("button", { name: /Columns · 1 hidden/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Show all columns/ }));
    expect(ds().hiddenCols).toBeUndefined();
    expect(headerCols()).toEqual([-1, 0, 1, 2, 3]);
  });

  it("clicking the header's hidden marker shows that run", () => {
    useApp.setState({ datasets: [{ ...sheet(), hiddenCols: [1, 2] }] });
    render(<WorksheetPane datasetId="w" />);
    fireEvent.click(within(header(0)).getByRole("button", { name: /2 hidden columns after Temp: Field, Moment/ }));
    expect(ds().hiddenCols).toBeUndefined();
  });

  it("freezes through the right-clicked column, and Unfreeze undoes it", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.contextMenu(header(1));
    fireEvent.click(screen.getByRole("menuitem", { name: /Freeze through "Field"/ }));
    expect(ds().frozenCols).toBe(2);
    expect(header(1).style.position).toBe("sticky");
    expect(st().history).toHaveLength(1);
    fireEvent.contextMenu(header(3));
    fireEvent.click(screen.getByRole("menuitem", { name: /Unfreeze columns/ }));
    expect(ds().frozenCols).toBeUndefined();
    expect(st().history).toHaveLength(2);
  });

  it("Hide acts on the whole header selection when the clicked column is part of it", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.click(header(0));
    fireEvent.click(header(2), { ctrlKey: true });
    fireEvent.contextMenu(header(2));
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide 2 columns" }));
    expect(ds().hiddenCols).toEqual([0, 2]);
    expect(st().history).toHaveLength(1);
    // The hidden columns left the selection, so "Plot selection" has nothing stale.
    expect(screen.queryByText(/columns? selected/)).toBeNull();
  });

  it("the X column cannot be hidden", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.contextMenu(header(-1));
    expect(screen.getByRole("menuitem", { name: "Hide column" })).toBeDisabled();
  });
});

describe("keyboard navigation skips hidden columns", () => {
  it("arrows, Tab and Ctrl+arrow never land on a hidden column; aria-activedescendant follows", () => {
    useApp.setState({ datasets: [{ ...sheet(), hiddenCols: [1, 2] }] });
    render(<WorksheetPane datasetId="w" />);
    fireEvent.mouseDown(cellAt(0, 0));
    grid().focus();
    key("ArrowRight");
    expect(grid().getAttribute("aria-activedescendant")).toBe(cellAt(0, 3).id);
    key("Tab", { shiftKey: true });
    expect(grid().getAttribute("aria-activedescendant")).toBe(cellAt(0, 0).id);
    key("ArrowRight", { ctrlKey: true });
    expect(grid().getAttribute("aria-activedescendant")).toBe(cellAt(0, 3).id);
    expect(cellAt(0, 1)).toBeNull(); // hidden cells are not in the DOM at all
  });

  it("a block copied across a hidden column leaves it out", async () => {
    let clip = "";
    Object.assign(navigator, { clipboard: { readText: () => Promise.resolve(clip), writeText: (t: string) => ((clip = t), Promise.resolve()) } });
    useApp.setState({ datasets: [{ ...sheet(), hiddenCols: [1, 2] }] });
    render(<WorksheetPane datasetId="w" />);
    fireEvent.mouseDown(cellAt(0, -1));
    grid().focus();
    key("ArrowRight", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    await act(async () => {
      key("c", { ctrlKey: true });
    });
    expect(clip).toBe("1\t10\t40"); // X, Temp, Error — Field and Moment stay out
  });
});
