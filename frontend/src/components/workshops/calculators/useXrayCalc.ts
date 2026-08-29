// Calculators — X-ray/neutron domain hook (extracted from useCalculators.ts,
// DIRACULATOR_AUDIT P3 split): Bragg / Q / energy scalar conversions
// (/api/xray/calc). Carries the P1 provenance contract: every setter feeding
// the conversion invalidates the shown result (bump the request id, clear
// result + error, drop busy); a completion whose id is no longer current is
// discarded — display and history alike.

import { useRef, useState } from "react";

import { xrayCalc } from "../../../lib/api";
import { fmtNum } from "../../../lib/format";
import { useCalcHistory } from "../../../store/calcHistory";

/** Bragg / Q / energy scalar conversions: backend mode + the unit of the
 *  value it takes in. `needsWavelength: false` marks the energy<->wavelength
 *  standalone modes, where the wavelength field isn't part of the input. */
export const XRAY_MODES: {
  value: string;
  label: string;
  inUnit: string;
  needsWavelength?: boolean;
}[] = [
  { value: "2theta_from_d", label: "d → 2θ", inUnit: "Å" },
  { value: "d_from_2theta", label: "2θ → d", inUnit: "°" },
  { value: "theta_from_d", label: "d → θ", inUnit: "Å" },
  { value: "d_from_theta", label: "θ → d", inUnit: "°" },
  { value: "q_from_2theta", label: "2θ → Q", inUnit: "°" },
  { value: "2theta_from_q", label: "Q → 2θ", inUnit: "1/Å" },
  { value: "q_from_d", label: "d → Q", inUnit: "Å" },
  { value: "d_from_q", label: "Q → d", inUnit: "1/Å" },
  { value: "energy_from_wavelength", label: "λ → E", inUnit: "Å", needsWavelength: false },
  { value: "wavelength_from_energy", label: "E → λ", inUnit: "keV", needsWavelength: false },
];

/** Precise characteristic-line wavelengths (Å) for the Bragg/Q converter's
 *  anode presets. More precise than the SLD tab's `WAVELENGTHS` quick-picks —
 *  textbook 2θ comparisons want the resolved Kα1 line (or the Kα1/Kα2-weighted
 *  average for "Cu Kα"), not a rounded quick-pick. */
export const ANODE_PRESETS: { label: string; a: number }[] = [
  { label: "Cu Kα1", a: 1.540598 },
  { label: "Cu Kα", a: 1.5418 },
  { label: "Co Kα1", a: 1.788996 },
  { label: "Mo Kα1", a: 0.7093187 },
  { label: "Cr Kα1", a: 2.289726 },
  { label: "Fe Kα1", a: 1.936041 },
  { label: "Ag Kα1", a: 0.5594075 },
];

export interface XrayResult {
  result: number;
  unit: string;
  description: string;
}

export interface XrayCalcState {
  xrayMode: string;
  wavelength: string;
  xrayValue: string;
  xrayOrder: string;
  xrayResult: XrayResult | null;
  xrayError: string | null;
  xrayBusy: boolean;
  setXrayMode: (m: string) => void;
  setWavelength: (v: string) => void;
  setXrayValue: (v: string) => void;
  setXrayOrder: (v: string) => void;
  xrayCompute: () => Promise<void>;
}

export function useXrayCalc(): XrayCalcState {
  const [xrayMode, setXrayModeRaw] = useState("2theta_from_d");
  const [wavelength, setWavelengthRaw] = useState("1.5406"); // Cu Kα
  const [xrayValue, setXrayValueRaw] = useState("3.1356"); // Si(111) d
  const [xrayOrder, setXrayOrderRaw] = useState("1"); // diffraction order n
  const [xrayResult, setXrayResult] = useState<XrayResult | null>(null);
  const [xrayError, setXrayError] = useState<string | null>(null);
  const [xrayBusy, setXrayBusy] = useState(false);
  const seq = useRef(0);

  const invalidate = (): void => {
    seq.current++;
    setXrayResult(null);
    setXrayError(null);
    setXrayBusy(false);
  };

  const setXrayMode = (m: string): void => {
    setXrayModeRaw(m);
    invalidate();
  };
  const setWavelength = (v: string): void => {
    setWavelengthRaw(v);
    invalidate();
  };
  const setXrayValue = (v: string): void => {
    setXrayValueRaw(v);
    invalidate();
  };
  const setXrayOrder = (v: string): void => {
    setXrayOrderRaw(v);
    invalidate();
  };

  async function xrayCompute(): Promise<void> {
    const id = ++seq.current;
    setXrayBusy(true);
    setXrayError(null);
    try {
      // DIRACULATOR_AUDIT P2: `needsWavelength` is derived HERE, not only in
      // the view — the standalone energy<->wavelength modes hide wavelength
      // and order, and hidden fields must never be validated (invalid stale
      // text in them blocked a calc that doesn't use them). Unused params go
      // to the API as the documented neutral values (w=0, n=1 — the same
      // convention XrayTab's own from-E helper already sends).
      const modeDef = XRAY_MODES.find((m) => m.value === xrayMode);
      const needsWavelength = modeDef?.needsWavelength !== false;
      const v = Number(xrayValue);
      if (!Number.isFinite(v)) throw new Error("enter a numeric value");
      let w = 0;
      let n = 1;
      if (needsWavelength) {
        w = Number(wavelength);
        n = Number(xrayOrder);
        if (!Number.isFinite(w)) throw new Error("enter numeric wavelength and value");
        if (!Number.isInteger(n) || n < 1) {
          throw new Error("order n must be a positive integer");
        }
      }
      const r = await xrayCalc(xrayMode, w, v, n);
      if (seq.current !== id) return; // superseded — a newer run/edit owns this panel
      setXrayResult(r);
      useCalcHistory.getState().record({
        domain: "Xray",
        label: modeDef?.label ?? xrayMode,
        summary: `${fmtNum(r.result)} ${r.unit}`,
        inputs: needsWavelength
          ? `mode=${xrayMode}, wavelength=${wavelength} Å, value=${xrayValue}, order=${xrayOrder}`
          : `mode=${xrayMode}, value=${xrayValue}`,
      });
    } catch (e) {
      if (seq.current !== id) return;
      setXrayResult(null);
      setXrayError(e instanceof Error ? e.message : "calculation failed");
    } finally {
      if (seq.current === id) setXrayBusy(false);
    }
  }

  return {
    xrayMode,
    wavelength,
    xrayValue,
    xrayOrder,
    xrayResult,
    xrayError,
    xrayBusy,
    setXrayMode,
    setWavelength,
    setXrayValue,
    setXrayOrder,
    xrayCompute,
  };
}
