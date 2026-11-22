// Baseline subtract on the shared commit contract (lane RL2). Fail-before: a
// second Subtract on the same estimate wrote a second "(bg-sub)" worksheet, the
// output was not tied to a Library result, and nothing marked it stale when the
// source changed. The race test holds the full-baseline fetch open (no timing).
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { callBaselinePreview } from "./baselineCall";
import { useBaseline } from "./useBaseline";

vi.mock("./baselineCall", async (orig) => ({ ...(await orig<typeof import("./baselineCall")>()), callBaselinePreview: vi.fn() }));

const raw: DataStruct = { time: [1, 2, 3, 4], values: [[10], [12], [11], [13]], labels: ["I"], units: ["cps"], metadata: {} };
const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "d1");

beforeEach(() => {
  vi.mocked(callBaselinePreview).mockReset();
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: raw }], activeId: "d1", status: "", baselineOverlay: null,
    xKey: null, yKeys: null, seriesOrder: null, analysisResults: [], history: [], future: [],
    staleDatasets: [], staleFits: [], recalcMode: "manual",
  });
});

async function estimated(full?: () => Promise<number[]>) {
  vi.mocked(callBaselinePreview).mockResolvedValue({ baseline: [1, 2, 1, 3], ...(full ? { full } : {}) });
  const hook = renderHook(() => useBaseline());
  await act(async () => { await hook.result.current.compute(); });
  return hook;
}

describe("Baseline subtract commits through the shared contract", () => {
  it("a repeat Subtract on the same estimate creates no duplicate", async () => {
    const { result } = await estimated();
    await act(async () => { await result.current.subtract(); });
    expect(outputs()).toHaveLength(1);
    // Subtract opens the output; back on the source the same estimate is
    // recomputed and Subtract says why it is unavailable (and does nothing).
    act(() => useApp.getState().setActive("d1"));
    await act(async () => { await result.current.compute(); });
    expect(result.current.subtractDisabledReason).toContain(`Already added as “${outputs()[0].name}”`);
    await act(async () => { await result.current.subtract(); });
    expect(outputs()).toHaveLength(1);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().analysisResults[0].producer.label).toBe("Baseline subtract");
  });

  it("is one undo step with its Library result, and Undo re-enables Subtract", async () => {
    const { result } = await estimated();
    await act(async () => { await result.current.subtract(); });
    expect(useApp.getState().history).toHaveLength(1);
    act(() => useApp.getState().undo());
    expect(outputs()).toHaveLength(0);
    expect(useApp.getState().analysisResults).toHaveLength(0);
    act(() => useApp.getState().setActive("d1"));
    await act(async () => { await result.current.compute(); });
    expect(result.current.subtractDisabledReason).toBeNull();
    await act(async () => { await result.current.subtract(); });
    expect(outputs()).toHaveLength(1);
  });

  it("a changed parameter is a new computation and commits normally", async () => {
    const { result } = await estimated();
    await act(async () => { await result.current.subtract(); });
    vi.mocked(callBaselinePreview).mockResolvedValue({ baseline: [2, 2, 2, 2] });
    await act(async () => { result.current.setParams({ lam: 1e5 }); await result.current.compute(); });
    await act(async () => { await result.current.subtract(); });
    expect(outputs()).toHaveLength(2);
  });

  it("two clicks during a pending full-baseline fetch make ONE commit", async () => {
    let release!: (full: number[]) => void;
    const full = vi.fn(() => new Promise<number[]>((resolve) => { release = resolve; }));
    const { result } = await estimated(full);
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = result.current.subtract();
      second = result.current.subtract();
    });
    // The fetch is held open: nothing is written yet, the button says why.
    expect(full).toHaveBeenCalledTimes(1);
    expect(outputs()).toHaveLength(0);
    expect(result.current.subtractDisabledReason).toBe("Adding the output…");
    await act(async () => { release([1, 2, 1, 3]); await Promise.all([first, second]); });
    expect(outputs()).toHaveLength(1);
    expect(full).toHaveBeenCalledTimes(1);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(1);
  });

  it("marks the committed output stale when its source changes", async () => {
    const { result } = await estimated();
    await act(async () => { await result.current.subtract(); });
    const outputId = outputs()[0].id;
    act(() => {
      useApp.setState((s) => ({ datasets: s.datasets.map((d) => d.id === "d1" ? { ...d, data: { ...d.data, time: [1, 2, 3, 9] } } : d) }));
      useApp.getState().touchDataset("d1");
    });
    expect(useApp.getState().staleDatasets).toEqual([outputId]);
  });
});
