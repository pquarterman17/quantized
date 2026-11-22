// Lane WB fail-before: the Baseline estimate on the shared workbench shell.
// Before: (1) an estimate kept serving Subtract after the method or its knobs
// changed, so the output recorded the NEW settings over a baseline computed
// with the OLD ones; (2) an estimate that answered after the inputs changed
// (method, dataset) was still shown and overlaid; (3) one that answered after
// the window closed put its overlay back on the plot. Races are forced with a
// held promise, never waited out.
import { act, renderHook, waitFor } from "@testing-library/react";
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

  it("Estimate on a still-loading book loads it and shows the estimate in one click", async () => {
    vi.mocked(callBaselinePreview).mockResolvedValue({ baseline: [1, 1, 1, 1, 1] });
    const full: DataStruct = { ...raw, time: [1, 2, 3, 4, 5], values: [[10], [12], [11], [13], [14]] };
    useApp.setState({
      datasets: [{
        id: "d1", name: "book.opj", data: { ...raw, time: [1, 2], values: [[10], [12]] },
        pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 5, cols: 1 },
      }],
      resolveDataset: async (id: string) => {
        // Like the store: a pending book is replaced once; a loaded one is returned as is.
        useApp.setState((st) => ({ datasets: st.datasets.map((d) => (d.id === id && d.pending ? { id: d.id, name: d.name, data: full } : d)) }));
        return useApp.getState().datasets.find((d) => d.id === id);
      },
    });
    const { result } = renderHook(() => useBaseline());
    await act(async () => { await result.current.compute(); });
    expect(useApp.getState().datasets[0].pending).toBeUndefined();
    expect(result.current.baseline).toEqual([1, 1, 1, 1, 1]);
    expect(result.current.estimateStale).toBe(false);
    expect(result.current.subtractDisabledReason).toBeNull();
  });

  it("an anchor-mode message clears when the automatic estimate lands", async () => {
    const { result } = renderHook(() => useBaseline());
    act(() => result.current.setMethod("anchor"));
    await act(async () => { await result.current.compute(); });
    expect(result.current.error).toBe("place at least 2 anchors on the plot");
    const bridge = () => useApp.getState().baselineAnchorEdit!;
    act(() => { bridge().addAnchor(1, 10); });
    act(() => { bridge().addAnchor(4, 13); });
    // Wait on STATE (the debounced estimate landing), not on a mock call.
    await waitFor(() => expect(result.current.baseline).toEqual([1, 2, 1, 3]));
    expect(result.current.error).toBeNull();
  });

  it("anchor mode on a still-loading book keeps the anchors through the load and shows the estimate", async () => {
    vi.mocked(callBaselinePreview).mockResolvedValue({ baseline: [1, 1, 1, 1, 1] });
    const full: DataStruct = { ...raw, time: [1, 2, 3, 4, 5], values: [[10], [12], [11], [13], [14]] };
    useApp.setState({
      datasets: [{
        id: "d1", name: "book.opj", data: { ...raw, time: [1, 2], values: [[10], [12]] },
        pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 5, cols: 1 },
      }],
      resolveDataset: async (id: string) => {
        useApp.setState((st) => ({ datasets: st.datasets.map((d) => (d.id === id && d.pending ? { id: d.id, name: d.name, data: full } : d)) }));
        return useApp.getState().datasets.find((d) => d.id === id);
      },
    });
    const { result } = renderHook(() => useBaseline());
    act(() => result.current.setMethod("anchor"));
    const bridge = () => useApp.getState().baselineAnchorEdit!;
    act(() => { bridge().addAnchor(1, 10); });
    act(() => { bridge().addAnchor(2, 12); });
    await waitFor(() => expect(result.current.baseline).toEqual([1, 1, 1, 1, 1]));
    expect(result.current.anchors).toHaveLength(2);
    expect(useApp.getState().datasets[0].pending).toBeUndefined();
  });

  it("a batch error is not wiped when an earlier estimate becomes current again", async () => {
    const { result } = renderHook(() => useBaseline());
    await act(async () => { await result.current.compute(); });
    useApp.setState({ selectedIds: ["d1", "missing"] });
    await act(async () => { await result.current.applyToSelected(); });
    const message = result.current.error;
    expect(message).toBeTruthy();
    act(() => result.current.setParams({ lam: 1e3 }));
    act(() => result.current.setParams({ lam: 1e6 }));
    expect(result.current.error).toBe(message);
  });
});
