// Notes on copy and paste (ROW_RANGE_CONTRACT 7.2, D16): an in-app paste replaces the pasted cells' notes
// cell for cell (an empty source cell clears), a plain paste leaves every note alone, and a stale record
// (the clipboard no longer holds the text the copy wrote) attaches nothing. One undo reverts values and notes.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { noteAt } from "../../../lib/cellNotes";
import type { Dataset } from "../../../lib/types";
import { setCellNote } from "../../../store/cellNotes";
import { useApp } from "../../../store/useApp";
import { useWorksheetBlockOps } from "./useWorksheetBlockOps";

let clip = "";
vi.mock("../../../lib/clipboard", () => ({
  copyText: async (t: string) => {
    clip = t;
    return true;
  },
}));

const sheet = (): Dataset => ({
  id: "d1",
  name: "n",
  data: { time: [0, 1, 2, 3, 4], values: [[1, 10], [2, 20], [3, 30], [4, 40], [5, 50]], labels: ["A", "B"], units: ["", ""], metadata: {} },
});
const ds = () => useApp.getState().datasets[0];
const note = (row: number, col: number) => noteAt(ds().data.metadata, row, col);
const ORDER = [0, 1, 2, 3, 4];

function ops(rows: number[], cols: number[]) {
  return renderHook(() =>
    useWorksheetBlockOps({
      datasetId: "d1", rows, cols, order: ORDER, rowCount: 5, writableCols: 2,
      valueAt: (r, c) => ds().data.values[r]?.[c] ?? null, setStatus: () => {},
    }),
  ).result.current;
}

/** Copy rows 0-1 of column A (notes on row 0 only), then paste at row 2. */
async function copyThenPaste(readText: () => string): Promise<void> {
  ops([0, 1], [0]).copyBlock();
  await vi.waitFor(() => expect(clip).toBe("1\n2"));
  await Promise.resolve();
  Object.assign(navigator, { clipboard: { readText: async () => readText() } });
  ops([2], [0]).pasteBlock();
  await vi.waitFor(() => expect(ds().data.values[2][0]).not.toBe(3));
  await new Promise((r) => setTimeout(r, 30)); // the notes half loads lazily, after the paste
}

beforeEach(async () => {
  clip = "";
  useApp.setState({ datasets: [sheet()], activeId: "d1", history: [], future: [], status: "" });
  setCellNote("d1", 0, 0, "copied note");
  setCellNote("d1", 3, 0, "destination note"); // under the second pasted cell
  setCellNote("d1", 4, 1, "far away");
  useApp.setState({ history: [], future: [] });
});

describe("notes on paste", () => {
  it("an in-app paste carries the note to the pasted cell and clears the destination of an empty source cell", async () => {
    await copyThenPaste(() => clip);
    expect(ds().data.values.map((r) => r[0])).toEqual([1, 2, 1, 2, 5]);
    expect(note(2, 0)).toBe("copied note");
    expect(note(3, 0)).toBeUndefined(); // source row 1 had no note: the destination's is cleared
    expect(note(0, 0)).toBe("copied note"); // a copy leaves its source alone
    expect(note(4, 1)).toBe("far away"); // outside the pasted cells: untouched
  });

  it("one undo reverts the values AND the notes", async () => {
    await copyThenPaste(() => clip);
    useApp.getState().undo();
    expect(ds().data.values.map((r) => r[0])).toEqual([1, 2, 3, 4, 5]);
    expect(note(2, 0)).toBeUndefined();
    expect(note(3, 0)).toBe("destination note");
  });

  it("a plain paste (text that no in-app copy wrote) leaves every note alone", async () => {
    await copyThenPaste(() => "7\n8");
    expect(ds().data.values.map((r) => r[0])).toEqual([1, 2, 7, 8, 5]);
    expect(note(2, 0)).toBeUndefined();
    expect(note(3, 0)).toBe("destination note");
    expect(note(0, 0)).toBe("copied note");
  });

  it("a stale record attaches nothing: another copy since, or text of another shape", async () => {
    ops([0, 1], [0]).copyBlock();
    await vi.waitFor(() => expect(clip).toBe("1\n2"));
    ops([4], [1]).copyBlock(); // a newer in-app copy replaces the record (its own cell holds a note)
    await vi.waitFor(() => expect(clip).toBe("50"));
    Object.assign(navigator, { clipboard: { readText: async () => "1\n2" } }); // the OLD text is back on the clipboard
    ops([2], [0]).pasteBlock();
    await vi.waitFor(() => expect(ds().data.values[2][0]).toBe(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(note(2, 0)).toBeUndefined();
    expect(note(3, 0)).toBe("destination note");
  });
});

describe("notes on cut", () => {
  it("a cut MOVES the note: the source gives it up, the paste attaches it, one undo each way", async () => {
    ops([0, 1], [0]).cutBlock();
    await vi.waitFor(() => expect(Number.isNaN(ds().data.values[0][0])).toBe(true));
    await vi.waitFor(() => expect(note(0, 0)).toBeUndefined());
    Object.assign(navigator, { clipboard: { readText: async () => clip } });
    ops([2], [0]).pasteBlock();
    await vi.waitFor(() => expect(note(2, 0)).toBe("copied note"));
    expect(note(0, 0)).toBeUndefined();
    expect(note(3, 0)).toBeUndefined(); // the empty source cell cleared the destination's
    useApp.getState().undo(); // the paste
    expect(note(2, 0)).toBeUndefined();
    expect(note(3, 0)).toBe("destination note");
    useApp.getState().undo(); // the cut: values and the source note are back
    expect(ds().data.values[0][0]).toBe(1);
    expect(note(0, 0)).toBe("copied note");
  });
});
