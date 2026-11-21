// Large-data audit: Curve fit on a 300k-row dataset blanked the app with
// "RangeError: Maximum call stack size exceeded" from Math.min(...finite) in
// the xRange memo (and the same spread in fitBandData / residualPlotData).

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { bandRows } from "./fitBandData";
import { histogram } from "./residualPlotData";
import { useCurveFit } from "./useCurveFit";

vi.mock("../../../lib/api", () => ({ fitModel: vi.fn(), fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/curvefit", () => ({
  autoGuess: vi.fn(),
  listFitModels: vi.fn().mockResolvedValue({ models: [] }),
  bootstrapFit: vi.fn(),
}));
vi.mock("../../../lib/api/figures", () => ({ exportCornerFigure: vi.fn() }));

const N = 300_000;
const BIG: DataStruct = {
  time: Array.from({ length: N }, (_, i) => i),
  values: Array.from({ length: N }, (_, i) => [i, i * 2]),
  labels: ["x", "y"],
  units: ["", ""],
  metadata: {},
};

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "big", name: "big.dat", data: BIG }],
    activeId: "big",
    xKey: 0,
    yKeys: [1],
    seriesOrder: null,
    errKeys: {},
    fitOverlay: null,
  });
});

describe("large datasets do not overflow the call stack", () => {
  it("useCurveFit computes xRange over 300k rows", () => {
    const { result } = renderHook(() => useCurveFit());
    expect(result.current.xRange).toEqual({ min: 0, max: N - 1 });
  });
  it("bandRows and histogram handle 300k values", () => {
    const xs = BIG.time;
    expect(bandRows(xs, xs).x.length).toBeGreaterThan(N);
    expect(histogram(xs).counts.reduce((a, b) => a + b, 0)).toBe(N);
  });
});
