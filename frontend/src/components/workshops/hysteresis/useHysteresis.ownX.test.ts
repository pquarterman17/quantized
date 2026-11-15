// Hysteresis validates and labels H against the Y's OWN X (T1,R1,H2,M2), never
// the plot's shared X.
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hysteresisAnalysis } from "../../../lib/api/magnetometry";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { useHysteresis } from "./useHysteresis";

vi.mock("../../../lib/api/magnetometry", () => ({
  hysteresisAnalysis: vi.fn(),
  subtractHysteresisBackground: vi.fn(),
}));

const H2 = [-2, -1, 1, 2];
const M2 = [-1, -0.5, 0.5, 1];

// time = shared X; columns R1 (0), second X (1, "Set As X"), M2 (2).
function sheet(shared: { name: string; unit: string }, second: { name: string; unit: string }): Dataset {
  return {
    id: "d1",
    name: "ownx.dat",
    data: {
      time: [300, 100, 200, 400],
      values: H2.map((h, i) => [10 + i, h, M2[i]]),
      labels: ["R1", second.name, "M2"],
      units: ["ohm", second.unit, "emu"],
      metadata: { x_column_name: shared.name, x_column_unit: shared.unit },
    },
    columnDesignations: { 1: "X" },
  };
}

function plot(ds: Dataset): void {
  useApp.setState({
    datasets: [ds],
    activeId: "d1",
    selectedIds: [],
    xKey: null,
    yKeys: [0, 2],
    seriesOrder: [2, 0], // M2 is the primary Y
    resolveDataset: async (id: string) => useApp.getState().datasets.find((d) => d.id === id),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAnalysisSelection.getState().clear();
  vi.mocked(hysteresisAnalysis).mockResolvedValue({ Hc: 0.1, Mr: 0.2, Ms: 1.0 });
});

describe("hysteresis on a secondary-X Y", () => {
  it("T1,R1,H2,M2 plotted against T1 runs on H2, and the H unit is H2's", async () => {
    plot(sheet({ name: "Temperature", unit: "K" }, { name: "Field", unit: "Oe" }));
    const { result } = renderHook(() => useHysteresis());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(result.current.error).toBeNull();
    expect(hysteresisAnalysis).toHaveBeenCalledWith({ h: H2, m: M2 });
    expect(result.current.units).toEqual({ h: "Oe", m: "emu" });
  });

  it("refuses a field shared X when the primary Y's own X is a temperature", async () => {
    plot(sheet({ name: "Magnetic Field", unit: "Oe" }, { name: "Temperature", unit: "K" }));
    const { result } = renderHook(() => useHysteresis());
    await waitFor(() => expect(result.current.error).toContain("not a declared magnetic field"));
    expect(hysteresisAnalysis).not.toHaveBeenCalled();
    expect(result.current.units.h).toBe("K");
  });
});
