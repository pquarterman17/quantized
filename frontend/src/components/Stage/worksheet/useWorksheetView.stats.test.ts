// The stats footer re-sent EVERY column (1M x 6: 7M values) to
// /api/stats/descriptive on every cell edit, rename or exclusion toggle. It
// now caches per column, keyed by the column's content version and the
// analysis rows, and requests only the columns that changed. Pinned by request
// and value counts, never a clock; every assertion waits on hook STATE.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { statsDescriptive } from "../../../lib/api/statsDescriptive";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useWorksheetView } from "./useWorksheetView";

vi.mock("../../../lib/api/statsDescriptive", () => ({ statsDescriptive: vi.fn() }));

const CHANNELS = 3;

function sheet(rows: number): Dataset {
  return {
    id: "s",
    name: "s.dat",
    data: {
      time: Array.from({ length: rows }, (_, i) => i),
      values: Array.from({ length: rows }, (_, i) => Array.from({ length: CHANNELS }, (_, c) => i * 10 + c)),
      labels: ["a", "b", "c"],
      units: ["", "", ""],
      metadata: {},
    },
  };
}

/** `ds` with one cell of channel `col` overwritten, the way the store's cell
 *  edit does it: a new outer array, only the edited row replaced. */
function editCell(ds: Dataset, row: number, col: number, value: number): Dataset {
  const values = ds.data.values.slice();
  values[row] = values[row].map((v, c) => (c === col ? value : v));
  return { ...ds, data: { ...ds.data, values } };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** Values sent to the stats route since the last clear. */
const valuesSent = () => sum(vi.mocked(statsDescriptive).mock.calls.map(([col]) => col.length));

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.mocked(statsDescriptive).mockImplementation(async (col: number[]) => ({ sum: sum(col), N: col.length }));
  useApp.setState({ datasets: [], activeId: null, selection: null, worksheetSelections: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the stats footer's per-column cache", () => {
  for (const rows of [200, 800]) {
    it(`re-requests only the edited column after a cell edit (${rows} rows)`, async () => {
      const ds = sheet(rows);
      const { result, rerender } = renderHook(({ d }) => useWorksheetView(d), { initialProps: { d: ds } });
      act(() => result.current.setShowStats(true));
      await settle();
      expect(result.current.colStats).toHaveLength(CHANNELS + 1);
      expect(valuesSent()).toBe(rows * (CHANNELS + 1));

      vi.mocked(statsDescriptive).mockClear();
      const edited = editCell(ds, 5, 1, -1000);
      rerender({ d: edited });
      await settle();
      expect(result.current.colStats?.[2]).toEqual({ sum: sum(edited.data.values.map((r) => r[1])), N: rows });
      expect(statsDescriptive).toHaveBeenCalledTimes(1);
      expect(valuesSent()).toBe(rows); // one column, not all of them
    });
  }

  it("re-requests nothing when the dataset changes but its data and rows do not", async () => {
    const ds = sheet(50);
    const { result, rerender } = renderHook(({ d }) => useWorksheetView(d), { initialProps: { d: ds } });
    act(() => result.current.setShowStats(true));
    await settle();
    const first = result.current.colStats;
    vi.mocked(statsDescriptive).mockClear();

    rerender({ d: { ...ds, name: "renamed.dat" } });
    await settle();
    expect(result.current.colStats).toEqual(first);
    expect(statsDescriptive).not.toHaveBeenCalled();
  });

  it("re-requests every column once when the excluded rows change, and none when hidden and shown again", async () => {
    const ds = sheet(50);
    const { result, rerender } = renderHook(({ d }) => useWorksheetView(d), { initialProps: { d: ds } });
    act(() => result.current.setShowStats(true));
    await settle();
    vi.mocked(statsDescriptive).mockClear();

    rerender({ d: { ...ds, excludedRows: [3] } });
    await settle();
    expect(result.current.colStats?.[0]).toEqual({ sum: sum(ds.data.time) - 3, N: 49 });
    expect(statsDescriptive).toHaveBeenCalledTimes(CHANNELS + 1);

    vi.mocked(statsDescriptive).mockClear();
    act(() => result.current.setShowStats(false));
    act(() => result.current.setShowStats(true));
    await settle();
    expect(result.current.colStats?.[0]).toEqual({ sum: sum(ds.data.time) - 3, N: 49 });
    expect(statsDescriptive).not.toHaveBeenCalled();
  });

  it("requests a newly added column without re-requesting the others", async () => {
    const ds = sheet(40);
    const { result, rerender } = renderHook(({ d }) => useWorksheetView(d), { initialProps: { d: ds } });
    act(() => result.current.setShowStats(true));
    await settle();
    vi.mocked(statsDescriptive).mockClear();

    const values = ds.data.values.map((r) => [...r, 1]);
    rerender({ d: { ...ds, data: { ...ds.data, values, labels: [...ds.data.labels, "d"], units: [...ds.data.units, ""] } } });
    await settle();
    expect(result.current.colStats?.[CHANNELS + 1]).toEqual({ sum: 40, N: 40 });
    expect(statsDescriptive).toHaveBeenCalledTimes(1);
  });
});
