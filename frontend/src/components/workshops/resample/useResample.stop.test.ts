// Lane WB2: the batch Stop aborts the resample request in flight (the API
// takes an AbortSignal), so nothing is created for that dataset. The race is
// forced with held requests and fake timers.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResampleRequest, ResampleResult } from "../../../lib/api/resample";
import type { DataStruct } from "../../../lib/types";
import { useResampleDialog } from "../../../store/resampleDialog";
import { useApp } from "../../../store/useApp";
import { PREVIEW_DELAY_MS, useResample } from "./useResample";

vi.mock("../../../lib/api/resample", () => ({ resampleDataset: vi.fn() }));
vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
const { resampleDataset } = await import("../../../lib/api/resample");

interface Call { body: ResampleRequest; signal?: AbortSignal; resolve: () => void }
let calls: Call[];
const answer = (body: ResampleRequest): ResampleResult => ({
  dataset: { ...body.dataset, values: body.dataset.time.map(() => [1]) },
  warnings: [], source_range: [0, 3], rows_in: body.dataset.time.length, rows_out: body.dataset.time.length,
});
const data: DataStruct = { time: [0, 1, 2, 3], values: [[0], [10], [20], [30]], labels: ["M"], units: ["emu"], metadata: {} };

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  // Honours the signal like fetch: an abort rejects with an AbortError.
  vi.mocked(resampleDataset).mockImplementation((body: ResampleRequest, signal?: AbortSignal) =>
    new Promise<ResampleResult>((resolve, reject) => {
      calls.push({ body, signal, resolve: () => resolve(answer(body)) });
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }));
  useApp.setState({
    datasets: [{ id: "a", name: "a.dat", data }, { id: "b", name: "b.dat", data }],
    folders: [], activeId: "a", selectedIds: ["a", "b"], macroSteps: [],
  });
  useResampleDialog.setState({ seed: ["a", "b"] });
});
afterEach(() => vi.useRealTimers());

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

describe("Resample batch Stop", () => {
  it("aborts the request in flight and creates nothing for it or the rest", async () => {
    const { result } = renderHook(() => useResample());
    act(() => { vi.advanceTimersByTime(PREVIEW_DELAY_MS); });
    for (const c of [...calls]) c.resolve();
    await flush();
    expect(result.current.canCreate).toBe(true);
    const before = calls.length;
    let creating!: Promise<void>;
    act(() => { creating = result.current.create(); });
    await flush();
    expect(calls.length).toBe(before + 1);
    const inflight = calls[before];
    expect(inflight.signal?.aborted).toBe(false);
    act(() => result.current.stop());
    expect(inflight.signal?.aborted).toBe(true);
    await act(async () => { await creating; });
    expect(calls.length).toBe(before + 1); // the second dataset never started
    expect(useApp.getState().datasets).toHaveLength(2);
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toContain("2 stopped");
  });
});
