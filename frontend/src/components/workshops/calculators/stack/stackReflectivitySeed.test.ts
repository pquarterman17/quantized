import { beforeEach, describe, expect, it, vi } from "vitest";

import { sldFromFormula } from "../../../../lib/api/sld";
import { buildStackSeed } from "./stackReflectivitySeed";

vi.mock("../../../../lib/api/sld", () => ({ sldFromFormula: vi.fn() }));

const probe = (re: number, im = 0) => ({ wavelength: 1, sld_real: re, sld_imag: im, penetration: 0, qc: 0 });
const row = (o: Partial<{ name: string; thickness: string; formula: string; density: string }> = {}) => ({
  name: "film", thickness: "20", formula: "", density: "", ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sldFromFormula).mockResolvedValue({
    formula: "X", molar_mass: 1, number_density: 1, neutron: probe(2.07), xray: probe(20.1, 0.5),
  });
});

describe("buildStackSeed", () => {
  it("reverses bottom-to-top rows, converts nm to Å, puts the substrate last", async () => {
    const seed = await buildStackSeed({ formula: "", density: "" }, [row({ name: "A", thickness: "20" }), row({ name: "B", thickness: "1.5" })], 1.5406);
    expect(seed.stack.map((l) => l.name)).toEqual(["B", "A", "substrate"]);
    expect(seed.stack.map((l) => l.thicknessA)).toEqual([15, 200, null]);
  });

  it("computes SLD (10^-6 Å^-2 to Å^-2) only from formula + density, at the stack's λ", async () => {
    const seed = await buildStackSeed({ formula: "Si", density: "2.33" }, [row({ formula: "Ni", density: "8.9" })], 1.54);
    expect(sldFromFormula).toHaveBeenCalledWith({ formula: "Ni", density: 8.9, xray_wavelength: 1.54 });
    expect(seed.stack[0].sld.xray).toBeCloseTo(20.1e-6, 15);
    expect(seed.stack[0].sld.neutron).toBeCloseTo(2.07e-6, 15);
    expect(seed.stack[0].sld.xrayAbs).toBeCloseTo(0.5e-6, 15);
    expect(sldFromFormula).toHaveBeenCalledTimes(2);
  });

  it("leaves SLD null (no API call) when formula or density is missing", async () => {
    const seed = await buildStackSeed({ formula: "Si", density: "" }, [row({ formula: "Ni" }), row({ density: "5" })], 1.54);
    expect(sldFromFormula).not.toHaveBeenCalled();
    for (const l of seed.stack) expect(l.sld).toEqual({ xray: null, neutron: null, xrayAbs: null });
  });

  it.each(["", "abc", "0", "-5"])("fails closed on thickness %j", async (t) => {
    await expect(buildStackSeed({ formula: "", density: "" }, [row({ thickness: t })], 1.54)).rejects.toThrow(/thickness/);
  });

  it("fails closed on an empty stack, a bad λ, a bad density and a rejected formula", async () => {
    await expect(buildStackSeed({ formula: "", density: "" }, [], 1.54)).rejects.toThrow(/at least one layer/);
    await expect(buildStackSeed({ formula: "", density: "" }, [row()], 0)).rejects.toThrow(/λ/);
    await expect(buildStackSeed({ formula: "", density: "" }, [row({ formula: "Ni", density: "-1" })], 1.54)).rejects.toThrow(/density/);
    vi.mocked(sldFromFormula).mockRejectedValue(new Error("unknown element"));
    await expect(buildStackSeed({ formula: "", density: "" }, [row({ formula: "Qq", density: "1" })], 1.54)).rejects.toThrow(/film SLD: unknown element/);
  });
});
