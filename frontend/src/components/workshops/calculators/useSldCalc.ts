// Calculators — SLD domain hook (extracted from useCalculators.ts,
// DIRACULATOR_AUDIT P3 split): neutron + X-ray scattering-length density
// from a chemical formula (/api/xray/sld-formula). Carries the P1 provenance
// contract: any form edit or preset pick invalidates the shown result; a
// completion whose request id is no longer current is discarded — display
// and history alike.

import { useRef, useState } from "react";

import { sldFromFormula } from "../../../lib/api";
import type { SldFormulaResult } from "../../../lib/api";
import { fmtNum } from "../../../lib/format";
import { useCalcHistory } from "../../../store/calcHistory";

/** Common characteristic X-ray wavelengths (Å) as one-click presets (rounded
 *  — SLD tab quick-picks, where sub-mÅ precision doesn't matter). */
export const WAVELENGTHS: { label: string; a: number }[] = [
  { label: "Cu Kα", a: 1.5406 },
  { label: "Mo Kα", a: 0.7107 },
  { label: "Co Kα", a: 1.789 },
  { label: "Cr Kα", a: 2.2897 },
];

/** Common neutron wavelengths (Å): thermal (2200 m/s) + a couple of cold lines. */
export const NEUTRON_WAVELENGTHS: { label: string; a: number }[] = [
  { label: "Thermal", a: 1.798 },
  { label: "4.75 Å", a: 4.75 },
  { label: "5 Å", a: 5.0 },
  { label: "6 Å", a: 6.0 },
];

/** One-click material presets for the SLD calculator (formula + mass density). */
export const SLD_PRESETS: { label: string; formula: string; density: number }[] = [
  { label: "Si", formula: "Si", density: 2.33 },
  { label: "SiO₂", formula: "SiO2", density: 2.65 },
  { label: "Al₂O₃", formula: "Al2O3", density: 3.95 },
  { label: "Fe", formula: "Fe", density: 7.87 },
  { label: "H₂O", formula: "H2O", density: 1.0 },
  { label: "D₂O", formula: "D2O", density: 1.11 },
];

export interface SldForm {
  formula: string;
  density: string;
  neutronWavelength: string;
  xrayWavelength: string;
}

export interface SldCalcState {
  sld: SldForm;
  sldResult: SldFormulaResult | null;
  sldError: string | null;
  sldBusy: boolean;
  updSld: (patch: Partial<SldForm>) => void;
  setSldPreset: (formula: string, density: number) => void;
  sldCompute: () => Promise<void>;
}

export function useSldCalc(): SldCalcState {
  const [sld, setSld] = useState<SldForm>({
    formula: "Si",
    density: "2.33",
    neutronWavelength: "1.798",
    xrayWavelength: "1.5406", // Cu Kα (matches the X-ray-tab presets)
  });
  const [sldResult, setSldResult] = useState<SldFormulaResult | null>(null);
  const [sldError, setSldError] = useState<string | null>(null);
  const [sldBusy, setSldBusy] = useState(false);
  const seq = useRef(0);

  const invalidate = (): void => {
    seq.current++;
    setSldResult(null);
    setSldError(null);
    setSldBusy(false);
  };

  const updSld = (patch: Partial<SldForm>): void => {
    setSld((s) => ({ ...s, ...patch }));
    invalidate();
  };

  const setSldPreset = (formula: string, density: number): void => {
    updSld({ formula, density: String(density) });
  };

  async function sldCompute(): Promise<void> {
    const id = ++seq.current;
    setSldBusy(true);
    setSldError(null);
    try {
      const density = Number(sld.density);
      const nw = Number(sld.neutronWavelength);
      const xw = Number(sld.xrayWavelength);
      if (!sld.formula.trim()) throw new Error("enter a chemical formula");
      if (!(density > 0)) throw new Error("enter a positive density");
      if (!(nw > 0 && xw > 0)) throw new Error("enter positive wavelengths");
      const r = await sldFromFormula({
        formula: sld.formula.trim(),
        density,
        neutron_wavelength: nw,
        xray_wavelength: xw,
      });
      if (seq.current !== id) return; // superseded — a newer run/edit owns this panel
      setSldResult(r);
      useCalcHistory.getState().record({
        domain: "Sld",
        label: "SLD from formula",
        summary:
          `${r.formula}: SLD_n = ${fmtNum(r.neutron.sld_real)}, ` +
          `SLD_x = ${fmtNum(r.xray.sld_real)} ×10⁻⁶ Å⁻²`,
      });
    } catch (e) {
      if (seq.current !== id) return;
      setSldResult(null);
      setSldError(e instanceof Error ? e.message : "calculation failed");
    } finally {
      if (seq.current === id) setSldBusy(false);
    }
  }

  return { sld, sldResult, sldError, sldBusy, updSld, setSldPreset, sldCompute };
}
