// The note editor from the keyboard and its multi-line box (plan item 34, cell notes). Shift+F2 already opens the
// header editor of the cursor's column (Origin's Edit Long Name / Units / Comments, shown as the shortcut in the
// column menu), so the note editor takes Alt+Shift+F2 and leaves Shift+F2 alone. Enter in the note's box adds a
// line; Ctrl+Enter saves.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { noteAt } from "../../../lib/cellNotes";
import type { Dataset } from "../../../lib/types";
import { useParamDialog } from "../../../store/paramDialog";
import { useApp } from "../../../store/useApp";
import ParamDialog from "../../overlays/ParamDialogBody";
import WorksheetPane from "./WorksheetPane";

const sheet = (extra: Partial<Dataset> = {}): Dataset => ({
  id: "w",
  name: "Book1",
  data: { time: [1, 2, 3], values: [[10], [20], [30]], labels: ["A"], units: [""], metadata: { x_column_name: "X" } },
  ...extra,
});
const st = () => useApp.getState();
const grid = () => screen.getByRole("grid");
const cellAt = (pos: number, col: number) => document.querySelector<HTMLElement>(`[role=gridcell][id$="-r${pos}-c${col + 1}"]`)!;
const key = (k: string, opts: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(document.activeElement ?? grid(), { key: k, ...opts });
const settle = () => act(async () => new Promise((r) => setTimeout(r, 40)));
const note = (row: number, col: number) => noteAt(st().datasets[0].data.metadata, row, col);

beforeEach(() => {
  useParamDialog.getState().close();
  useApp.setState({ datasets: [sheet()], activeId: "w", worksheetId: null, history: [], future: [], status: "" });
});

function focusCell(pos: number, col: number): void {
  fireEvent.mouseDown(cellAt(pos, col));
  grid().focus();
}

describe("Alt+Shift+F2 opens the note editor for the cursor's cell", () => {
  it("opens it ON that cell's source row and column, pre-filled with the current note, in a multi-line box", async () => {
    render(<><WorksheetPane datasetId="w" /><ParamDialog /></>);
    focusCell(1, 0);
    key("F2", { shiftKey: true, altKey: true });
    await settle();
    const box = await screen.findByRole("textbox", { name: /A, row 2/ });
    expect(box.tagName).toBe("TEXTAREA");
    // Save a note with a newline in it, with Ctrl+Enter.
    fireEvent.change(box, { target: { value: "first line\nsecond line" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await settle();
    expect(note(1, 0)).toBe("first line\nsecond line");
    expect(note(0, 0)).toBeUndefined();
    expect(st().history).toHaveLength(1);
    // Again: pre-filled, editable.
    focusCell(1, 0);
    key("F2", { shiftKey: true, altKey: true });
    const again = await screen.findByRole("textbox", { name: /A, row 2/ });
    expect((again as HTMLTextAreaElement).value).toBe("first line\nsecond line");
  });

  it("maps the cursor position to the SOURCE row on a sorted view, not the position", async () => {
    useApp.setState({ datasets: [sheet({ data: { ...sheet().data, values: [[30], [10], [20]] } })] });
    render(<><WorksheetPane datasetId="w" /><ParamDialog /></>);
    fireEvent.contextMenu(document.querySelector<HTMLElement>('[data-col="0"]')!, { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole("menuitem", { name: /^View sorted ascending/ })); // the DISPLAY order is now 10, 20, 30
    focusCell(0, 0); // the first DISPLAYED row holds 10: source row 1
    key("F2", { shiftKey: true, altKey: true });
    const box = await screen.findByRole("textbox", { name: /A, row 2/ });
    fireEvent.change(box, { target: { value: "ten" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await settle();
    expect(note(1, 0)).toBe("ten");
  });

  it("Shift+F2 alone still opens the header editor, and no note editor", async () => {
    render(<><WorksheetPane datasetId="w" /><ParamDialog /></>);
    focusCell(1, 0);
    key("F2", { shiftKey: true });
    await settle();
    expect(screen.getByRole("dialog", { name: /Edit header of/ })).toBeInTheDocument();
    expect(useParamDialog.getState().title).toBeNull();
  });

  it("a plain F2 still edits the cell's value", () => {
    render(<WorksheetPane datasetId="w" />);
    focusCell(1, 0);
    key("F2");
    expect((document.activeElement as HTMLInputElement).value).toBe("20");
    expect(useParamDialog.getState().title).toBeNull();
  });

  it("on a re-derived sheet it says why instead of opening an editor", async () => {
    useApp.setState({ datasets: [sheet({ derivedFrom: { sourceId: "src" } as never })] });
    render(<><WorksheetPane datasetId="w" /><ParamDialog /></>);
    focusCell(1, 0);
    key("F2", { shiftKey: true, altKey: true });
    await settle();
    expect(useParamDialog.getState().title).toBeNull();
    expect(st().status.length).toBeGreaterThan(0);
  });

  it("on the blank entry row under the data it asks for a data cell", async () => {
    render(<><WorksheetPane datasetId="w" /><ParamDialog /></>);
    focusCell(3, 0); // the entry row
    key("F2", { shiftKey: true, altKey: true });
    await settle();
    expect(useParamDialog.getState().title).toBeNull();
    expect(st().status).toMatch(/data cell/);
  });
});

describe("the note box is multi-line", () => {
  it("Enter inserts a newline and saves nothing; Ctrl+Enter and Cmd+Enter save; Escape cancels", async () => {
    render(<><WorksheetPane datasetId="w" /><ParamDialog /></>);
    focusCell(0, 0);
    key("F2", { shiftKey: true, altKey: true });
    const box = await screen.findByRole("textbox", { name: /A, row 1/ });
    fireEvent.change(box, { target: { value: "a" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await settle();
    expect(note(0, 0)).toBeUndefined(); // Enter alone did not confirm
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await settle();
    expect(note(0, 0)).toBe("a");

    focusCell(2, 0);
    key("F2", { shiftKey: true, altKey: true });
    const box2 = await screen.findByRole("textbox", { name: /A, row 3/ });
    fireEvent.change(box2, { target: { value: "dropped" } });
    fireEvent.keyDown(box2, { key: "Escape" });
    await settle();
    expect(note(2, 0)).toBeUndefined();
  });

  it("the cell menu's entry shows the shortcut", () => {
    render(<WorksheetPane datasetId="w" />);
    fireEvent.contextMenu(cellAt(1, 0), { clientX: 40, clientY: 40 });
    expect(screen.getByRole("menuitem", { name: /^Add note/ })).toHaveTextContent("Alt+Shift+F2");
  });
});
