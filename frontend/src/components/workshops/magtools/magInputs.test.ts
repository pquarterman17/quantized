// The magnetometry tools read their rows through the shared resolver
// (lib/analysisInputs) with a stated policy; excluded / filtered rows behave as
// before. A spy on the resolver makes a bypass fail these tests.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ROW_POLICY, resolveAnalysisInputs } from "../../../lib/analysisInputs";
import { subtractMagBackground } from "../../../lib/api/magnetometry";
import { magneticCurieWeissDataFit } from "../../../lib/api/magnetic";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { magColumns, resolveMagInputs } from "./magInputs";
import { useCurieWeiss } from "./useCurieWeiss";
import { useMagTools } from "./useMagTools";

vi.mock("../../../lib/analysisInputs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/analysisInputs")>();
  return { ...actual, resolveAnalysisInputs: vi.fn(actual.resolveAnalysisInputs) };
});
vi.mock("../../../lib/api/magnetometry", () => ({
  subtractMagBackground: vi.fn(), subtractHysteresisBackground: vi.fn(), normalizeMagMoment: vi.fn(), demagCorrectField: vi.fn(),
}));
vi.mock("../../../lib/api/magnetic", () => ({ magneticCurieWeissDataFit: vi.fn() }));

const SRC: Dataset = {
  id: "mt", name: "sample.dat",
  data: {
    time: [100, 200, 300, 400], values: [[0.04, 1000], [0.02, 1000], [0.013, 1000], [0.01, 1000]],
    labels: ["DC Moment", "Magnetic Field"], units: ["emu", "Oe"],
    metadata: { x_column_name: "Temperature", x_column_unit: "K", technique: "magnetometry.mvst" },
  },
  excludedRows: [1],
};
const spy = vi.mocked(resolveAnalysisInputs);

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [SRC], activeId: "mt", xKey: null, yKeys: null, seriesOrder: null, status: "" });
});

describe("resolveMagInputs", () => {
  it("full-worksheet policy keeps an excluded row; analysis-view policy drops it", () => {
    const whole = resolveMagInputs(SRC, null, null, null);
    const view = resolveMagInputs(SRC, null, null, null, ROW_POLICY.analysisView);
    expect(whole.ok && whole.rowIds).toEqual([0, 1, 2, 3]);
    expect(view.ok && view.rowIds).toEqual([0, 2, 3]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("chooses the plotted Y against its own X, falling back to channel 0", () => {
    expect(magColumns(SRC, null, [1], null)).toEqual({ xKey: null, yKey: 1 });
    expect(magColumns(SRC, null, null, null).yKey).toBe(0);
  });

  it("refuses a lazy preview and a dataset with no rows, with the resolver's reason", () => {
    const lazy = resolveMagInputs({ ...SRC, pending: { kind: "test" } as never }, null, null, null);
    expect(!lazy.ok && lazy.code).toBe("pending");
    const empty = resolveMagInputs({ ...SRC, excludedRows: [0, 1, 2, 3] }, null, null, null, ROW_POLICY.analysisView);
    expect(!empty.ok && empty.code).toBe("no-rows");
  });
});

describe("Background goes through the resolver", () => {
  it("converts every worksheet row (excluded stays in) under the full-worksheet policy", async () => {
    vi.mocked(subtractMagBackground).mockResolvedValue({ corrected: [0, 0, 0, 0], slope: 0, intercept: 0 });
    const { result } = renderHook(() => useMagTools());
    await act(async () => { await result.current.subtractBackground(); });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ policy: ROW_POLICY.fullWorksheet, yKeys: [0] }));
    expect(subtractMagBackground).toHaveBeenCalledWith(expect.objectContaining({ temperature: [100, 200, 300, 400] }));
  });

  it("fails closed with the refusal reason when the resolver refuses (lazy preview)", async () => {
    useApp.setState({
      datasets: [{ ...SRC, pending: { kind: "test" } as never }],
      resolveDataset: async (id: string) => useApp.getState().datasets.find((d) => d.id === id),
    });
    const { result } = renderHook(() => useMagTools());
    await act(async () => { await result.current.subtractBackground(); });
    expect(subtractMagBackground).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/preview rows are not analysed/);
  });
});

describe("Curie-Weiss goes through the resolver", () => {
  it("fits the analysis view (excluded row dropped) and reads the full worksheet for the output", async () => {
    vi.mocked(magneticCurieWeissDataFit).mockResolvedValue({
      theta_cw: 50, C: 4, mu_eff: 5.6, fit_line: [0.25, -12.5], r2: 0.99, inv_chi: [25, 75, 100],
      susceptibility_molar: [], susceptibility_errors_molar: [], inverse_errors: [], fit_inv_chi: [12, 62, 87],
      fit_mask: [true, true, true], n_fit: 3, fit_range_used: [100, 400], excluded_nonpositive: 0,
    });
    const { result } = renderHook(() => useCurieWeiss());
    act(() => { result.current.setSampleMass(100); result.current.setMolarMass(200); });
    await act(async () => { await result.current.fit(); });
    const policies = spy.mock.calls.map((call) => call[0].policy);
    expect(policies).toContain(ROW_POLICY.analysisView);
    expect(policies).toContain(ROW_POLICY.fullWorksheet);
    expect(magneticCurieWeissDataFit).toHaveBeenCalledWith(expect.objectContaining({ temperature: [100, 300, 400] }));
    expect(result.current.error).toBeNull();
  });
});
