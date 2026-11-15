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
});
