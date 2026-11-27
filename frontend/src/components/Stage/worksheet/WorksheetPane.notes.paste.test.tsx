// Every paste entry point carries cell notes the same way (ROW_RANGE_CONTRACT 7.2, D16), through the REAL
// worksheet and store: cursor paste (Ctrl+V), the cell menu's Paste, a paste into a row selection, and a
// paste of text no in-app copy wrote. A copy copies the note, a cut moves it, an empty source cell clears
// the target's note, an external paste leaves every note alone, and one undo restores values and notes.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { noteAt } from "../../../lib/cellNotes";
import type { Dataset } from "../../../lib/types";
import { setCellNote } from "../../../store/cellNotes";
import { useApp } from "../../../store/useApp";
import WorksheetPane from "./WorksheetPane";

const sheet = (): Dataset => ({
  id: "d1",
  name: "n",
  data: { time: [0, 1, 2, 3, 4, 5], values: [[1, 10], [2, 20], [3, 30], [4, 40], [5, 50], [6, 60]], labels: ["A", "B"], units: ["", ""], metadata: {} },
});
const st = () => useApp.getState();
const ds = () => st().datasets[0];
const note = (row: number, col: number) => noteAt(ds().data.metadata, row, col);
const cell = (pos: number, col: number): HTMLElement => document.querySelector<HTMLElement>(`[role=gridcell][id$="-r${pos}-c${col + 1}"]`)!;
const grid = (): HTMLElement => document.getElementById(document.querySelector("[role=grid]")!.id)!;
const gutter = (row: number): HTMLElement => [...document.querySelectorAll<HTMLElement>("[role=rowheader]")].find((e) => e.textContent === String(row + 1))!;
const key = (k: string) => fireEvent.keyDown(grid(), { key: k, ctrlKey: true });
const settle = () => act(async () => new Promise((r) => setTimeout(r, 60))); // the notes half loads lazily

let clip = "";
function select(pos: number, col: number) {
  fireEvent.mouseDown(cell(pos, col));
  grid().focus();
}
async function copyOrCut(k: "c" | "x", pos: number, col: number) {
  select(pos, col);
  await act(async () => key(k));
  await settle();
}
async function ctrlV(pos: number, col: number) {
  select(pos, col);
  await act(async () => key("v"));
  await settle();
}

beforeEach(() => {
  clip = "";
  Object.assign(navigator, { clipboard: { readText: () => Promise.resolve(clip), writeText: (t: string) => ((clip = t), Promise.resolve()) } });
  useApp.setState({ datasets: [sheet()], activeId: "d1", worksheetId: null, selectedIds: [], history: [], future: [], status: "" });
  setCellNote("d1", 1, 0, "source note");
  setCellNote("d1", 4, 1, "target note");
  setCellNote("d1", 5, 0, "far away");
  useApp.setState({ history: [], future: [] });
});

describe("cell notes on every paste path", () => {
  it("copy then Ctrl+V at the cursor copies the note; the source keeps its own; one undo restores values and notes", async () => {
    render(<WorksheetPane datasetId="d1" />);
    await copyOrCut("c", 1, 0);
    expect(clip).toBe("2");
    await ctrlV(3, 0);
    expect(ds().data.values[3][0]).toBe(2);
    expect(note(3, 0)).toBe("source note");
    expect(note(1, 0)).toBe("source note");
    expect(note(5, 0)).toBe("far away");
    expect(st().history).toHaveLength(1);
    act(() => st().undo());
    expect(ds().data.values[3][0]).toBe(4);
    expect(note(3, 0)).toBeUndefined();
    expect(note(1, 0)).toBe("source note");
  });

  it("an empty source cell clears the target's note", async () => {
    render(<WorksheetPane datasetId="d1" />);
    await copyOrCut("c", 2, 1); // 30, no note
    await ctrlV(4, 1);
    expect(ds().data.values[4][1]).toBe(30);
    expect(note(4, 1)).toBeUndefined();
    act(() => st().undo());
    expect(note(4, 1)).toBe("target note");
  });

  it("cut then Ctrl+V moves the note, and the status says the cut took it", async () => {
    render(<WorksheetPane datasetId="d1" />);
    await copyOrCut("x", 1, 0);
    expect(note(1, 0)).toBeUndefined();
    expect(st().status).toMatch(/1 note — paste to move them, Undo to put them back/);
    await ctrlV(3, 0);
    expect(note(3, 0)).toBe("source note");
    expect(note(1, 0)).toBeUndefined();
    act(() => st().undo()); // the paste: values and the moved note together
    expect(note(3, 0)).toBeUndefined();
    expect(ds().data.values[3][0]).toBe(4);
    act(() => st().undo()); // the cut: the source note comes back
    expect(note(1, 0)).toBe("source note");
    expect(ds().data.values[1][0]).toBe(2);
  });

  it("the cell menu's Paste carries the note too", async () => {
    render(<WorksheetPane datasetId="d1" />);
    await copyOrCut("c", 1, 0);
    select(2, 0);
    fireEvent.contextMenu(cell(2, 0), { clientX: 30, clientY: 30 });
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: /^Paste(?! special)/ })));
    await settle();
    expect(ds().data.values[2][0]).toBe(2);
    expect(note(2, 0)).toBe("source note");
    expect(st().history).toHaveLength(1);
  });

  it("a paste into a selected row (the range path) carries the note", async () => {
    render(<WorksheetPane datasetId="d1" />);
    await copyOrCut("c", 1, 0);
    fireEvent.click(gutter(3)); // the row selection drops the cell cursor, so Ctrl+V takes the block-ops path
    fireEvent.click(document.querySelector<HTMLElement>('[role=columnheader][data-col="0"]')!, { ctrlKey: true });
    grid().focus();
    await act(async () => key("v"));
    await settle();
    expect(ds().data.values[3][0]).toBe(2);
    expect(note(3, 0)).toBe("source note");
    act(() => st().undo());
    expect(note(3, 0)).toBeUndefined();
    expect(ds().data.values[3][0]).toBe(4);
  });

  it("text no in-app copy wrote pastes values and leaves every note alone", async () => {
    render(<WorksheetPane datasetId="d1" />);
    await copyOrCut("c", 1, 0);
    clip = "99"; // another app copied since
    await ctrlV(4, 1);
    expect(ds().data.values[4][1]).toBe(99);
    expect(note(4, 1)).toBe("target note");
    expect(note(1, 0)).toBe("source note");
    expect(note(5, 0)).toBe("far away");
  });

  it("a cursor paste that grows the sheet still carries the notes onto the new rows", async () => {
    render(<WorksheetPane datasetId="d1" />);
    // A two-row in-app copy pasted at the last row grows the sheet; the notes follow onto the added row.
    setCellNote("d1", 0, 0, "first");
    select(0, 0);
    fireEvent.keyDown(grid(), { key: "ArrowDown", shiftKey: true });
    await act(async () => key("c"));
    await settle();
    expect(clip).toBe("1\n2");
    await ctrlV(5, 0);
    expect(ds().data.time).toHaveLength(7);
    expect(note(5, 0)).toBe("first");
    expect(note(6, 0)).toBe("source note");
  });
});
