// Optical gap (lane WB6 audit). The result is keyed by every input (rows, picks,
// units, window, thickness, transition) and is withheld, not shown stale, when
// any of them moves: already correct, pinned here (including a lazy book, which
// the pick effect resolves as soon as the tool opens). No code change needed.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TaucResult } from "../../../lib/api/analysisExtras";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { makePending, restoreResolve } from "../workbench/pendingBook.testkit";
import { useOpticalGap } from "./useOpticalGap";

const { taucMock } = vi.hoisted(() => ({ taucMock: vi.fn() }));
vi.mock("../../../lib/api/analysisExtras", () => ({ taucFit: taucMock }));

const EV: DataStruct = {
  time: [2, 2.5, 3, 3.5], values: [[1e3], [1e4], [5e4], [9e4]], labels: ["alpha"], units: ["1/cm"],
  metadata: { x_column_name: "Energy", x_column_unit: "eV" },
};
const RES: TaucResult = {
  kind: "direct", label: "Direct allowed", gamma: 2, eg: 2.35, eg_se: 0.01, eg_se_fit: 0.01, eg_window_sd: null, eg_lcl: 2.32, eg_ucl: 2.38, level: 0.95,
  slope: 100, intercept: -235, r2: 0.999, n_fit: 5, e_min: 2.6, e_max: 3.2, auto_window: false,
  energy: [2, 2.6, 3, 3.2], tauc: [0, 25, 65, 85], alpha: [0, 1, 2, 3], fit_energy: [2.35, 3.2], fit_tauc: [0, 85],
};

beforeEach(() => {
  vi.clearAllMocks();
  restoreResolve();
  taucMock.mockResolvedValue(RES);
  useApp.setState({ datasets: [{ id: "a", name: "abs", data: EV }], activeId: "a", status: "", analysisResults: [], history: [], future: [] });
});

async function fitted() {
  const hook = renderHook(() => useOpticalGap());
  await waitFor(() => expect(hook.result.current.xUnit).toBe("eV"));
  await act(async () => { await hook.result.current.fit(); });
  return hook;
}

describe("Optical gap result freshness", () => {
  it("characterization: a setting, a window or a row change withholds the result; setting it back restores it", async () => {
    const { result } = await fitted();
    expect(result.current.result?.eg).toBe(2.35);
    act(() => result.current.setKind("indirect"));
    expect(result.current.result).toBeNull();
    act(() => result.current.setKind("direct"));
    expect(result.current.result?.eg).toBe(2.35);
    act(() => result.current.setEMin("2.6"));
    expect(result.current.result).toBeNull();
    act(() => result.current.setEMin(""));
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [0] })) })));
    expect(result.current.result).toBeNull();
    expect(result.current.addDisabledReason).toMatch(/run the analysis first/i);
  });

  it("characterization: an answer for settings changed in flight is never current", async () => {
    let land!: (r: TaucResult) => void;
    taucMock.mockImplementationOnce(() => new Promise((r) => { land = r; }));
    const { result } = renderHook(() => useOpticalGap());
    await waitFor(() => expect(result.current.xUnit).toBe("eV"));
    let pending!: Promise<void>;
    act(() => { pending = result.current.fit(); });
    await act(async () => {});
    act(() => result.current.setKind("indirect"));
    await act(async () => { land(RES); await pending; });
    expect(result.current.result).toBeNull();
  });

  it("characterization: a lazy book (resolved when the picks are read) still shows its fit", async () => {
    makePending({ id: "a", name: "abs", data: EV });
    const { result } = await fitted();
    expect(result.current.result?.eg).toBe(2.35);
  });
});
