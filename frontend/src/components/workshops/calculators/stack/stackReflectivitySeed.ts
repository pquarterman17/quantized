// Film stack -> Reflectivity hand-off, the stack's half (plan G4): turn the
// planner's rows into a StackSeed. Provisional, owner to confirm.
//
// Rules (fail closed, nothing guessed):
//  - every layer needs a thickness above 0 nm; it is sent as Å (nm x 10);
//  - the stack lists layers bottom to top, a Parratt model top to bottom, so
//    the order is reversed and the substrate goes last (semi-infinite);
//  - an SLD is computed only from a layer's own formula + mass density by
//    the existing /api/sld/formula (X-ray at the stack's wavelength); with
//    either missing it is null (blank, flagged in Reflectivity);
//  - a formula the SLD calculator rejects is an error, not a silent blank.

import { sldFromFormula } from "../../../../lib/api/sld";
import type { StackSeed, StackSeedLayer } from "../../../../store/workshopFlags";

export const NM_TO_ANGSTROM = 10;
const PER_1E6 = 1e-6; // the SLD route reports 10⁻⁶ Å⁻²; Reflectivity wants Å⁻²

export interface SeedInputRow {
  name: string;
  thickness: string; // nm
  formula: string;
  density: string; // g/cm³
}

async function sldFor(label: string, formula: string, density: string, wavelength: number): Promise<StackSeedLayer["sld"]> {
  const blank = { xray: null, neutron: null, xrayAbs: null };
  const f = formula.trim();
  const rho = Number(density);
  if (f === "" || density.trim() === "") return blank;
  if (!Number.isFinite(rho)) throw new Error(`${label} density: enter a number (g/cm³) or leave it blank`);
  if (rho <= 0) throw new Error(`${label} density: must be above 0 g/cm³`);
  try {
    const r = await sldFromFormula({ formula: f, density: rho, xray_wavelength: wavelength });
    return { xray: r.xray.sld_real * PER_1E6, neutron: r.neutron.sld_real * PER_1E6, xrayAbs: r.xray.sld_imag * PER_1E6 };
  } catch (e) {
    throw new Error(`${label} SLD: ${e instanceof Error ? e.message : "formula rejected"}`);
  }
}

/** Build the seed. `layers` are bottom to top (the stack tab's order). */
export async function buildStackSeed(
  substrate: { formula: string; density: string },
  layers: SeedInputRow[],
  wavelength: number,
): Promise<StackSeed> {
  if (layers.length === 0) throw new Error("add at least one layer");
  if (!Number.isFinite(wavelength) || wavelength <= 0) throw new Error("λ: enter a number above 0 Å");
  const films: StackSeedLayer[] = [];
  for (const [i, l] of layers.entries()) {
    const label = l.name.trim() || `layer ${i + 1}`;
    const t = Number(l.thickness);
    if (l.thickness.trim() === "" || !Number.isFinite(t) || t <= 0) {
      throw new Error(`${label} thickness: enter a number above 0 nm`);
    }
    films.push({ name: label, thicknessA: t * NM_TO_ANGSTROM, sld: await sldFor(label, l.formula, l.density, wavelength) });
  }
  const sub: StackSeedLayer = {
    name: "substrate",
    thicknessA: null,
    sld: await sldFor("substrate", substrate.formula, substrate.density, wavelength),
  };
  return { stack: [...films.reverse(), sub], label: "film stack" };
}
