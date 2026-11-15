// Ctrl+A on the worksheet grid selects every cell WITHOUT moving the viewport
// (gap audit 6, lane N / P8): it used to place the cursor on the last cell,
// which raised a reveal and jumped the view to the bottom-right. Ctrl+C after
// it still copies the whole block.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

const realH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("qzk-grid") ? 240 : 0;
    },
  });
  useApp.setState({ datasets: [big()], activeId: "w", worksheetId: null, history: [], future: [], status: "" });
});
afterEach(() => {
  if (realH) Object.defineProperty(HTMLElement.prototype, "clientHeight", realH);
});

const grid = () => screen.getByRole("grid");
const cellAt = (pos: number, col: number) => document.querySelector<HTMLElement>(`[role=gridcell][id$="-r${pos}-c${col + 1}"]`)!;

describe("worksheet Ctrl+A", () => {
  it("selects all cells and leaves the scroll position alone", async () => {
    let clip = "";
    Object.assign(navigator, { clipboard: { readText: () => Promise.resolve(clip), writeText: (t: string) => ((clip = t), Promise.resolve()) } });
    render(<WorksheetPane datasetId="w" />);
    const scroller = document.querySelector<HTMLElement>(".qzk-grid")!;
    fireEvent.mouseDown(cellAt(0, 0));
    grid().focus();
    const before = scroller.scrollTop;
    fireEvent.keyDown(grid(), { key: "a", ctrlKey: true });
    expect(scroller.scrollTop).toBe(before);
    expect(cellAt(0, 0)).toHaveAttribute("aria-selected", "true");
    await act(async () => {
      fireEvent.keyDown(grid(), { key: "c", ctrlKey: true });
    });
    const lines = clip.split("\n");
    expect(lines).toHaveLength(N);
    expect(lines[N - 1]).toBe(`${N - 1}\t${(N - 1) * 10}`);
  });
});
