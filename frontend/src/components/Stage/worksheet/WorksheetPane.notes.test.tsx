// Cell notes in the real worksheet (ROW_RANGE_CONTRACT 7.2): add, edit and delete from the cell menu, the
// corner mark and the hover text, the mark following its cell through a sort, and the same note in the
// export wire (a comment on the exported cell).

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { noteAt } from "../../../lib/cellNotes";
import type { Dataset } from "../../../lib/types";
import { useParamDialog } from "../../../store/paramDialog";
import { sortWorksheetRows } from "../../../store/sortRows";
import { useApp } from "../../../store/useApp";
import { allMenuLabels } from "../../../test/contextMenuNav";
import WorksheetPane from "./WorksheetPane";
import { worksheetNotesWire } from "./worksheetNotesWire";

const ds = (): Dataset => ({
  id: "d1",
  name: "cells",
  data: { time: [0, 1, 2], values: [[30, 1], [10, 2], [20, 3]], labels: ["A", "B"], units: ["", ""], metadata: {} },
});
const stored = () => useApp.getState().datasets[0];
const cell = (pos: number, col: number): HTMLElement => document.querySelector<HTMLElement>(`[role=gridcell][id$="-r${pos}-c${col + 1}"]`)!;

beforeEach(() => {
  useParamDialog.getState().close();
  useApp.setState({ datasets: [ds()], activeId: "d1", selectedIds: [], history: [], future: [] });
});

async function answer(text: string): Promise<void> {
  await vi_waitForDialog();
  await act(async () => {
    useParamDialog.getState().resolve?.({ text });
    useParamDialog.getState().close();
  });
}
const vi_waitForDialog = async () => {
  for (let i = 0; i < 50 && !useParamDialog.getState().resolve; i += 1) await act(async () => new Promise((r) => setTimeout(r, 10)));
};
async function menuItem(pos: number, col: number, name: RegExp): Promise<void> {
  fireEvent.contextMenu(cell(pos, col), { clientX: 40, clientY: 40 });
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

describe("cell notes in the worksheet", () => {
  it("adds a note from the cell menu: corner mark, hover text, accessible description, one undo step", async () => {
    render(<WorksheetPane datasetId="d1" />);
    expect(cell(1, 1)).not.toHaveClass("qzk-has-note");
    await menuItem(1, 1, /^Add note/);
    await answer("check this one");
    expect(noteAt(stored().data.metadata, 1, 1)).toBe("check this one");
    expect(cell(1, 1)).toHaveClass("qzk-has-note");
    expect(cell(1, 1)).toHaveAttribute("title", "check this one");
    expect(cell(1, 1)).toHaveAttribute("aria-description", "check this one");
    expect(cell(0, 1)).not.toHaveClass("qzk-has-note");
    act(() => useApp.getState().undo());
    expect(cell(1, 1)).not.toHaveClass("qzk-has-note");
  });

  it("a noted cell offers Edit and Delete instead of Add; Delete removes it", async () => {
    render(<WorksheetPane datasetId="d1" />);
    await menuItem(2, 0, /^Add note/);
    await answer("first");
    fireEvent.contextMenu(cell(2, 0), { clientX: 40, clientY: 40 });
    expect(allMenuLabels()).toContain("Edit note…Alt+Shift+F2"); // the label carries its shortcut
    expect(allMenuLabels()).toContain("Delete note");
    expect(allMenuLabels().some((l) => l.startsWith("Add note"))).toBe(false);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await menuItem(2, 0, /^Edit note/);
    await answer("second");
    expect(noteAt(stored().data.metadata, 2, 0)).toBe("second");
    await menuItem(2, 0, /^Delete note/);
    await vi_tick();
    expect(cell(2, 0)).not.toHaveClass("qzk-has-note");
  });

  it("the mark follows its cell through a sort", async () => {
    render(<WorksheetPane datasetId="d1" />);
    await menuItem(0, 0, /^Add note/); // the cell holding 30
    await answer("thirty");
    act(() => sortWorksheetRows("d1", 0, 1)); // A ascending: 10, 20, 30
    expect(stored().data.values.map((r) => r[0])).toEqual([10, 20, 30]);
    expect(cell(2, 0)).toHaveClass("qzk-has-note");
    expect(cell(2, 0)).toHaveAttribute("title", "thirty");
    expect(cell(0, 0)).not.toHaveClass("qzk-has-note");
  });

  it("the export wire puts the note on the exported cell (rows chosen, columns in table order)", async () => {
    render(<WorksheetPane datasetId="d1" />);
    await menuItem(2, 1, /^Add note/); // row 2, column B
    await answer("export me");
    // Export rows 2 then 0: the noted source row 2 is exported row 0; the table is X, A, B so B is column 2.
    expect(worksheetNotesWire(stored(), [2, 0])).toEqual([{ row: 0, col: 2, text: "export me" }]);
    expect(worksheetNotesWire(stored(), [0, 1])).toEqual([]); // the noted row is not exported
  });
});

const vi_tick = () => act(async () => new Promise((r) => setTimeout(r, 30)));
