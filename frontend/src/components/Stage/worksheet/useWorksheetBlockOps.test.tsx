// Large-paste feedback (MAIN_PLAN #34). Not a progress bar — the apply is
// O(rows + edits) and a normal paste is imperceptible. This covers the only
// case that can actually stall, where a silent freeze reads as a hang.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LARGE_PASTE_CELLS, useWorksheetBlockOps } from "./useWorksheetBlockOps";
import { categoricalLevels } from "../../../lib/categorical";
import { REDERIVED_EDIT_NOTICE } from "../../../lib/rederived";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

// Typed with the parameter it actually receives. `vi.fn(async () => true)`
// infers a ZERO-argument signature, which type-checks fine under vitest and
// then fails `tsc -b` — the same trap the HomeScreen mock hit. npm test alone
// is not the frontend gate here.
const copyText = vi.fn(async (_text: string): Promise<boolean> => true);
vi.mock("../../../lib/clipboard", () => ({ copyText: (t: string) => copyText(t) }));

const setStatus = vi.fn();
const IDENTITY = Array.from({ length: 100_000 }, (_, i) => i);

function source(rows: number[], cols: number[]) {
  return {
    datasetId: "d1",
    rows,
    cols,
    order: IDENTITY,
    rowCount: 100_000,
    writableCols: 50,
    valueAt: () => 1,
    setStatus,
  };
}

/** A grid of roughly `cells` values, shaped as many ROWS of 2 columns.
 *
 *  Deliberately not one wide row: a paste clips to the writable column count
 *  (50 here), so a single row can never reach the threshold. My first attempt
 *  at this fixture did exactly that — 4,960 of its cells were dropped as
 *  read-only and the test blamed the implementation for staying quiet. */
function grid(cells: number): string {
  const TAB = String.fromCharCode(9);
  const NL = String.fromCharCode(10);
  const rows = Math.ceil(cells / 2);
  return Array.from({ length: rows }, (_, r) => `${r}${TAB}${r + 1}`).join(NL);
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [], activeId: null });
  Object.assign(navigator, { clipboard: { readText: async () => grid(10) } });
});

describe("large-paste feedback", () => {
  it("stays SILENT for an ordinary paste", async () => {
    // A message that flashes for 3 ms is noise, not feedback.
    const { result } = renderHook(() => useWorksheetBlockOps(source([0], [0])));
    result.current.pasteBlock();
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalled());
    expect(setStatus.mock.calls.some((c) => String(c[0]).includes("pasting"))).toBe(false);
  });

  it("announces itself BEFORE applying a very large block", async () => {
    Object.assign(navigator, {
      clipboard: { readText: async () => grid(LARGE_PASTE_CELLS + 10) },
    });
    const { result } = renderHook(() => useWorksheetBlockOps(source([0], [0])));
    result.current.pasteBlock();
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalled());
    expect(setStatus.mock.calls.some((c) => String(c[0]).includes("pasting"))).toBe(true);
  });

  it("still reports the outcome after the large paste", async () => {
    Object.assign(navigator, {
      clipboard: { readText: async () => grid(LARGE_PASTE_CELLS + 10) },
    });
    const { result } = renderHook(() => useWorksheetBlockOps(source([0], [0])));
    result.current.pasteBlock();
    await vi.waitFor(() =>
      expect(setStatus.mock.calls.some((c) => String(c[0]).includes("pasted"))).toBe(true),
    );
  });
});

// A sorted or filtered sheet shows rows out of index order. Every block op must
// follow what the user SEES: y=[50,10,40,20,30] sorted ascending shows rows
// [1,3,4,2,0]. Waits are on STATE (the store, a status list), never on a mock.
describe("block ops follow the visible row order", () => {
  const SORTED = [1, 3, 4, 2, 0];
  const cell = (row: number, col = 0) => useApp.getState().datasets[0].data.values[row][col];
  let statuses: string[] = [];

  function sheet(values: number[][], catLevels?: Record<number, string[]>): Dataset {
    const labels = values[0].map((_, c) => `c${c}`);
    return {
      id: "d1",
      name: "s.dat",
      data: {
        time: values.map((_, i) => i),
        values,
        labels,
        units: labels.map(() => ""),
        metadata: {},
        ...(catLevels ? { cat_levels: catLevels } : {}),
      },
    };
  }

  function live(rows: number[], order: number[]) {
    const data = () => useApp.getState().datasets[0].data;
    return {
      datasetId: "d1",
      rows,
      cols: [0],
      order,
      rowCount: data().time.length,
      writableCols: data().labels.length,
      valueAt: (r: number, c: number) => data().values[r]?.[c],
      levelsAt: (c: number) => categoricalLevels(data(), c),
      setStatus: (m: string) => statuses.push(m),
    };
  }

  const clip = (text: string) => Object.assign(navigator, { clipboard: { readText: async () => text } });

  beforeEach(() => {
    statuses = [];
    useApp.setState({ datasets: [sheet([[50], [10], [40], [20], [30]])], activeId: "d1" });
  });

  it("pastes over the top visible rows of a sorted sheet", async () => {
    clip("5\n6\n7");
    const { result } = renderHook(() => useWorksheetBlockOps(live([1, 3, 4], SORTED)));
    result.current.pasteBlock();
    await vi.waitFor(() => expect(cell(4)).toBe(7));
    expect([cell(1), cell(3), cell(4)]).toEqual([5, 6, 7]);
    expect(cell(2)).toBe(40); // original order would have written here
  });

  it("never pastes into a row the filter hides", async () => {
    clip("5\n6\n7");
    const { result } = renderHook(() => useWorksheetBlockOps(live([2], [0, 2, 4])));
    result.current.pasteBlock();
    await vi.waitFor(() => expect(cell(4)).toBe(6));
    expect(cell(2)).toBe(5);
    expect(cell(3)).toBe(20); // hidden: untouched
    expect(statuses.at(-1)).toMatch(/1 outside the sheet/);
  });

  it("fills down from the top VISIBLE row, not the smallest index", () => {
    const { result } = renderHook(() => useWorksheetBlockOps(live([4, 2, 0], SORTED)));
    result.current.fillDown();
    expect([cell(4), cell(2), cell(0)]).toEqual([30, 30, 30]);
  });

  it("copies rows in the visible order and skips hidden selected rows", () => {
    const { result } = renderHook(() => useWorksheetBlockOps(live([0, 1, 2, 4], [4, 2, 0])));
    result.current.copyBlock();
    expect(copyText).toHaveBeenCalledWith("30\n40\n50");
  });

  it("skips text in a numeric column instead of blanking cells", async () => {
    clip("control\n1,5\n7");
    const { result } = renderHook(() => useWorksheetBlockOps(live([0], [0, 1, 2, 3, 4])));
    result.current.pasteBlock();
    await vi.waitFor(() => expect(statuses.at(-1)).toMatch(/^pasted/));
    expect([cell(0), cell(1), cell(2)]).toEqual([50, 10, 7]);
    expect(statuses.at(-1)).toBe("pasted 1 cell, skipped 2 non-numeric");
  });

  it("maps pasted labels to level codes in a categorical column", async () => {
    useApp.setState({ datasets: [sheet([[0], [0], [1]], { 0: ["control", "treated"] })] });
    clip("treated\ncontrol\nsham");
    const { result } = renderHook(() => useWorksheetBlockOps(live([0], [0, 1, 2])));
    result.current.pasteBlock();
    await vi.waitFor(() => expect(cell(2)).toBe(2));
    expect([cell(0), cell(1)]).toEqual([1, 0]);
    expect(useApp.getState().datasets[0].data.cat_levels?.[0]).toEqual(["control", "treated", "sham"]);
    expect(statuses.at(-1)).toBe("pasted 3 cells, added 1 level");
  });

  it("reports the re-derived refusal instead of a paste/fill count", () => {
    const corrected = { ...sheet([[1], [2], [3]]), corrections: [], raw: sheet([[1], [2], [3]]).data };
    useApp.setState({ datasets: [corrected as Dataset] });
    const { result } = renderHook(() => useWorksheetBlockOps(live([0, 1], [0, 1, 2])));
    result.current.fillDown();
    result.current.clearBlock();
    expect(cell(1)).toBe(2);
    expect(statuses).toEqual([REDERIVED_EDIT_NOTICE, REDERIVED_EDIT_NOTICE]);
  });
});
