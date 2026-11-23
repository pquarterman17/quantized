// FFT thickness and Reflectivity FFT fail closed: a blank / non-finite cell is
// refused with a count (it used to reach the backend as JSON null and come back
// as a bare 422), and a worksheet removed while its full data loaded says so
// instead of the Compute button silently doing nothing.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fftThickness, reflectivityFft } from "../../../lib/api/reductions";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useFftThickness } from "./useFftThickness";
import { useReflectivityFft } from "./useReflectivityFft";

vi.mock("../../../lib/api/reductions", () => ({ fftThickness: vi.fn(), reflectivityFft: vi.fn() }));

const gappy: DataStruct = {
  time: [10, 20, 30, 40],
  values: [[1], [Number.NaN], [3], [4]],
  labels: ["Intensity"], units: ["cps"], metadata: {},
};

const realResolve = useApp.getState().resolveDataset;

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ resolveDataset: realResolve });
  useApp.setState({ datasets: [{ id: "d1", name: "xrd.dat", data: gappy }], activeId: "d1", status: "" });
});

describe("FFT refusals", () => {
  it("FFT thickness refuses a gap with a count and sends nothing", async () => {
    const { result } = renderHook(() => useFftThickness());
    await act(async () => { await result.current.compute(); });
    expect(result.current.error).toMatch(/1 of 4 rows have a blank or non-finite/);
    expect(fftThickness).not.toHaveBeenCalled();
    expect(result.current.result).toBeNull();
  });

  it("Reflectivity FFT refuses a gap with a count and sends nothing", async () => {
    const { result } = renderHook(() => useReflectivityFft());
    await act(async () => { await result.current.compute(); });
    expect(result.current.error).toMatch(/1 of 4 rows have a blank or non-finite/);
    expect(reflectivityFft).not.toHaveBeenCalled();
  });

  it("FFT thickness says so when the worksheet disappears while its data loads", async () => {
    const { result } = renderHook(() => useFftThickness());
    useApp.setState({ resolveDataset: async () => undefined });
    await act(async () => { await result.current.compute(); });
    expect(result.current.error).toMatch(/no longer available/);
  });

  it("Reflectivity FFT says so when the worksheet disappears while its data loads", async () => {
    const { result } = renderHook(() => useReflectivityFft());
    useApp.setState({ resolveDataset: async () => undefined });
    await act(async () => { await result.current.compute(); });
    expect(result.current.error).toMatch(/no longer available/);
  });
});

describe("FFT refusals clear and never block valid scans", () => {
  const clean: DataStruct = { ...gappy, values: [[1], [2], [3], [4]] };
  const FFT = { thickness_nm: 12.5, thickness_axis: [0, 1], fft_magnitude: [1, 2], peaks: [] };

  it("FFT thickness: the refusal clears on the next valid run, and a clean scan is sent whole", async () => {
    vi.mocked(fftThickness).mockResolvedValue(FFT as never);
    const { result } = renderHook(() => useFftThickness());
    await act(async () => { await result.current.compute(); });
    expect(result.current.error).toMatch(/blank or non-finite/);
    act(() => useApp.setState({ datasets: [{ id: "d1", name: "xrd.dat", data: clean }] }));
    await act(async () => { await result.current.compute(); });
    expect(result.current.error).toBeNull();
    expect(vi.mocked(fftThickness).mock.calls[0]![0]).toMatchObject({ two_theta_deg: [10, 20, 30, 40], intensity: [1, 2, 3, 4] });
  });

  it("refuses a blank X cell too (not only the intensity)", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "xrd.dat", data: { ...clean, time: [10, Number.NaN, 30, 40] } }] });
    const { result } = renderHook(() => useFftThickness());
    await act(async () => { await result.current.compute(); });
    expect(result.current.error).toMatch(/1 of 4 rows/);
    expect(fftThickness).not.toHaveBeenCalled();
  });
});
