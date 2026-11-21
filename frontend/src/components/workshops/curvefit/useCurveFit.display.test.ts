// P4 phase 2: a large Curve Fit asks for a display curve and draws it; a
// small one keeps the phase-1 lean request and its full curve.
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listFitModels } from "../../../lib/api/curvefit";
import { fitModel } from "../../../lib/api";
import { FIT_DISPLAY_MIN_POINTS, FIT_DISPLAY_POINTS } from "../../../lib/fitCurve";
import type { DataStruct } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { useCurveFit } from "./useCurveFit";

vi.mock("../../../lib/api", () => ({ fitModel: vi.fn(), fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/curvefit", () => ({ autoGuess: vi.fn(), listFitModels: vi.fn(), bootstrapFit: vi.fn() }));

function sheet(n: number): DataStruct {
  return { time: Array.from({ length: n }, (_, i) => i), values: Array.from({ length: n }, (_, i) => [2 * i + 1]), labels: ["y"], units: [""], metadata: {} };
}

function setUp(n: number): void {
  useAnalysisSelection.setState({ toolId: null, selection: null });
  useApp.setState({
    datasets: [{ id: "d1", name: "big.csv", data: sheet(n) }], activeId: "d1",
    xKey: null, yKeys: null, seriesOrder: null, errKeys: {}, analysisResults: [], fitOverlay: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({ models: [] });
});

describe("useCurveFit display curve", () => {
  it("a large fit asks for a display curve and draws it, keeping its full source", async () => {
    const n = FIT_DISPLAY_MIN_POINTS + 1;
    setUp(n);
    vi.mocked(fitModel).mockResolvedValue({
      params: [2, 1], R2: 1, nFree: 2, resultId: "rid", yFitDisplay: { rows: [0, n - 1], y: [1, 2 * n - 1] },
    });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => result.current.run("fit"));
    expect(result.current.error).toBeNull();
    expect(vi.mocked(fitModel).mock.calls[0]![0]).toMatchObject({ return_residuals: false, display_points: FIT_DISPLAY_POINTS });
    const overlay = useApp.getState().fitOverlay!;
    expect(overlay.y).toHaveLength(n);
    expect([overlay.y[0], overlay.y[1], overlay.y[n - 1]]).toEqual([1, undefined, 2 * n - 1]);
    expect(overlay.full).toMatchObject({ resultId: "rid", model: "Linear", params: [2, 1] });
    expect(overlay.full!.rows).toHaveLength(n);
    // The parameters and statistics are the response's, untouched.
    expect(result.current.result).toMatchObject({ params: [2, 1], R2: 1 });
  });

  it("a small fit keeps the phase-1 lean request and its full curve", async () => {
    setUp(4);
    vi.mocked(fitModel).mockResolvedValue({ params: [2, 1], yFit: [1, 3, 5, 7] });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => result.current.run("fit"));
    expect(vi.mocked(fitModel).mock.calls[0]![0]).not.toHaveProperty("display_points");
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "d1", binding: { yKey: 0, xKey: null }, y: [1, 3, 5, 7], curveFit: true });
  });
});
