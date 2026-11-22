// Hysteresis (lane WB6 audit): the loop analysis recomputes live on every input
// change, clearing the previous result first, and an answer for inputs that
// moved while it was in flight is never shown. Already correct, so no code
// change: these pin it so a later edit cannot make Hc / Mr / Ms stale.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hysteresisAnalysis } from "../../../lib/api/magnetometry";
import type { CalcResult, DataStruct } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { useHysteresis } from "./useHysteresis";

vi.mock("../../../lib/api/magnetometry", () => ({ hysteresisAnalysis: vi.fn(), subtractHysteresisBackground: vi.fn() }));

const DATA: DataStruct = {
  time: [-2, -1, 0, 1, 2], values: [[-1], [-0.5], [0], [0.5], [1]], labels: ["M"], units: ["emu"],
  metadata: { x_column_name: "Magnetic Field", x_column_unit: "Oe" },
};

beforeEach(() => {
  vi.clearAllMocks();
  useAnalysisSelection.getState().clear();
  vi.mocked(hysteresisAnalysis).mockResolvedValue({ Hc: 0.1, Mr: 0.2, Ms: 1.0 });
  useApp.setState({
    datasets: [{ id: "d1", name: "mvsh.dat", data: DATA }], activeId: "d1", selectedIds: [], xKey: null, yKeys: null, seriesOrder: null,
    resolveDataset: async (id: string) => useApp.getState().datasets.find((d) => d.id === id),
  });
});

describe("Hysteresis result freshness", () => {
  it("an exclusion clears the result at once and recomputes on the new rows", async () => {
    const { result } = renderHook(() => useHysteresis());
    await waitFor(() => expect(result.current.result?.Hc).toBe(0.1));
    vi.mocked(hysteresisAnalysis).mockResolvedValue({ Hc: 0.9, Mr: 0.2, Ms: 1.0 });
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [2] })) })));
    expect(result.current.result).toBeNull(); // not the old Hc while the new run is out
    await waitFor(() => expect(result.current.result?.Hc).toBe(0.9));
    expect(vi.mocked(hysteresisAnalysis).mock.calls.at(-1)?.[0].h).toEqual([-2, -1, 1, 2]);
  });

  it("forced race: an answer for rows changed in flight never lands", async () => {
    let land!: (r: CalcResult) => void;
    vi.mocked(hysteresisAnalysis).mockImplementationOnce(() => new Promise((r) => { land = r; }));
    const { result } = renderHook(() => useHysteresis());
    await waitFor(() => expect(hysteresisAnalysis).toHaveBeenCalledTimes(1));
    vi.mocked(hysteresisAnalysis).mockResolvedValue({ Hc: 0.9, Mr: 0.2, Ms: 1.0 });
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [2] })) })));
    await waitFor(() => expect(result.current.result?.Hc).toBe(0.9));
    await act(async () => { land({ Hc: 0.1, Mr: 0.2, Ms: 1.0 }); });
    expect(result.current.result?.Hc).toBe(0.9);
  });
});
