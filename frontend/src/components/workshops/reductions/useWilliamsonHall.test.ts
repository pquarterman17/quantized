import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { williamsonHall } from "../../../lib/api";
import { useWilliamsonHall } from "./useWilliamsonHall";

vi.mock("../../../lib/api", () => ({
  williamsonHall: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useWilliamsonHall", () => {
  it("starts with 2 empty peak rows and compute disabled", () => {
    const { result } = renderHook(() => useWilliamsonHall());
    expect(result.current.rows).toEqual([
      { twoTheta: 0, fwhm: 0 },
      { twoTheta: 0, fwhm: 0 },
    ]);
    expect(result.current.canCompute).toBe(false);
  });

  it("adds, updates, and removes rows", () => {
    const { result } = renderHook(() => useWilliamsonHall());
    act(() => result.current.addRow());
    expect(result.current.rows).toHaveLength(3);

    act(() => result.current.updateRow(0, { twoTheta: 30.1, fwhm: 0.25 }));
    expect(result.current.rows[0]).toEqual({ twoTheta: 30.1, fwhm: 0.25 });

    act(() => result.current.removeRow(2));
    expect(result.current.rows).toHaveLength(2);
  });

  it("rejects out-of-range peaks from canCompute", () => {
    const { result } = renderHook(() => useWilliamsonHall());
    act(() => {
      result.current.updateRow(0, { twoTheta: 200, fwhm: 0.2 }); // >= 180
      result.current.updateRow(1, { twoTheta: 40, fwhm: 0.3 });
    });
    expect(result.current.canCompute).toBe(false);
  });

  it("computes with valid rows and maps the result", async () => {
    vi.mocked(williamsonHall).mockResolvedValue({
      grain_size_nm: 42,
      microstrain: 0.001,
      r2: 0.98,
      plot_x: [0.35, 0.69],
      plot_y: [0.01, 0.02],
      fit_line: [0.001, 0.05],
    });
    const { result } = renderHook(() => useWilliamsonHall());
    act(() => {
      result.current.updateRow(0, { twoTheta: 30.1, fwhm: 0.25 });
      result.current.updateRow(1, { twoTheta: 43.2, fwhm: 0.28 });
    });
    expect(result.current.canCompute).toBe(true);

    await act(async () => {
      await result.current.compute();
    });

    expect(williamsonHall).toHaveBeenCalledWith({
      two_theta_deg: [30.1, 43.2],
      fwhm_deg: [0.25, 0.28],
      wavelength_a: 1.5406,
      k_factor: 0.9,
      instrumental_broadening_deg: 0,
    });
    expect(result.current.result?.grain_size_nm).toBe(42);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a validation message and skips the API call when rows are invalid", async () => {
    const { result } = renderHook(() => useWilliamsonHall());
    await act(async () => {
      await result.current.compute();
    });
    expect(result.current.error).toMatch(/at least 2 valid peaks/);
    expect(williamsonHall).not.toHaveBeenCalled();
  });

  it("surfaces the API's error message", async () => {
    vi.mocked(williamsonHall).mockRejectedValue(new Error("bad wavelength"));
    const { result } = renderHook(() => useWilliamsonHall());
    act(() => {
      result.current.updateRow(0, { twoTheta: 30, fwhm: 0.2 });
      result.current.updateRow(1, { twoTheta: 40, fwhm: 0.3 });
    });
    await act(async () => {
      await result.current.compute();
    });
    expect(result.current.error).toBe("bad wavelength");
    expect(result.current.result).toBeNull();
  });

  it("clear() drops the result and error", async () => {
    vi.mocked(williamsonHall).mockResolvedValue({
      grain_size_nm: 10, microstrain: 0, r2: 1, plot_x: [], plot_y: [], fit_line: [0, 0],
    });
    const { result } = renderHook(() => useWilliamsonHall());
    act(() => {
      result.current.updateRow(0, { twoTheta: 30, fwhm: 0.2 });
      result.current.updateRow(1, { twoTheta: 40, fwhm: 0.3 });
    });
    await act(async () => {
      await result.current.compute();
    });
    expect(result.current.result).not.toBeNull();
    act(() => result.current.clear());
    expect(result.current.result).toBeNull();
  });
});
