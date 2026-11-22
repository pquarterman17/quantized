// Lane WB fail-before: the Baseline estimate on the shared workbench shell.
// Before: (1) an estimate kept serving Subtract after the method or its knobs
// changed, so the output recorded the NEW settings over a baseline computed
// with the OLD ones; (2) an estimate that answered after the inputs changed
// (method, dataset) was still shown and overlaid; (3) one that answered after
// the window closed put its overlay back on the plot. Races are forced with a
// held promise, never waited out.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { callBaselinePreview, type BaselinePreview } from "./baselineCall";
import { useBaseline } from "./useBaseline";

vi.mock("./baselineCall", async (orig) => ({ ...(await orig<typeof import("./baselineCall")>()), callBaselinePreview: vi.fn() }));

const raw: DataStruct = { time: [1, 2, 3, 4], values: [[10], [12], [11], [13]], labels: ["I"], units: ["cps"], metadata: {} };
const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "d1" && d.id !== "d2");

beforeEach(() => {
  vi.mocked(callBaselinePreview).mockReset();
  vi.mocked(callBaselinePreview).mockResolvedValue({ baseline: [1, 2, 1, 3] });
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: raw }, { id: "d2", name: "other.dat", data: raw }], activeId: "d1", status: "",
    baselineOverlay: null, xKey: null, yKeys: null, seriesOrder: null, analysisResults: [], history: [], future: [],
    staleDatasets: [], staleFits: [], recalcMode: "manual",
  });
});

function held() {
  let release!: (v: BaselinePreview) => void;
  vi.mocked(callBaselinePreview).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  return (v: BaselinePreview) => release(v);
}

describe("Baseline estimate on the workbench shell (lane WB)", () => {
  it("a knob changed after the estimate blocks Subtract until it is estimated again", async () => {
    const { result } = renderHook(() => useBaseline());
    await act(async () => { await result.current.compute(); });
    expect(result.current.subtractDisabledReason).toBeNull();
    act(() => result.current.setParams({ lam: 1e3 }));
    expect(result.current.estimateStale).toBe(true);
    expect(result.current.subtractDisabledReason).toMatch(/changed since this estimate/);
    await act(async () => { await result.current.subtract(); });
    expect(outputs()).toHaveLength(0);
    // The estimate stays visible (marked stale) rather than vanishing.
    expect(result.current.baseline).toEqual([1, 2, 1, 3]);
    await act(async () => { await result.current.compute(); });
    expect(result.current.estimateStale).toBe(false);
    await act(async () => { await result.current.subtract(); });
    expect(outputs()).toHaveLength(1);
    const settings = useApp.getState().analysisResults[0].parameters?.settings as { params: { lam: number } } | undefined;
    expect(settings?.params.lam).toBe(1e3); // provenance = the settings actually estimated
  });

  it("forces the race: an estimate answering after a method change is never shown", async () => {
    const release = held();
    const { result } = renderHook(() => useBaseline());
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.compute(); await Promise.resolve(); });
    act(() => result.current.setMethod("snip"));
    await act(async () => { release({ baseline: [9, 9, 9, 9] }); await pending; });
    expect(result.current.baseline).toBeNull();
    expect(useApp.getState().baselineOverlay).toBeNull();
    expect(result.current.subtractDisabledReason).toBeNull(); // nothing to subtract (button hidden by `baseline`)
  });

  it("forces the race: an estimate answering after the dataset changed is never overlaid", async () => {
    const release = held();
    const { result } = renderHook(() => useBaseline());
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.compute(); await Promise.resolve(); });
    act(() => useApp.getState().setActive("d2"));
    await act(async () => { release({ baseline: [9, 9, 9, 9] }); await pending; });
    expect(result.current.baseline).toBeNull();
    expect(useApp.getState().baselineOverlay).toBeNull();
  });

  it("an estimate answering after the window closed leaves no overlay", async () => {
    const release = held();
    const { result, unmount } = renderHook(() => useBaseline());
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.compute(); await Promise.resolve(); });
    act(() => result.current.clear()); // the panel's Close
    unmount();
    await act(async () => { release({ baseline: [9, 9, 9, 9] }); await pending; });
    expect(useApp.getState().baselineOverlay).toBeNull();
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("an estimate failure shows its message for those inputs only", async () => {
    vi.mocked(callBaselinePreview).mockRejectedValue(new Error("ALS did not converge"));
    const { result } = renderHook(() => useBaseline());
    await act(async () => { await result.current.compute(); });
    expect(result.current.error).toBe("ALS did not converge");
    act(() => result.current.setParams({ lam: 1e3 }));
    expect(result.current.error).toBeNull();
  });
});
