// Lane WB characterization: the Resample preview contract the shared workbench
// shell must keep (written before the migration). Races are forced with held
// promises and fake timers, never waited out.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResampleRequest, ResampleResult } from "../../../lib/api/resample";
import type { DataStruct } from "../../../lib/types";
import { useResampleDialog } from "../../../store/resampleDialog";
import { useApp } from "../../../store/useApp";
import { PREVIEW_DELAY_MS, useResample } from "./useResample";

vi.mock("../../../lib/api/resample", () => ({ resampleDataset: vi.fn() }));
const { resampleDataset } = await import("../../../lib/api/resample");

interface Call { body: ResampleRequest; signal?: AbortSignal; resolve: () => void }
let calls: Call[];
const answer = (body: ResampleRequest): ResampleResult => ({
  dataset: { ...body.dataset, values: body.dataset.time.map(() => [body.n_points ?? -1]) },
  warnings: [], source_range: [0, 3], rows_in: body.dataset.time.length, rows_out: body.dataset.time.length,
});
const a: DataStruct = { time: [0, 1, 2, 3], values: [[0], [10], [20], [30]], labels: ["M"], units: ["emu"], metadata: {} };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  calls = [];
  vi.mocked(resampleDataset).mockImplementation((body: ResampleRequest, signal?: AbortSignal) =>
    new Promise<ResampleResult>((resolve) => { calls.push({ body, signal, resolve: () => resolve(answer(body)) }); }));
  useApp.setState({ datasets: [{ id: "d1", name: "a.dat", data: a }], folders: [], activeId: "d1", selectedIds: ["d1"] });
  useResampleDialog.setState({ seed: ["d1"] });
});
afterEach(() => vi.useRealTimers());

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("useResample preview contract (characterization, lane WB)", () => {
  it("debounces by PREVIEW_DELAY_MS", () => {
    renderHook(() => useResample());
    act(() => { vi.advanceTimersByTime(PREVIEW_DELAY_MS - 1); });
    expect(calls).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(1); });
    expect(calls).toHaveLength(1);
  });

  it("aborts the in-flight preview on an edit and never shows its late answer", async () => {
    const { result } = renderHook(() => useResample());
    act(() => { vi.advanceTimersByTime(PREVIEW_DELAY_MS); });
    act(() => result.current.setForm({ nPoints: "7" }));
    expect(calls[0].signal?.aborted).toBe(true);
    act(() => { vi.advanceTimersByTime(PREVIEW_DELAY_MS); });
    calls[1].resolve();
    await flush();
    calls[0].resolve(); // the stale answer lands last
    await flush();
    expect(result.current.entries[0].result?.data.values[0]).toEqual([7]);
    expect(result.current.canCreate).toBe(true);
  });

  it("aborts the in-flight preview on unmount", () => {
    const { unmount } = renderHook(() => useResample());
    act(() => { vi.advanceTimersByTime(PREVIEW_DELAY_MS); });
    unmount();
    expect(calls[0].signal?.aborted).toBe(true);
  });

  it("is loading (Create disabled) from an edit until its own preview lands", async () => {
    const { result } = renderHook(() => useResample());
    act(() => { vi.advanceTimersByTime(PREVIEW_DELAY_MS); });
    calls[0].resolve();
    await flush();
    expect(result.current.canCreate).toBe(true);
    act(() => result.current.setForm({ nPoints: "9" }));
    expect(result.current.loading).toBe(true);
    expect(result.current.canCreate).toBe(false);
    expect(result.current.entries).toEqual([]);
  });
});
