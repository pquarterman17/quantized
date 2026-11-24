// UX audit 10 (P1-5): right-clicking a data CELL opens a cell menu with Cut /
// Copy / Paste / Clear contents / Fill down (it used to open the row-number
// menu); the right-clicked cell joins the selection unless it is already in it.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { allMenuLabels } from "../../../test/contextMenuNav";
import WorksheetPane from "./WorksheetPane";

const ds: Dataset = {
  id: "d1",
  name: "cells",
  data: { time: [0, 1, 2], values: [[10, 1], [20, 2], [30, 3]], labels: ["A", "B"], units: ["", ""], metadata: {} },
};

beforeEach(() => {
  useApp.setState({ datasets: [ds], activeId: "d1", selectedIds: [] });
});

const cell = (pos: number, col: number): HTMLElement => document.querySelector<HTMLElement>(`[role=gridcell][id$="-r${pos}-c${col + 1}"]`)!; // col -1 is X

describe("worksheet cell context menu", () => {
  it("offers Cut, Copy, Paste, Clear contents and Fill down on a data cell, then the row entries", () => {
    render(<WorksheetPane datasetId="d1" />);
    fireEvent.mouseDown(cell(0, 0), { button: 0 });
    fireEvent.contextMenu(cell(1, 0), { clientX: 40, clientY: 40 });
    const labels = allMenuLabels();
    for (const want of ["Cut", "Copy", "Paste", "Clear contents", "Fill down", "Mask row", "Copy row (TSV)"]) expect(labels.some((l) => l.startsWith(want)), want).toBe(true);
    // The cell block comes first (the entries carry their shortcut text).
    expect(screen.getAllByRole("menuitem")[0]).toHaveTextContent("Cut");
  });

  it("Clear contents clears the right-clicked cell, selecting it first when it was outside the range", () => {
    render(<WorksheetPane datasetId="d1" />);
    fireEvent.mouseDown(cell(0, 0), { button: 0 }); // the cursor sits elsewhere
    fireEvent.contextMenu(cell(2, 1), { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole("menuitem", { name: /^Clear contents/ }));
    const v = useApp.getState().datasets[0].data.values;
    expect(Number.isNaN(v[2][1]) || v[2][1] == null).toBe(true);
    expect(v[0][0]).toBe(10); // the earlier cell is untouched
  });

  it("the row-number right-click is still the row menu (no cell block entries)", () => {
    render(<WorksheetPane datasetId="d1" />);
    const gutter = cell(1, 0).closest('[role="row"]')!.firstElementChild as HTMLElement;
    fireEvent.contextMenu(gutter, { clientX: 5, clientY: 5 });
    expect(allMenuLabels()).not.toContain("Clear contents");
    expect(allMenuLabels()).toContain("Mask row");
  });
});
