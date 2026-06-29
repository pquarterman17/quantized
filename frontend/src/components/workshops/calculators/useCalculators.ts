// Calculators workshop — state hook. Two tools backed by golden calc helpers:
// a unit converter (/api/reference/convert → calc.unit_convert, with dimensional,
// temperature-offset, and energy↔wavelength / H↔B bridges) and a physical-constants
// reference (/api/reference/constants → calc.constants, CODATA). Pure orchestration.

import { useEffect, useState } from "react";

import {
  convertUnits,
  crystalCell,
  crystalDSpacing,
  getConstants,
  sldFromFormula,
  xrayCalc,
} from "../../../lib/api";
import type { SldFormulaResult } from "../../../lib/api";

export type CalcTab = "units" | "constants" | "xray" | "crystal" | "sld" | "elements";

export type CellAngle = "alpha" | "beta" | "gamma";

/** Crystal systems for the d-spacing calculator: the lattice lengths (beyond `a`)
 *  and the lattice angles each one needs shown in the form. (`a` is always shown;
 *  hexagonal fixes γ=120 implicitly, rhombohedral sets α=β=γ.) */
export const CRYSTAL_SYSTEMS: {
  value: string;
  label: string;
  lengths: ("b" | "c")[];
  angles: CellAngle[];
}[] = [
  { value: "cubic", label: "Cubic", lengths: [], angles: [] },
  { value: "tetragonal", label: "Tetragonal", lengths: ["c"], angles: [] },
  { value: "hexagonal", label: "Hexagonal", lengths: ["c"], angles: [] },
  { value: "rhombohedral", label: "Rhombohedral", lengths: [], angles: ["alpha"] },
  { value: "orthorhombic", label: "Orthorhombic", lengths: ["b", "c"], angles: [] },
  { value: "monoclinic", label: "Monoclinic", lengths: ["b", "c"], angles: ["beta"] },
  { value: "triclinic", label: "Triclinic", lengths: ["b", "c"], angles: ["alpha", "beta", "gamma"] },
];

export interface CrystalForm {
  system: string;
  a: string;
  b: string;
  c: string;
  alpha: string;
  beta: string;
  gamma: string;
  h: string;
  k: string;
  l: string;
  formula: string;
  z: string;
}

/** Resolve the full cell (lengths + angles, numeric) from the form + the active
 *  system: unused lengths default to `a`; unused angles to 90; hexagonal fixes
 *  γ=120 and rhombohedral sets α=β=γ. Throws on a non-numeric field. */
export function assembleCell(f: CrystalForm): {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
} {
  const spec = CRYSTAL_SYSTEMS.find((s) => s.value === f.system);
  const num = (s: string, label: string): number => {
    const v = Number(s);
    if (!Number.isFinite(v)) throw new Error(`enter a numeric ${label}`);
    return v;
  };
  const a = num(f.a, "a");
  const b = spec?.lengths.includes("b") ? num(f.b, "b") : a;
  const c = spec?.lengths.includes("c") ? num(f.c, "c") : a;
  let alpha = spec?.angles.includes("alpha") ? num(f.alpha, "α") : 90;
  let beta = spec?.angles.includes("beta") ? num(f.beta, "β") : 90;
  let gamma = spec?.angles.includes("gamma") ? num(f.gamma, "γ") : 90;
  if (f.system === "hexagonal") gamma = 120;
  if (f.system === "rhombohedral") {
    beta = alpha;
    gamma = alpha;
  }
  return { a, b, c, alpha, beta, gamma };
}

/** Bragg / Q↔2θ conversions: backend mode + the unit of the value it takes in. */
export const XRAY_MODES: { value: string; label: string; inUnit: string }[] = [
  { value: "2theta_from_d", label: "d → 2θ", inUnit: "Å" },
  { value: "d_from_2theta", label: "2θ → d", inUnit: "°" },
  { value: "q_from_2theta", label: "2θ → Q", inUnit: "°" },
  { value: "2theta_from_q", label: "Q → 2θ", inUnit: "1/Å" },
];

/** Common characteristic X-ray wavelengths (Å) as one-click presets. */
export const WAVELENGTHS: { label: string; a: number }[] = [
  { label: "Cu Kα", a: 1.5406 },
  { label: "Mo Kα", a: 0.7107 },
  { label: "Co Kα", a: 1.789 },
  { label: "Cr Kα", a: 2.2897 },
];

export interface XrayResult {
  result: number;
  unit: string;
  description: string;
}

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

/** Common conversions offered as one-click chips (all supported by the backend). */
export const QUICK_PAIRS: { label: string; from: string; to: string }[] = [
  { label: "Oe → T", from: "Oe", to: "T" },
  { label: "T → G", from: "T", to: "G" },
  { label: "eV → nm", from: "eV", to: "nm" },
  { label: "eV → THz", from: "eV", to: "THz" },
  { label: "K → C", from: "K", to: "C" },
  { label: "J → eV", from: "J", to: "eV" },
  { label: "GPa → bar", from: "GPa", to: "bar" },
  { label: "Ang → nm", from: "Ang", to: "nm" },
];

export interface CalculatorsState {
  tab: CalcTab;
  setTab: (t: CalcTab) => void;
  // Unit converter
  value: string;
  from: string;
  to: string;
  result: number | null;
  description: string | null;
  error: string | null;
  busy: boolean;
  setValue: (v: string) => void;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  setPair: (from: string, to: string) => void;
  convert: () => Promise<void>;
  // Constants
  constants: Record<string, number> | null;
  // X-ray / neutron (Bragg, Q↔2θ)
  xrayMode: string;
  wavelength: string;
  xrayValue: string;
  xrayResult: XrayResult | null;
  xrayError: string | null;
  xrayBusy: boolean;
  setXrayMode: (m: string) => void;
  setWavelength: (v: string) => void;
  setXrayValue: (v: string) => void;
  xrayCompute: () => Promise<void>;
  // Crystallography (d-spacing from lattice + Miller indices)
  crystal: CrystalForm;
  crResult: { d: number; system: string } | null;
  crError: string | null;
  crBusy: boolean;
  updCrystal: (patch: Partial<CrystalForm>) => void;
  crCompute: () => Promise<void>;
  // Cell volume + theoretical density (same lattice; optional formula + Z)
  cellResult: { volume: number; molar_mass?: number; density?: number } | null;
  cellError: string | null;
  cellBusy: boolean;
  cellCompute: () => Promise<void>;
  // SLD from formula (neutron + X-ray, real + imaginary/absorption)
  sld: SldForm;
  sldResult: SldFormulaResult | null;
  sldError: string | null;
  sldBusy: boolean;
  updSld: (patch: Partial<SldForm>) => void;
  setSldPreset: (formula: string, density: number) => void;
  sldCompute: () => Promise<void>;
}

export function useCalculators(): CalculatorsState {
  const [tab, setTab] = useState<CalcTab>("units");
  const [value, setValue] = useState("1");
  const [from, setFrom] = useState("Oe");
  const [to, setTo] = useState("T");
  const [result, setResult] = useState<number | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [constants, setConstants] = useState<Record<string, number> | null>(null);
  const [xrayMode, setXrayMode] = useState("2theta_from_d");
  const [wavelength, setWavelength] = useState("1.5406"); // Cu Kα
  const [xrayValue, setXrayValue] = useState("3.1356"); // Si(111) d
  const [xrayResult, setXrayResult] = useState<XrayResult | null>(null);
  const [xrayError, setXrayError] = useState<string | null>(null);
  const [xrayBusy, setXrayBusy] = useState(false);
  const [crystal, setCrystal] = useState<CrystalForm>({
    system: "cubic", a: "5.4309", b: "5.4309", c: "5.4309",
    alpha: "90", beta: "90", gamma: "90", h: "1", k: "1", l: "1",
    formula: "Si", z: "8",
  });
  const [crResult, setCrResult] = useState<{ d: number; system: string } | null>(null);
  const [crError, setCrError] = useState<string | null>(null);
  const [crBusy, setCrBusy] = useState(false);
  const [cellResult, setCellResult] = useState<
    { volume: number; molar_mass?: number; density?: number } | null
  >(null);
  const [cellError, setCellError] = useState<string | null>(null);
  const [cellBusy, setCellBusy] = useState(false);
  const [sld, setSld] = useState<SldForm>({
    formula: "Si",
    density: "2.33",
    neutronWavelength: "1.798",
    xrayWavelength: "1.5406", // Cu Kα (matches the X-ray-tab presets)
  });
  const [sldResult, setSldResult] = useState<SldFormulaResult | null>(null);
  const [sldError, setSldError] = useState<string | null>(null);
  const [sldBusy, setSldBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getConstants()
      .then((r) => {
        if (!cancelled) setConstants(r.constants);
      })
      .catch(() => {
        /* offline — constants tab shows a notice */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPair = (f: string, t: string): void => {
    setFrom(f);
    setTo(t);
    setResult(null);
    setDescription(null);
    setError(null);
  };

  async function convert(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const v = Number(value);
      if (!Number.isFinite(v)) throw new Error("enter a numeric value");
      const res = await convertUnits(v, from, to);
      const out = typeof res.result === "number" ? res.result : null;
      setResult(out);
      setDescription(typeof res.info?.description === "string" ? res.info.description : null);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "conversion failed");
    } finally {
      setBusy(false);
    }
  }

  async function xrayCompute(): Promise<void> {
    setXrayBusy(true);
    setXrayError(null);
    try {
      const w = Number(wavelength);
      const v = Number(xrayValue);
      if (!Number.isFinite(w) || !Number.isFinite(v)) {
        throw new Error("enter numeric wavelength and value");
      }
      setXrayResult(await xrayCalc(xrayMode, w, v));
    } catch (e) {
      setXrayResult(null);
      setXrayError(e instanceof Error ? e.message : "calculation failed");
    } finally {
      setXrayBusy(false);
    }
  }

  const updCrystal = (patch: Partial<CrystalForm>): void =>
    setCrystal((s) => ({ ...s, ...patch }));

  async function crCompute(): Promise<void> {
    setCrBusy(true);
    setCrError(null);
    try {
      const cell = assembleCell(crystal);
      const h = Number(crystal.h);
      const k = Number(crystal.k);
      const l = Number(crystal.l);
      if ([h, k, l].some((v) => !Number.isFinite(v))) {
        throw new Error("enter numeric Miller indices");
      }
      setCrResult(await crystalDSpacing({ system: crystal.system, ...cell, h, k, l }));
    } catch (e) {
      setCrResult(null);
      setCrError(e instanceof Error ? e.message : "calculation failed");
    } finally {
      setCrBusy(false);
    }
  }

  async function cellCompute(): Promise<void> {
    setCellBusy(true);
    setCellError(null);
    try {
      const cell = assembleCell(crystal);
      const formula = crystal.formula.trim();
      const z = Number(crystal.z);
      if (formula && !(Number.isFinite(z) && z >= 1)) {
        throw new Error("Z must be an integer ≥ 1");
      }
      setCellResult(
        await crystalCell({ ...cell, ...(formula ? { formula, z } : {}) }),
      );
    } catch (e) {
      setCellResult(null);
      setCellError(e instanceof Error ? e.message : "calculation failed");
    } finally {
      setCellBusy(false);
    }
  }

  const updSld = (patch: Partial<SldForm>): void => setSld((s) => ({ ...s, ...patch }));

  const setSldPreset = (formula: string, density: number): void => {
    setSld((s) => ({ ...s, formula, density: String(density) }));
    setSldResult(null);
    setSldError(null);
  };

  async function sldCompute(): Promise<void> {
    setSldBusy(true);
    setSldError(null);
    try {
      const density = Number(sld.density);
      const nw = Number(sld.neutronWavelength);
      const xw = Number(sld.xrayWavelength);
      if (!sld.formula.trim()) throw new Error("enter a chemical formula");
      if (!(density > 0)) throw new Error("enter a positive density");
      if (!(nw > 0 && xw > 0)) throw new Error("enter positive wavelengths");
      setSldResult(
        await sldFromFormula({
          formula: sld.formula.trim(),
          density,
          neutron_wavelength: nw,
          xray_wavelength: xw,
        }),
      );
    } catch (e) {
      setSldResult(null);
      setSldError(e instanceof Error ? e.message : "calculation failed");
    } finally {
      setSldBusy(false);
    }
  }

  return {
    tab,
    setTab,
    value,
    from,
    to,
    result,
    description,
    error,
    busy,
    setValue,
    setFrom,
    setTo,
    setPair,
    convert,
    constants,
    xrayMode,
    wavelength,
    xrayValue,
    xrayResult,
    xrayError,
    xrayBusy,
    setXrayMode,
    setWavelength,
    setXrayValue,
    xrayCompute,
    crystal,
    crResult,
    crError,
    crBusy,
    updCrystal,
    crCompute,
    cellResult,
    cellError,
    cellBusy,
    cellCompute,
    sld,
    sldResult,
    sldError,
    sldBusy,
    updSld,
    setSldPreset,
    sldCompute,
  };
}
