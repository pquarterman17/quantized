// Large-paste feedback (MAIN_PLAN #34). Not a progress bar — the apply is
// O(rows + edits) and a normal paste is imperceptible. This covers the only
// case that can actually stall, where a silent freeze reads as a hang.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LARGE_PASTE_CELLS, useWorksheetBlockOps } from "./useWorksheetBlockOps";
import { useApp } from "../../../store/useApp";

// Typed with the parameter it actually receives. `vi.fn(async () => true)`
// infers a ZERO-argument signature, which type-checks fine under vitest and
// then fails `tsc -b` — the same trap the HomeScreen mock hit. npm test alone
// is not the frontend gate here.
const copyText = vi.fn(async (_text: string): Promise<boolean> => true);
vi.mock("../../../lib/clipboard", () => ({ copyText: (t: string) => copyText(t) }));

const setStatus = vi.fn();

function source(rows: number[], cols: number[]) {
  return {
    datasetId: "d1",
    rows,
    cols,
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
