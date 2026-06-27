// Calculators workshop — state hook. Two tools backed by golden calc helpers:
// a unit converter (/api/reference/convert → calc.unit_convert, with dimensional,
// temperature-offset, and energy↔wavelength / H↔B bridges) and a physical-constants
// reference (/api/reference/constants → calc.constants, CODATA). Pure orchestration.

import { useEffect, useState } from "react";

import { convertUnits, getConstants, xrayCalc } from "../../../lib/api";

export type CalcTab = "units" | "constants" | "xray";

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
  };
}
