import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { magneticSusceptibility } from "../../../lib/api/magnetic";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useMagDerived } from "./useMagDerived";

vi.mock("../../../lib/api/magnetic", () => ({ magneticSusceptibility: vi.fn() }));

const realResolve = useApp.getState().resolveDataset;

/** M(H): X = field (Oe), M in emu/cm³ with a symmetric uncertainty column. */
function loop(over: Partial<Dataset["data"]> = {}, roles: Dataset["errorRoles"] = [{ channel: 1, target: 0, axis: "y", side: "both" }]): Dataset {
  return {
    id: "mh", name: "loop.dat",
    data: {
      time: [-1000, 0, 1000], values: [[-1, 0.1], [0, 0.1], [Number.NaN, 0.1]],
      labels: ["Magnetization", "M err"], units: ["emu/cm³", "emu/cm³"],
      metadata: { x_column_name: "Magnetic field", x_column_unit: "Oe" }, ...over,
    },
    errorRoles: roles,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [loop()], activeId: "mh", xKey: null, yKeys: null, seriesOrder: null, resolveDataset: realResolve, status: "" });
  vi.mocked(magneticSusceptibility).mockResolvedValue({
    susceptibility: [1e-3, 1e-3], errors: [[1e-4, 1e-4]], unit: "emu/(cm³·Oe)", system: "cgs", output: "volume",
    response_unit: "emu/cm³", field_unit: "Oe", basis_factor: 1, n_invalid_field: 0, formula: "chi = M / H",
  });
});

describe("useMagDerived susceptibility", () => {
  it("sends declared field, response and committed uncertainty and writes an aligned worksheet with provenance", async () => {
    const { result } = renderHook(() => useMagDerived());
    expect(result.current.problem).toBeNull();
    await act(async () => { await result.current.createSusceptibility(); });
    expect(magneticSusceptibility).toHaveBeenCalledWith(expect.objectContaining({
      field: [-1000, 0], response: [-1, 0], response_unit: "emu/cm³", field_unit: "Oe",
      output: "volume", system: "cgs", response_errors: [[0.1, 0.1]], sample_mass_g: null, sample_volume_cm3: null,
    }));
    const out = useApp.getState().datasets[1]!;
    expect(out.data.time).toEqual([-1000, 0, 1000]);
    expect(out.data.values[0]).toEqual([1e-3, 1e-4]);
    expect(out.data.values[2]).toEqual([Number.NaN, Number.NaN]); // the NaN response row stays a gap
    expect(out.data.units).toEqual(["emu/(cm³·Oe)", "emu/(cm³·Oe)"]);
    expect(out.errorRoles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
    expect(out.data.metadata["magnetometry_susceptibility"]).toMatchObject({ output: "volume", field_source: "X axis", response_unit: "emu/cm³" });
    expect(result.current.shown?.error).toBeNull();
  });

  it("a row whose uncertainty is missing keeps its value but gets no error bar (never a zero bar)", async () => {
    useApp.setState({ datasets: [loop({ values: [[-1, 0.1], [0, Number.NaN], [1, 0.1]] })] });
    vi.mocked(magneticSusceptibility).mockResolvedValue({
      susceptibility: [1e-3, 0, 1e-3], errors: [[1e-4, 0, 1e-4]], unit: "u", system: "cgs", output: "volume",
      response_unit: "emu/cm³", field_unit: "Oe", basis_factor: 1, n_invalid_field: 1, formula: "",
    });
    const { result } = renderHook(() => useMagDerived());
    await act(async () => { await result.current.createSusceptibility(); });
    const out = useApp.getState().datasets[1]!;
    expect(out.data.values[1]![0]).toBe(0);
    expect(out.data.values[1]![1]).toBeNaN();
    expect(result.current.shown?.warning).toMatch(/zero field/);
  });

  it("is blocked without a declared field or response unit", () => {
    useApp.setState({ datasets: [loop({ metadata: { x_column_name: "Row" } })] });
    expect(renderHook(() => useMagDerived()).result.current.problem).toMatch(/No declared applied field/);
    useApp.setState({ datasets: [loop({ units: ["", ""] })] });
    expect(renderHook(() => useMagDerived()).result.current.problem).toMatch(/no declared unit/);
  });

  it("an M(T) sweep needs the field column chosen explicitly when two exist", () => {
    const mt = loop({
      time: [10, 20, 30], values: [[1, 100, 100], [2, 100, 100], [3, 100, 100]],
      labels: ["Moment", "Field A", "Field B"], units: ["emu", "Oe", "Oe"],
      metadata: { x_column_name: "Temperature", x_column_unit: "K" },
    }, []);
    useApp.setState({ datasets: [mt] });
    const { result } = renderHook(() => useMagDerived());
    expect(result.current.problem).toMatch(/Choose which applied field/);
    act(() => result.current.setFieldPick("c1"));
    expect(result.current.problem).toBeNull();
  });

  it("refuses asymmetric uncertainty and creates nothing", async () => {
    useApp.setState({ datasets: [loop({}, [{ channel: 1, target: 0, axis: "y", side: "+" }])] });
    const { result } = renderHook(() => useMagDerived());
    await act(async () => { await result.current.createSusceptibility(); });
    expect(result.current.shown?.error).toMatch(/asymmetric/);
    expect(magneticSusceptibility).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("shows the backend's basis refusal and adds nothing", async () => {
    vi.mocked(magneticSusceptibility).mockRejectedValue(new Error("a per-volume response cannot become a mass susceptibility without a density"));
    const { result } = renderHook(() => useMagDerived());
    act(() => result.current.setOutput("mass"));
    await act(async () => { await result.current.createSusceptibility(); });
    expect(result.current.shown?.error).toMatch(/density/);
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("refuses when the worksheet changes during the calculation", async () => {
    vi.mocked(magneticSusceptibility).mockImplementation(async () => {
      useApp.setState({ datasets: [loop()] });
      return { susceptibility: [1, 1], errors: [[0, 0]], unit: "x", system: "cgs", output: "volume", response_unit: "", field_unit: "", basis_factor: 1, n_invalid_field: 0, formula: "" };
    });
    const { result } = renderHook(() => useMagDerived());
    await act(async () => { await result.current.createSusceptibility(); });
    expect(result.current.shown?.error).toMatch(/changed during the calculation/);
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("field uncertainty from a symmetric X-error role is sent, unit mismatch refused", async () => {
    const withX = loop({ values: [[-1, 0.1, 5], [0, 0.1, 5], [1, 0.1, 5]], labels: ["Magnetization", "M err", "H err"], units: ["emu/cm³", "emu/cm³", "Oe"] },
      [{ channel: 1, target: 0, axis: "y", side: "both" }, { channel: 2, target: -1, axis: "x", side: "both" }]);
    useApp.setState({ datasets: [withX] });
    const { result } = renderHook(() => useMagDerived());
    await act(async () => { await result.current.createSusceptibility(); });
    expect(magneticSusceptibility).toHaveBeenCalledWith(expect.objectContaining({ field_errors: [[5, 5, 5]] }));
    vi.clearAllMocks();
    useApp.setState({ datasets: [loop({ values: [[-1, 0.1, 5]], time: [-1000], labels: ["M", "e", "h"], units: ["emu/cm³", "emu/cm³", "T"] },
      [{ channel: 1, target: 0, axis: "y", side: "both" }, { channel: 2, target: -1, axis: "x", side: "both" }])], activeId: "mh" });
    const again = renderHook(() => useMagDerived());
    await act(async () => { await again.result.current.createSusceptibility(); });
    expect(again.result.current.shown?.error).toMatch(/field uncertainty column/);
    expect(magneticSusceptibility).not.toHaveBeenCalled();
  });
});
