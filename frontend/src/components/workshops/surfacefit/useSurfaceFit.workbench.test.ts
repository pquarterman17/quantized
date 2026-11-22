// Surface fit result freshness (lane WB6 audit). Picks, model and rows already
// retired the result. Fixed: the start values and bounds the fit ran from were
// not part of its key, so after editing one the old fit stayed current (shown,
// copied, added as a worksheet) as though it were the fit of the new settings.
// Also pinned: a lazy book installed by Fit does not discard its fit.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SurfaceFitResult } from "../../../lib/api/analysisExtras";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { makePending, restoreResolve } from "../workbench/pendingBook.testkit";
import { useSurfaceFit } from "./useSurfaceFit";

const { modelsMock, guessMock, fitMock } = vi.hoisted(() => ({ modelsMock: vi.fn(), guessMock: vi.fn(), fitMock: vi.fn() }));
vi.mock("../../../lib/api/analysisExtras", () => ({ surfaceModels: modelsMock, surfaceGuess: guessMock, surfaceFit: fitMock }));

const DATA: DataStruct = {
  time: [0, 1, 0, 1], values: [[0, 1], [0, 2], [1, 3], [1, 5]], labels: ["Y", "Z"], units: ["mm", "V"],
  metadata: { x_column_name: "X", x_column_unit: "mm" },
};
const RES: SurfaceFitResult = {
  model_name: "Plane", param_names: ["a", "b", "c"], params: [2, 1, 1], errors: [0.1, 0.2, 0.3],
  inference: [
    { value: 2, error: 0.1, t: 20, prob: 0.001, lcl: 1.7, ucl: 2.3 }, { value: 1, error: 0.2, t: 5, prob: 0.01, lcl: 0.4, ucl: 1.6 },
    { value: 1, error: 0.3, t: 3, prob: 0.05, lcl: 0.1, ucl: 1.9 },
  ],
  level: 0.95, fixed: [false, false, false], z_fit: [1, 3, 2, 4], residuals: [0, -1, 1, 1],
  r2: 0.9, rmse: 0.5, chi_sq_red: 0.25, n_points: 4, n_free: 3, dof: 1, exit_flag: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  restoreResolve();
  modelsMock.mockResolvedValue([{ name: "Plane", param_names: ["a", "b", "c"], description: "z" }]);
  guessMock.mockResolvedValue({ param_names: ["a", "b", "c"], p0: [1.5, 0.5, 0.25] });
  fitMock.mockResolvedValue(RES);
  useApp.setState({ datasets: [{ id: "d1", name: "map.csv", data: DATA }], activeId: "d1", status: "", analysisResults: [], history: [], future: [] });
});

async function fitted() {
  const hook = renderHook(() => useSurfaceFit());
  await waitFor(() => expect(hook.result.current.p0[0]).toBe("1.5"));
  await act(async () => { await hook.result.current.fit(); });
  return hook;
}

describe("Surface fit result freshness", () => {
  it("characterization: picks, model or row changes retire the result", async () => {
    const { result } = await fitted();
    expect(result.current.result?.model_name).toBe("Plane");
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [0] })) })));
    expect(result.current.result).toBeNull();
  });

  it("a changed start value or bound retires the result and Add; setting it back restores it (fail-before: stayed current)", async () => {
    const { result } = await fitted();
    act(() => result.current.setBound("p0", 0, "9"));
    expect(result.current.result).toBeNull();
    expect(result.current.addDisabledReason).toMatch(/run the analysis first/i);
    act(() => result.current.setBound("p0", 0, "1.5"));
    expect(result.current.result?.model_name).toBe("Plane");
    act(() => result.current.setBound("upper", 1, "9"));
    expect(result.current.result).toBeNull();
    act(() => result.current.setBound("lower", 2, "0"));
    expect(result.current.points).toBeNull();
  });

  it("forced race: an answer for start values edited in flight is never current", async () => {
    let land!: (r: SurfaceFitResult) => void;
    fitMock.mockImplementationOnce(() => new Promise((r) => { land = r; }));
    const { result } = renderHook(() => useSurfaceFit());
    await waitFor(() => expect(result.current.p0[0]).toBe("1.5"));
    let pending!: Promise<void>;
    act(() => { pending = result.current.fit(); });
    await act(async () => {});
    act(() => result.current.setBound("p0", 0, "9"));
    await act(async () => { land(RES); await pending; });
    expect(result.current.result).toBeNull();
  });

  it("a lazy book does not discard its fit", async () => {
    makePending({ id: "d1", name: "map.csv", data: DATA });
    const { result } = await fitted();
    expect(result.current.result?.model_name).toBe("Plane");
  });
});
