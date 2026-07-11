import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reflectivityFft } from "../../../lib/api";
import type { DataStruct, SuperlatticeResult } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useReflectivityFft } from "./useReflectivityFft";

vi.mock("../../../lib/api", () => ({
  reflectivityFft: vi.fn(),
}));

const scan: DataStruct = {
  time: [0.01, 0.05, 0.09, 0.12],
  values: [[1], [0.5], [0.2], [0.1]],
  labels: ["R"],
  units: [""],
  metadata: {},
};

const NO_SL: SuperlatticeResult = {
  detected: false,
  bilayer_period_nm: null,
  total_thickness_nm: null,
  n_repeats: null,
  sublayer_a_nm: null,
  sublayer_b_nm: null,
  suppressed_orders: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "xrr.dat", data: scan }],
    activeId: "d1",
    status: "",
  });
});

describe("useReflectivityFft", () => {
  it("defaults to XRR mode and requires a wavelength", async () => {
    const { result } = renderHook(() => useReflectivityFft());
    act(() => result.current.setWavelength(0));
    await act(async () => {
      await result.current.compute();
    });
    expect(result.current.error).toMatch(/wavelength is required/);
    expect(reflectivityFft).not.toHaveBeenCalled();
  });

  it("computes in XRR mode with the wavelength", async () => {
    vi.mocked(reflectivityFft).mockResolvedValue({
      thicknesses_nm: [50], amplitudes: [10], harmonic_labels: ["Independent"],
      q_range: [0.01, 0.12], preprocess: "logR", fft_magnitude: [1, 2], thickness_axis: [0, 10],
      is_neutron: false, wavelength_a: 1.5406, superlattice: NO_SL,
    });
    const { result } = renderHook(() => useReflectivityFft());

    await act(async () => {
      await result.current.compute();
    });

    expect(reflectivityFft).toHaveBeenCalledWith({
      x: [0.01, 0.05, 0.09, 0.12],
      reflectivity: [1, 0.5, 0.2, 0.1],
      is_neutron: false,
      wavelength_a: 1.5406,
      x_min: undefined,
      x_max: undefined,
      window: "hann",
      preprocess: "logR",
      max_thickness_nm: 500,
      peak_prominence_threshold: 0.05,
    });
    expect(result.current.result?.thicknesses_nm).toEqual([50]);
  });

  it("computes in neutron mode without requiring a wavelength", async () => {
    vi.mocked(reflectivityFft).mockResolvedValue({
      thicknesses_nm: [50], amplitudes: [10], harmonic_labels: ["Independent"],
      q_range: [0.01, 0.12], preprocess: "logR", fft_magnitude: [], thickness_axis: [],
      is_neutron: true, superlattice: NO_SL,
    });
    const { result } = renderHook(() => useReflectivityFft());
    act(() => {
      result.current.setIsNeutron(true);
      result.current.setWavelength(0); // irrelevant in neutron mode
    });

    await act(async () => {
      await result.current.compute();
    });

    expect(reflectivityFft).toHaveBeenCalledWith(
      expect.objectContaining({ is_neutron: true, wavelength_a: undefined }),
    );
    expect(result.current.error).toBeNull();
  });

  it("adds the FFT spectrum to the library on toLibrary", async () => {
    vi.mocked(reflectivityFft).mockResolvedValue({
      thicknesses_nm: [50], amplitudes: [10], harmonic_labels: ["Independent"],
      q_range: [0.01, 0.12], preprocess: "logR", fft_magnitude: [1, 2], thickness_axis: [0, 10],
      is_neutron: false, wavelength_a: 1.5406, superlattice: NO_SL,
    });
    const { result } = renderHook(() => useReflectivityFft());
    await act(async () => {
      await result.current.compute();
    });
    act(() => result.current.toLibrary());

    const datasets = useApp.getState().datasets;
    expect(datasets).toHaveLength(2);
    expect(datasets[1].data.time).toEqual([0, 10]);
    expect(datasets[1].data.values).toEqual([[1], [2]]);
  });

  it("surfaces the API's error message", async () => {
    vi.mocked(reflectivityFft).mockRejectedValue(new Error("too few points"));
    const { result } = renderHook(() => useReflectivityFft());
    await act(async () => {
      await result.current.compute();
    });
    expect(result.current.error).toBe("too few points");
    expect(result.current.result).toBeNull();
  });
});
