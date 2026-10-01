// Silent-failure audit (2026-10-01): BaselinePanel fires `void subtract()` and
// `void applyAnchors()`, and both awaited the full-data resolve with no catch —
// a pending book whose fetch failed (moved source, expired upload) did nothing
// visible. Each case forces that rejection and asserts the workshop's error line.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections as applyCorrectionsApi } from "../../../lib/api";
import { baselineALS, baselineAnchor } from "../../../lib/api/baseline";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useBaseline } from "./useBaseline";

vi.mock("../../../lib/api", () => ({ applyCorrections: vi.fn(), fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/baseline", () => ({
  baselineALS: vi.fn(),
  baselineAnchor: vi.fn(),
  baselineEstimate: vi.fn(),
  baselineModPoly: vi.fn(),
  baselineRegion: vi.fn(),
  baselineRollingBall: vi.fn(),
  baselineShirley: vi.fn(),
  baselineXrdLowAngle: vi.fn(),
}));

const raw: DataStruct = {
  time: [1, 2, 3, 4],
  values: [[10], [12], [11], [13]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
};
const originalResolve = useApp.getState().resolveDataset;
const failResolve = () =>
  useApp.setState({ resolveDataset: () => Promise.reject(new Error("source moved")) });

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: raw }],
    activeId: "d1",
    status: "",
    baselineOverlay: null,
    baselineAnchorEdit: null,
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    resolveDataset: originalResolve,
  });
});
afterEach(() => useApp.setState({ resolveDataset: originalResolve }));

describe("useBaseline full-data load failures", () => {
  it("subtract reports a failed load on the error line and adds nothing", async () => {
    vi.mocked(baselineALS).mockResolvedValue({ baseline: [1, 1, 1, 1] });
    const { result } = renderHook(() => useBaseline());
    await act(async () => result.current.compute());
    failResolve();

    await act(async () => {
      await expect(result.current.subtract()).resolves.toBeUndefined();
    });

    expect(result.current.error).toBe("couldn't load the full dataset — source moved");
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("Apply −BG reports a failed load and keeps the anchors for a retry", async () => {
    const { result } = renderHook(() => useBaseline());
    act(() => result.current.setMethod("anchor"));
    act(() => useApp.getState().baselineAnchorEdit!.addAnchor(1, 10));
    act(() => useApp.getState().baselineAnchorEdit!.addAnchor(4, 12));
    failResolve();

    await act(async () => {
      await expect(result.current.applyAnchors()).resolves.toBeUndefined();
    });

    expect(result.current.error).toBe("couldn't load the full dataset — source moved");
    expect(result.current.anchors).toHaveLength(2);
    expect(applyCorrectionsApi).not.toHaveBeenCalled();
  });

  it("Apply −BG does not claim a subtraction when its nested subtract's load fails", async () => {
    // A non-primary plotted channel routes Apply through subtract(); a second
    // resolve that rejects must not be followed by a "subtracted" status.
    const multi: DataStruct = { ...raw, values: raw.values.map((r) => [r[0], r[0] * 2]), labels: ["I", "J"], units: ["cps", "cps"] };
    useApp.setState({ datasets: [{ id: "d1", name: "scan.dat", data: multi }], yKeys: [1], seriesOrder: [1] });
    const { result } = renderHook(() => useBaseline());
    act(() => result.current.setMethod("anchor"));
    act(() => useApp.getState().baselineAnchorEdit!.addAnchor(1, 10));
    act(() => useApp.getState().baselineAnchorEdit!.addAnchor(4, 12));
    vi.mocked(baselineAnchor).mockResolvedValue({ baseline: [1, 1, 1, 1] });
    await act(async () => result.current.compute());
    expect(result.current.baseline).toEqual([1, 1, 1, 1]);
    let calls = 0;
    useApp.setState({
      resolveDataset: (id: string) =>
        ++calls === 1 ? originalResolve(id) : Promise.reject(new Error("source moved")),
    });

    await act(async () => result.current.applyAnchors());

    expect(result.current.error).toBe("couldn't load the full dataset — source moved");
    expect(useApp.getState().status).not.toContain("subtracted");
    expect(result.current.anchors).toHaveLength(2);
  });
});
