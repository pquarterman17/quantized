import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { magneticArrott, magneticEntropyChange, magneticSeriesComparePlan } from "../../../lib/api/magnetic";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useMagIsotherms } from "./useMagIsotherms";

vi.mock("../../../lib/api/magnetic", () => ({
  magneticArrott: vi.fn(), magneticEntropyChange: vi.fn(), magneticSeriesComparePlan: vi.fn(),
}));

const realResolve = useApp.getState().resolveDataset;
const roles: Dataset["errorRoles"] = [{ channel: 1, target: 0, axis: "y", side: "both" }];

function iso(id: string, xUnit: string, temp: number, withErr: boolean): Dataset {
  return {
    id, name: `${id}.dat`,
    data: {
      time: [0, 1, 2], values: [[0, 0.5, temp], [5, 0.5, temp], [8, 0.5, temp]], labels: ["Moment", "Moment err", "Temperature"],
      units: ["emu/cm3", "emu/cm3", "K"], metadata: { x_column_name: "Magnetic field", x_column_unit: xUnit },
    },
    errorRoles: withErr ? roles : [],
  };
}

function load(withErr: boolean): void {
  useApp.setState({
    datasets: [iso("a", "Oe", 10, withErr), iso("b", "T", 20, withErr)], activeId: "a", selectedIds: ["a", "b"],
    xKey: null, yKeys: [0], seriesOrder: null, resolveDataset: realResolve, status: "",
  });
}

const unc = { propagated: true, method: "first-order (linear) propagation", reason: null };
const sigmaPlan = { axis: "field" as const, x_unit: "Oe", y_unit: "emu/cm3", series: [{ label: "a", x_factor: 1, y_factor: 1 }, { label: "b", x_factor: 1e4, y_factor: 1 }] };

/** Wait for the temperature pre-fill (an async read of each worksheet) to land. */
const prefilled = async (r: { current: ReturnType<typeof useMagIsotherms> }): Promise<void> => {
  await waitFor(() => expect(r.current.rows.every((row) => row.text !== "")).toBe(true));
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(magneticSeriesComparePlan).mockResolvedValue(sigmaPlan);
});

describe("useMagIsotherms: ΔS_M(T)", () => {
  it("sends isotherms in the common unit with M uncertainty, commits ΔS with a Y-error column and shows ±", async () => {
    load(true);
    vi.mocked(magneticEntropyChange).mockResolvedValue({
      temperature: [15], unit: "J/(m^3 K)", field_unit: "Oe", method: "Maxwell", uncertainty: unc,
      curves: [{ max_field: 8, delta_s: [-3], delta_s_sigma: [0.4], peak_delta_s: -3, peak_delta_s_sigma: 0.4, peak_temperature: 15, t_cold: null, t_hot: null, fwhm: null, rcp: null }],
    });
    const { result } = renderHook(() => useMagIsotherms());
    await prefilled(result);
    await waitFor(() => expect(result.current.rows.map((r) => r.text)).toEqual(["10", "20"])); // from the K columns
    act(() => result.current.setFieldsText("8"));
    expect(result.current.problem).toBeNull();
    await act(async () => { await result.current.run(); });
    const body = vi.mocked(magneticEntropyChange).mock.calls[0]![0];
    expect(body.field_unit).toBe("Oe");
    expect(body.max_fields).toEqual([8]);
    expect(body.isotherms.map((i) => i.temperature)).toEqual([10, 20]);
    expect(body.isotherms[1]!.field).toEqual([0, 1, 2].map((v) => v * 1e4));
    expect(body.isotherms[0]!.magnetization_error).toEqual([0.5, 0.5, 0.5]);
    const out = useApp.getState().datasets[2]!;
    expect(out.data.labels).toEqual(["ΔS_M (H = 8 Oe)", "ΔS_M ± (H = 8 Oe)"]);
    expect(out.errorRoles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
    expect(result.current.shown?.lines.join("\n")).toMatch(/-3 ± 0\.4 J\/\(m\^3 K\)/);
  });

  it("sends no uncertainty and shows no ± when the worksheets carry none", async () => {
    load(false);
    vi.mocked(magneticEntropyChange).mockResolvedValue({
      temperature: [15], unit: "J/(m^3 K)", field_unit: "Oe", method: "Maxwell",
      uncertainty: { propagated: false, method: null, reason: "no complete per-point M uncertainty" },
      curves: [{ max_field: 8, delta_s: [-3], delta_s_sigma: null, peak_delta_s: -3, peak_delta_s_sigma: null, peak_temperature: 15, t_cold: null, t_hot: null, fwhm: null, rcp: null }],
    });
    const { result } = renderHook(() => useMagIsotherms());
    await prefilled(result);
    act(() => result.current.setFieldsText("8"));
    await act(async () => { await result.current.run(); });
    const body = vi.mocked(magneticEntropyChange).mock.calls[0]![0];
    expect(body.isotherms.every((i) => !("magnetization_error" in i))).toBe(true);
    expect(useApp.getState().datasets[2]!.data.labels).toEqual(["ΔS_M (H = 8 Oe)"]);
    expect(result.current.shown?.lines.join("\n")).not.toMatch(/\d ± \d/);
  });

  it("blocks on a blank temperature and on a missing maximum field", async () => {
    load(false);
    useApp.setState({ datasets: [iso("a", "Oe", 10, false), { ...iso("b", "T", 20, false), data: { ...iso("b", "T", 20, false).data, units: ["emu/cm3", "emu/cm3", "Oe"] } }] });
    const { result } = renderHook(() => useMagIsotherms());
    await waitFor(() => expect(result.current.rows[0]!.text).toBe("10"));
    expect(result.current.problem).toMatch(/temperature \(K\) of "b.dat"/);
    act(() => result.current.setTemp("b", "20"));
    expect(result.current.problem).toMatch(/at least one maximum field/);
  });

  it("pre-fills the maximum field from the data when every isotherm shares a field unit (provisional)", async () => {
    load(false);
    useApp.setState({ datasets: [iso("a", "Oe", 10, false), iso("b", "Oe", 20, false)] });
    const { result } = renderHook(() => useMagIsotherms());
    await waitFor(() => expect(result.current.fieldsText).toBe("2")); // the largest field in the data (X = 0, 1, 2)
    act(() => result.current.setFieldsText("3"));
    expect(result.current.fieldsText).toBe("3");
  });

  it("refuses an unnormalized unit in the browser and says where to set it (no request, so no 422)", async () => {
    load(false);
    vi.mocked(magneticSeriesComparePlan).mockResolvedValue({ ...sigmaPlan, y_unit: "emu" });
    const { result } = renderHook(() => useMagIsotherms());
    await prefilled(result);
    act(() => result.current.setFieldsText("8"));
    await act(async () => { await result.current.run(); });
    expect(result.current.shown?.error).toMatch(/not normalized.*Magnetometry tools > Units/);
    expect(magneticEntropyChange).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("surfaces a backend refusal and adds nothing", async () => {
    load(false);
    vi.mocked(magneticEntropyChange).mockRejectedValue(new Error("isotherm T=10 K does not span 0 to 8 Oe"));
    const { result } = renderHook(() => useMagIsotherms());
    await prefilled(result);
    act(() => result.current.setFieldsText("8"));
    await act(async () => { await result.current.run(); });
    expect(result.current.shown?.error).toMatch(/does not span/);
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("marks the result out of date when a temperature changes", async () => {
    load(false);
    vi.mocked(magneticEntropyChange).mockResolvedValue({
      temperature: [15], unit: "J/(m^3 K)", field_unit: "Oe", method: "Maxwell", uncertainty: { propagated: false, method: null, reason: "x" },
      curves: [{ max_field: 8, delta_s: [-3], delta_s_sigma: null, peak_delta_s: -3, peak_delta_s_sigma: null, peak_temperature: 15, t_cold: null, t_hot: null, fwhm: null, rcp: null }],
    });
    const { result } = renderHook(() => useMagIsotherms());
    await prefilled(result);
    act(() => result.current.setFieldsText("8"));
    await act(async () => { await result.current.run(); });
    useApp.setState({ activeId: "a", selectedIds: ["a", "b"] });
    act(() => result.current.setTemp("b", "25"));
    expect(result.current.stale).toBe(true);
  });
});

describe("useMagIsotherms: Arrott", () => {
  it("sends the window and exponents and reports Tc ± from the backend", async () => {
    load(true);
    vi.mocked(magneticArrott).mockResolvedValue({
      beta: 0.5, gamma: 1, x_label: "(H/M)^(1/1)", y_label: "M^(1/0.5)", magnetization_si_unit: "A/m",
      isotherms: [10, 20].map((t) => ({ temperature: t, n_points: 3, x: [1, 2, 3], y: [4, 5, 6], slope: 1, intercept: 3 - t / 10, slope_se: 0.1, intercept_se: 0.1, r2: 0.99, intercept_sigma_m: 0.2, spontaneous_magnetization: 1 })),
      tc: 15, tc_sigma: 0.7, tc_method: "interp", uncertainty: unc,
    });
    const { result } = renderHook(() => useMagIsotherms());
    await prefilled(result);
    act(() => { result.current.setView("arrott"); result.current.setHi("8"); });
    expect(result.current.problem).toBeNull();
    await act(async () => { await result.current.run(); });
    expect(vi.mocked(magneticArrott).mock.calls[0]![0]).toMatchObject({ window: [0, 8], beta: 0.5, gamma: 1, field_unit: "Oe" });
    const out = useApp.getState().datasets[2]!;
    expect(out.data.labels).toHaveLength(3);
    expect(out.columnDesignations).toEqual({ 0: "Y", 1: "X", 2: "Y" });
    expect(result.current.shown?.lines[0]).toMatch(/Tc = 15 ± 0\.7 K/);
  });

  it("refuses a bad window or exponent before calling", async () => {
    load(false);
    const { result } = renderHook(() => useMagIsotherms());
    await prefilled(result);
    act(() => { result.current.setView("arrott"); result.current.setHi("0"); });
    expect(result.current.problem).toMatch(/0 <= low < high/);
    act(() => { result.current.setHi("8"); result.current.setBeta("-1"); });
    expect(result.current.problem).toMatch(/positive/);
  });
});
