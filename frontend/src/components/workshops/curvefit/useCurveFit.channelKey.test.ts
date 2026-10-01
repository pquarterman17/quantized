// useCurveFit — a fit result also belongs to the X/Y channels it was fit on.
// c698e593 keyed the stored result to dataset + model only, so after the user
// re-plotted another Y (or X) the corner plot bootstrapped the NEW channel's
// pairs seeded with the OLD channel's parameters.

import { renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapFit, listFitModels } from "../../../lib/api/curvefit";
import { fitModel } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useCurveFit } from "./useCurveFit";

vi.mock("../../../lib/api", () => ({
  fitModel: vi.fn(),
  fetchBookData: vi.fn(),
}));
vi.mock("../../../lib/api/curvefit", () => ({
  autoGuess: vi.fn(),
  listFitModels: vi.fn(),
  bootstrapFit: vi.fn(),
}));
vi.mock("../../../lib/api/figures", () => ({
  exportCornerFigure: vi.fn(),
}));

const MULTI: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[100, 10, 5], [200, 20, 6], [300, 30, 7], [400, 40, 8]],
  labels: ["field", "moment", "aux"],
  units: ["Oe", "emu", ""],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({ models: [] });
  vi.mocked(fitModel).mockResolvedValue({ params: [2, 5], yFit: [10, 20, 30, 40] });
  vi.mocked(bootstrapFit).mockResolvedValue({
    params: [2, 5], boot_mean: [2, 5], boot_se: [0.1, 0.2], ciLow: [1.8, 4.6], ciHigh: [2.2, 5.4],
    n_boot: 500, n_failed: 0, boot_samples: [[1.9, 4.9], [2.1, 5.1]],
  });
  useApp.setState({
    datasets: [{ id: "d1", name: "loop.dat", data: MULTI }],
    activeId: "d1",
    xKey: 0,
    yKeys: [1],
    seriesOrder: null,
    errKeys: {},
    fitOverlay: null,
  });
});

async function fitMoment() {
  const hook = renderHook(() => useCurveFit());
  await act(async () => hook.result.current.run("fit"));
  expect(hook.result.current.result).not.toBeNull();
  return hook;
}

describe("useCurveFit — a result is keyed to its X/Y channels", () => {
  it("hides the result and skips the corner plot after the plotted Y changes", async () => {
    const { result } = await fitMoment();
    act(() => useApp.setState({ yKeys: [2] }));
    expect(result.current.result).toBeNull();
    await act(async () => result.current.runCornerPlot());
    expect(bootstrapFit).not.toHaveBeenCalled();
    // Re-plotting the fitted channel brings the result back.
    act(() => useApp.setState({ yKeys: [1] }));
    expect(result.current.result?.params).toEqual([2, 5]);
  });

  it("hides the result after the plotted X changes", async () => {
    const { result } = await fitMoment();
    act(() => useApp.setState({ xKey: 2 }));
    expect(result.current.result).toBeNull();
    await act(async () => result.current.runCornerPlot());
    expect(bootstrapFit).not.toHaveBeenCalled();
  });

  it("still bootstraps the fitted channel while it stays plotted", async () => {
    const { result } = await fitMoment();
    await act(async () => result.current.runCornerPlot());
    expect(bootstrapFit).toHaveBeenCalledWith(
      { model: "Linear", x: [100, 200, 300, 400], y: [10, 20, 30, 40], p0: [2, 5], return_samples: true },
      expect.any(AbortSignal),
    );
  });
});
