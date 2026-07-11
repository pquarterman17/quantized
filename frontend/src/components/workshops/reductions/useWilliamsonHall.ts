// Williamson-Hall section — state hook. Crystallite size + microstrain from a
// manually-entered XRD peak list (2-theta, FWHM) via
// /api/reductions/williamson-hall -> calc.reductions.williamson_hall (golden
// vs MATLAB). Peak entry is manual for v1: the Peaks workshop's fitted peaks
// (center/fwhm — see usePeaks.ts's `fitResult`) live only in ITS OWN component
// state, never published to the store, so there is nothing durable to prefill
// from without new cross-workshop plumbing. Documented follow-up (MAIN_PLAN
// #11), not built here per the porting brief ("do not build new cross-
// workshop plumbing for v1").

import { useState } from "react";

import { williamsonHall } from "../../../lib/api";
import type { WilliamsonHallResult } from "../../../lib/types";

export interface WHPeakRow {
  twoTheta: number;
  fwhm: number;
}

const emptyRow = (): WHPeakRow => ({ twoTheta: 0, fwhm: 0 });

export interface WilliamsonHallState {
  rows: WHPeakRow[];
  wavelength: number;
  kFactor: number;
  instrumentalBroadening: number;
  result: WilliamsonHallResult | null;
  busy: boolean;
  error: string | null;
  /** At least 2 rows, each with 0 < 2θ < 180 and FWHM > 0, plus positive
   *  wavelength/K — mirrors the backend's own validation (calc.reductions). */
  canCompute: boolean;
  addRow: () => void;
  removeRow: (index: number) => void;
  updateRow: (index: number, patch: Partial<WHPeakRow>) => void;
  setWavelength: (v: number) => void;
  setKFactor: (v: number) => void;
  setInstrumentalBroadening: (v: number) => void;
  compute: () => Promise<void>;
  clear: () => void;
}

export function useWilliamsonHall(): WilliamsonHallState {
  const [rows, setRows] = useState<WHPeakRow[]>([emptyRow(), emptyRow()]);
  const [wavelength, setWavelength] = useState(1.5406);
  const [kFactor, setKFactor] = useState(0.9);
  const [instrumentalBroadening, setInstrumentalBroadening] = useState(0);
  const [result, setResult] = useState<WilliamsonHallResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCompute =
    rows.length >= 2 &&
    rows.every((r) => r.twoTheta > 0 && r.twoTheta < 180 && r.fwhm > 0) &&
    wavelength > 0 &&
    kFactor > 0;

  const addRow = (): void => setRows((r) => [...r, emptyRow()]);
  const removeRow = (index: number): void => setRows((r) => r.filter((_, i) => i !== index));
  const updateRow = (index: number, patch: Partial<WHPeakRow>): void =>
    setRows((r) => r.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  async function compute(): Promise<void> {
    if (!canCompute) {
      setError("enter at least 2 valid peaks (0 < 2θ < 180, FWHM > 0)");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await williamsonHall({
        two_theta_deg: rows.map((r) => r.twoTheta),
        fwhm_deg: rows.map((r) => r.fwhm),
        wavelength_a: wavelength,
        k_factor: kFactor,
        instrumental_broadening_deg: instrumentalBroadening,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Williamson-Hall fit failed");
    } finally {
      setBusy(false);
    }
  }

  function clear(): void {
    setResult(null);
    setError(null);
  }

  return {
    rows,
    wavelength,
    kFactor,
    instrumentalBroadening,
    result,
    busy,
    error,
    canCompute,
    addRow,
    removeRow,
    updateRow,
    setWavelength,
    setKFactor,
    setInstrumentalBroadening,
    compute,
    clear,
  };
}
