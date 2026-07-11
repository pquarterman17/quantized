import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fftThickness } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useFftThickness } from "./useFftThickness";

vi.mock("../../../lib/api", () => ({
  fftThickness: vi.fn(),
}));

const scan: DataStruct = {
  time: [10, 20, 30, 40],
  values: [[1], [2], [3], [4]],
  labels: ["Intensity"],
  units: ["cps"],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "xrd.dat", data: scan }],
    activeId: "d1",
    status: "",
  });
});

describe("useFftThickness", () => {
  it("computes over the active dataset's first channel with auto range", async () => {
    vi.mocked(fftThickness).mockResolvedValue({
      thickness_nm: 55.5,
      uncertainty_nm: 1.2,
      wavelength_a: 1.5406,
      two_theta_range: [10, 40],
      fft_magnitude: [0, 1, 2],
      thickness_axis: [0, 10, 20],
      n_points: 4,
    });
    const { result } = renderHook(() => useFftThickness());

    await act(async () => {
      await result.current.compute();
    });

    expect(fftThickness).toHaveBeenCalledWith({
      two_theta_deg: [10, 20, 30, 40],
      intensity: [1, 2, 3, 4],
      wavelength_a: 1.5406,
      two_theta_min: undefined,
      two_theta_max: undefined,
      window: "hann",
      max_thickness_nm: 200,
    });
    expect(result.current.result?.thickness_nm).toBe(55.5);
  });

  it("passes an explicit 2-theta range once set", async () => {
    vi.mocked(fftThickness).mockResolvedValue({
      thickness_nm: 10, uncertainty_nm: null, wavelength_a: 1.5406,
      two_theta_range: [15, 35], fft_magnitude: [], thickness_axis: [], n_points: 2,
    });
    const { result } = renderHook(() => useFftThickness());
    act(() => {
      result.current.setTwoThetaMin(15);
      result.current.setTwoThetaMax(35);
    });
    await act(async () => {
      await result.current.compute();
    });
    expect(fftThickness).toHaveBeenCalledWith(
      expect.objectContaining({ two_theta_min: 15, two_theta_max: 35 }),
    );
  });

  it("adds the FFT spectrum to the library on toLibrary", async () => {
    vi.mocked(fftThickness).mockResolvedValue({
      thickness_nm: 55.5, uncertainty_nm: null, wavelength_a: 1.5406,
      two_theta_range: [10, 40], fft_magnitude: [0, 1, 2], thickness_axis: [0, 10, 20], n_points: 4,
    });
    const { result } = renderHook(() => useFftThickness());
    await act(async () => {
      await result.current.compute();
    });
    act(() => result.current.toLibrary());

    const datasets = useApp.getState().datasets;
    expect(datasets).toHaveLength(2);
    expect(datasets[1].data.time).toEqual([0, 10, 20]);
    expect(datasets[1].data.values).toEqual([[0], [1], [2]]);
    expect(datasets[1].data.labels).toEqual(["FFT magnitude"]);
  });

  it("surfaces the API's error message", async () => {
    vi.mocked(fftThickness).mockRejectedValue(new Error("range too narrow"));
    const { result } = renderHook(() => useFftThickness());
    await act(async () => {
      await result.current.compute();
    });
    expect(result.current.error).toBe("range too narrow");
    expect(result.current.result).toBeNull();
  });

  it("resets the result and channel when the active dataset changes", async () => {
    vi.mocked(fftThickness).mockResolvedValue({
      thickness_nm: 5, uncertainty_nm: null, wavelength_a: 1.5406,
      two_theta_range: [10, 40], fft_magnitude: [], thickness_axis: [], n_points: 4,
    });
    const { result, rerender } = renderHook(() => useFftThickness());
    await act(async () => {
      await result.current.compute();
    });
    expect(result.current.result).not.toBeNull();

    act(() => {
      useApp.setState({
        datasets: [
          { id: "d1", name: "xrd.dat", data: scan },
          { id: "d2", name: "xrd2.dat", data: scan },
        ],
        activeId: "d2",
      });
    });
    rerender();
    expect(result.current.result).toBeNull();
  });
});
