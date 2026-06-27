import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { convertUnits, getConstants, xrayCalc } from "../../../lib/api";
import { useCalculators } from "./useCalculators";

vi.mock("../../../lib/api", () => ({
  convertUnits: vi.fn(),
  getConstants: vi.fn(),
  xrayCalc: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getConstants).mockResolvedValue({ constants: { h: 6.626e-34, c: 2.998e8 } });
});

describe("useCalculators", () => {
  it("loads constants on mount", async () => {
    const { result } = renderHook(() => useCalculators());
    await waitFor(() => expect(result.current.constants).not.toBeNull());
    expect(result.current.constants?.h).toBeCloseTo(6.626e-34, 37);
  });

  it("converts a value and surfaces the result + description", async () => {
    vi.mocked(convertUnits).mockResolvedValue({
      result: 0.0001,
      info: { description: "1 Oe = 0.0001 T" },
    });
    const { result } = renderHook(() => useCalculators());

    await act(async () => {
      await result.current.convert();
    });

    expect(convertUnits).toHaveBeenCalledWith(1, "Oe", "T");
    expect(result.current.result).toBeCloseTo(0.0001, 8);
    expect(result.current.description).toBe("1 Oe = 0.0001 T");
    expect(result.current.error).toBeNull();
  });

  it("setPair swaps from/to and clears the stale result", async () => {
    vi.mocked(convertUnits).mockResolvedValue({ result: 0.0001, info: {} });
    const { result } = renderHook(() => useCalculators());
    await act(async () => {
      await result.current.convert();
    });
    expect(result.current.result).not.toBeNull();

    act(() => result.current.setPair("eV", "nm"));
    expect(result.current.from).toBe("eV");
    expect(result.current.to).toBe("nm");
    expect(result.current.result).toBeNull();
  });

  it("rejects a non-numeric value without calling the API", async () => {
    const { result } = renderHook(() => useCalculators());
    act(() => result.current.setValue("abc"));
    await act(async () => {
      await result.current.convert();
    });
    expect(convertUnits).not.toHaveBeenCalled();
    expect(result.current.error).toContain("numeric");
  });

  it("surfaces an incompatible-dimension error from the backend", async () => {
    vi.mocked(convertUnits).mockRejectedValue(new Error("incompatible dimensions"));
    const { result } = renderHook(() => useCalculators());
    act(() => result.current.setPair("Oe", "J"));
    await act(async () => {
      await result.current.convert();
    });
    expect(result.current.error).toContain("incompatible");
    expect(result.current.result).toBeNull();
  });

  it("computes an x-ray conversion with the default mode + Cu Kα", async () => {
    vi.mocked(xrayCalc).mockResolvedValue({ result: 28.44, unit: "deg", description: "2θ from d" });
    const { result } = renderHook(() => useCalculators());

    await act(async () => {
      await result.current.xrayCompute();
    });

    // defaults: mode "2theta_from_d", λ = 1.5406 (Cu Kα), value = 3.1356 (Si 111 d).
    expect(xrayCalc).toHaveBeenCalledWith("2theta_from_d", 1.5406, 3.1356);
    expect(result.current.xrayResult?.result).toBeCloseTo(28.44, 2);
    expect(result.current.xrayResult?.unit).toBe("deg");
    expect(result.current.xrayError).toBeNull();
  });

  it("rejects a non-numeric wavelength without calling the API", async () => {
    const { result } = renderHook(() => useCalculators());
    act(() => result.current.setWavelength("abc"));
    await act(async () => {
      await result.current.xrayCompute();
    });
    expect(xrayCalc).not.toHaveBeenCalled();
    expect(result.current.xrayError).toContain("numeric");
  });

  it("surfaces an inaccessible-reflection error from the backend", async () => {
    vi.mocked(xrayCalc).mockRejectedValue(new Error("reflection inaccessible"));
    const { result } = renderHook(() => useCalculators());
    act(() => {
      result.current.setXrayValue("0.5"); // d < λ/2 → no Bragg solution
    });
    await act(async () => {
      await result.current.xrayCompute();
    });
    expect(result.current.xrayError).toContain("inaccessible");
    expect(result.current.xrayResult).toBeNull();
  });
});
