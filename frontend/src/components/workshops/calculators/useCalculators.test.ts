import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { convertUnits, crystalCell, crystalDSpacing, getConstants, xrayCalc } from "../../../lib/api";
import { assembleCell, type CrystalForm, useCalculators } from "./useCalculators";

vi.mock("../../../lib/api", () => ({
  convertUnits: vi.fn(),
  getConstants: vi.fn(),
  xrayCalc: vi.fn(),
  crystalDSpacing: vi.fn(),
  crystalCell: vi.fn(),
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

  it("computes a d-spacing from lattice params + Miller indices", async () => {
    vi.mocked(crystalDSpacing).mockResolvedValue({ d: 3.1356, system: "cubic" });
    const { result } = renderHook(() => useCalculators());

    await act(async () => {
      await result.current.crCompute();
    });

    // defaults: cubic, a=5.4309, (111); angles fill to 90.
    expect(crystalDSpacing).toHaveBeenCalledWith({
      system: "cubic", a: 5.4309, b: 5.4309, c: 5.4309,
      alpha: 90, beta: 90, gamma: 90, h: 1, k: 1, l: 1,
    });
    expect(result.current.crResult?.d).toBeCloseTo(3.1356, 4);
    expect(result.current.crError).toBeNull();
  });

  it("updCrystal patches the form and switches system", () => {
    const { result } = renderHook(() => useCalculators());
    act(() => result.current.updCrystal({ system: "hexagonal", a: "2.46", c: "6.70" }));
    expect(result.current.crystal.system).toBe("hexagonal");
    expect(result.current.crystal.a).toBe("2.46");
    expect(result.current.crystal.c).toBe("6.70");
  });

  it("surfaces a zero-hkl error from the backend", async () => {
    vi.mocked(crystalDSpacing).mockRejectedValue(new Error("must not all be zero"));
    const { result } = renderHook(() => useCalculators());
    act(() => result.current.updCrystal({ h: "0", k: "0", l: "0" }));
    await act(async () => {
      await result.current.crCompute();
    });
    expect(result.current.crError).toContain("zero");
    expect(result.current.crResult).toBeNull();
  });

  it("computes cell volume + density from the formula", async () => {
    vi.mocked(crystalCell).mockResolvedValue({ volume: 160.18, molar_mass: 28.09, density: 2.33 });
    const { result } = renderHook(() => useCalculators());

    await act(async () => {
      await result.current.cellCompute();
    });

    // defaults: cubic a=5.4309, formula "Si", Z=8 → cube + formula passed through.
    expect(crystalCell).toHaveBeenCalledWith({
      a: 5.4309, b: 5.4309, c: 5.4309, alpha: 90, beta: 90, gamma: 90, formula: "Si", z: 8,
    });
    expect(result.current.cellResult?.density).toBeCloseTo(2.33, 2);
    expect(result.current.cellError).toBeNull();
  });

  it("omits the formula when it is blank (volume only)", async () => {
    vi.mocked(crystalCell).mockResolvedValue({ volume: 64 });
    const { result } = renderHook(() => useCalculators());
    act(() => result.current.updCrystal({ formula: "  " }));
    await act(async () => {
      await result.current.cellCompute();
    });
    expect(crystalCell).toHaveBeenCalledWith({
      a: 5.4309, b: 5.4309, c: 5.4309, alpha: 90, beta: 90, gamma: 90,
    });
    expect(result.current.cellResult?.volume).toBe(64);
  });
});

describe("assembleCell", () => {
  const base: CrystalForm = {
    system: "cubic", a: "4", b: "5", c: "6", alpha: "80", beta: "85", gamma: "95",
    h: "1", k: "0", l: "0", formula: "", z: "1",
  };

  it("fills unused lengths from a and angles to 90 (cubic)", () => {
    expect(assembleCell(base)).toEqual({ a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 });
  });

  it("fixes γ=120 for hexagonal", () => {
    const cell = assembleCell({ ...base, system: "hexagonal", c: "6.7" });
    expect(cell).toMatchObject({ a: 4, b: 4, c: 6.7, alpha: 90, beta: 90, gamma: 120 });
  });

  it("sets α=β=γ for rhombohedral", () => {
    const cell = assembleCell({ ...base, system: "rhombohedral", alpha: "70" });
    expect(cell).toEqual({ a: 4, b: 4, c: 4, alpha: 70, beta: 70, gamma: 70 });
  });

  it("uses all six params for triclinic", () => {
    const cell = assembleCell({ ...base, system: "triclinic" });
    expect(cell).toEqual({ a: 4, b: 5, c: 6, alpha: 80, beta: 85, gamma: 95 });
  });

  it("throws on a non-numeric length", () => {
    expect(() => assembleCell({ ...base, a: "xyz" })).toThrow(/numeric a/);
  });
});
