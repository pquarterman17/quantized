import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { magneticCurieWeissDataFit } from "../../../lib/api/magnetic";
import type { CurieWeissDataFitResult } from "../../../lib/api/magnetic";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useCurieWeiss } from "./useCurieWeiss";

vi.mock("../../../lib/api/magnetic", () => ({ magneticCurieWeissDataFit: vi.fn() }));

const realResolveDataset = useApp.getState().resolveDataset;

function mt(): Dataset {
  return {
    id: "mt", name: "sample.dat",
    data: {
      time: [100, 200, 300, 400],
      values: [
        [0.04, 0.004, 1000], [0.02, 0.002, 1000],
        [0.013333, Number.NaN, 1000], [0.01, 0.001, 1000],
      ],
      labels: ["DC Moment", "Moment error", "Magnetic Field"],
      units: ["emu", "emu", "Oe"],
      metadata: { x_column_name: "Temperature", x_column_unit: "K", technique: "magnetometry.mvst" },
    },
    errorRoles: [{ channel: 1, target: 0, axis: "y", side: "+" }],
  };
}

function result(): CurieWeissDataFitResult {
  return {
    theta_cw: 50, C: 4, mu_eff: 5.6568, fit_line: [0.25, -12.5], r2: 0.999,
    inv_chi: [25, 50, 75.001875, 100],
    susceptibility_molar: [0.04, 0.02, 0.013333, 0.01],
    susceptibility_errors_molar: [[0.004, 0.002, 0, 0.001]],
    inverse_errors: [[2.5, 5, 0, 10]],
    fit_inv_chi: [12.5, 37.5, 62.5, 87.5],
    fit_mask: [true, true, true, true], n_fit: 4,
    fit_range_used: [100, 400], excluded_nonpositive: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [mt()], activeId: "mt", xKey: null, yKeys: null, seriesOrder: null,
    resolveDataset: realResolveDataset, status: "",
  });
  vi.mocked(magneticCurieWeissDataFit).mockResolvedValue(result());
});

describe("useCurieWeiss", () => {
  it("derives molar susceptibility from loaded MPMS-style moment and creates a plot-ready dataset", async () => {
    const { result: hook } = renderHook(() => useCurieWeiss());
    act(() => {
      hook.current.setSampleMass(100);
      hook.current.setMolarMass(200);
    });
    expect(hook.current.problem).toBeNull();
    await act(async () => { await hook.current.fit(); });

    expect(magneticCurieWeissDataFit).toHaveBeenCalledWith(expect.objectContaining({
      response_basis: "total_moment", field: [1000, 1000, 1000, 1000],
      field_unit: "Oe", sample_mass_g: 0.1, molar_mass_g_mol: 200,
      fit_range: [200, 400], response_errors: [[0.004, 0.002, 0, 0.001]],
    }));
    const output = useApp.getState().datasets[1];
    expect(output.data.labels).toEqual([
      "Inverse molar susceptibility", "Curie–Weiss fit", "Inverse susceptibility uncertainty -",
    ]);
    expect(output.data.values[2][2]).toBeNaN();
    expect(output.errorRoles).toEqual([{ channel: 2, target: 0, axis: "y", side: "-" }]);
    expect(output.data.metadata.curie_weiss_fit).toEqual(expect.objectContaining({
      source_dataset_id: "mt", response_basis: "total_moment", n_fit: 4,
    }));
    expect(output.derivedFrom).toEqual({ datasetId: "mt", pipeline: "curie-weiss" });
    expect(hook.current.theta).toBe(50);
  });

  it("refuses field uncertainty rather than silently understating the result", async () => {
    const data = mt();
    data.errorRoles = [...(data.errorRoles ?? []), { channel: 1, target: 2, axis: "y", side: "both" }];
    useApp.setState({ datasets: [data] });
    const { result: hook } = renderHook(() => useCurieWeiss());
    act(() => { hook.current.setSampleMass(100); hook.current.setMolarMass(200); });
    await act(async () => { await hook.current.fit(); });
    expect(hook.current.error).toMatch(/field.*uncertainty/i);
    expect(magneticCurieWeissDataFit).not.toHaveBeenCalled();
  });

  it("abandons an in-flight fit when the source data is replaced", async () => {
    let finish!: (value: CurieWeissDataFitResult) => void;
    let started!: () => void;
    const signal = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(magneticCurieWeissDataFit).mockImplementationOnce(async () => {
      started();
      return await new Promise((resolve) => { finish = resolve; });
    });
    const { result: hook } = renderHook(() => useCurieWeiss());
    act(() => { hook.current.setSampleMass(100); hook.current.setMolarMass(200); });
    let run!: Promise<void>;
    act(() => { run = hook.current.fit(); });
    await signal;
    act(() => useApp.setState({ datasets: [{ ...mt(), data: { ...mt().data, time: [1, 2, 3, 4] } }] }));
    await act(async () => { finish(result()); await run; });
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("honors excluded rows and leaves them as gaps in the derived worksheet", async () => {
    useApp.setState({ datasets: [{ ...mt(), excludedRows: [1] }] });
    vi.mocked(magneticCurieWeissDataFit).mockResolvedValueOnce({
      ...result(), inv_chi: [25, 75.001875, 100],
      susceptibility_molar: [0.04, 0.013333, 0.01],
      susceptibility_errors_molar: [[0.004, 0, 0.001]],
      inverse_errors: [[2.5, 0, 10]], fit_inv_chi: [12.5, 62.5, 87.5],
      fit_mask: [true, true, true], n_fit: 3,
    });
    const { result: hook } = renderHook(() => useCurieWeiss());
    act(() => { hook.current.setSampleMass(100); hook.current.setMolarMass(200); });
    await act(async () => { await hook.current.fit(); });
    expect(magneticCurieWeissDataFit).toHaveBeenCalledWith(expect.objectContaining({
      temperature: [100, 300, 400], response: [0.04, 0.013333, 0.01],
    }));
    const output = useApp.getState().datasets[1];
    expect(output.data.time).toEqual([100, 200, 300, 400]);
    expect(output.data.values[1].every(Number.isNaN)).toBe(true);
    expect((output.data.metadata.curie_weiss_fit as { fit_rows: number[] }).fit_rows).toEqual([0, 2, 3]);
  });

  it("does not apply a result after the user changes the fit range", async () => {
    let finish!: (value: CurieWeissDataFitResult) => void;
    let started!: () => void;
    const signal = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(magneticCurieWeissDataFit).mockImplementationOnce(async () => {
      started();
      return await new Promise((resolve) => { finish = resolve; });
    });
    const { result: hook } = renderHook(() => useCurieWeiss());
    act(() => { hook.current.setSampleMass(100); hook.current.setMolarMass(200); });
    let run!: Promise<void>;
    act(() => { run = hook.current.fit(); });
    await signal;
    act(() => hook.current.setFitMin(250));
    await act(async () => { finish(result()); await run; });
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(hook.current.error).toMatch(/inputs changed/);
  });

  it("guards a same-render repeated click before React paints busy", async () => {
    const { result: hook } = renderHook(() => useCurieWeiss());
    act(() => { hook.current.setSampleMass(100); hook.current.setMolarMass(200); });
    await act(async () => {
      await Promise.all([hook.current.fit(), hook.current.fit()]);
    });
    expect(magneticCurieWeissDataFit).toHaveBeenCalledTimes(1);
    expect(useApp.getState().datasets).toHaveLength(2);
  });
});
