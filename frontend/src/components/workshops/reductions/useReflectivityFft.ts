// Reflectivity FFT section — state hook. Film thickness(es) from Kiessig-
// fringe periodicity in an XRR/NR scan, plus MATLAB's superlattice harmonic
// analysis, via /api/reductions/reflectivity-fft ->
// calc.reductions_fft.reflectivity_fft (golden vs MATLAB). Reads the active
// dataset's x/y through lib/rowstate.analysisData (#50/#53); x is 2-theta in
// degrees for XRR (needs `wavelength`) or Q in 1/Angstrom for NR
// (`isNeutron`). "→ Library" writes the FFT magnitude spectrum as a new
// dataset, mirroring useFftThickness / baseline's subtract().

import { useEffect, useState } from "react";

import { reflectivityFft } from "../../../lib/api/reductions";
import type { ReflectivityFftResult } from "../../../lib/reductionTypes";
import { analysisData } from "../../../lib/rowstate";
import type { Dataset, DataStruct } from "../../../lib/types";
import { nextDatasetId, useActiveDataset, useApp } from "../../../store/useApp";
import type { ReductionColumn } from "./useFftThickness";

export type ReflFftPreprocess = "logR" | "logRQ4" | "R" | "RQ4";

// The file's own say on its x axis. `is_neutron` means "x is Q in Å⁻¹" to the
// backend, so a neutron probe (ORSO/NCNR metadata) or a reciprocal-length x
// unit opens checked. Restated from reflectivity/reflFitData rather than
// imported: sharing that module across two lazy chunks splits it into a third
// and grows the eager preload map.
const NM = /nm(⁻¹|\^?-1)|1\/nm/;
function unitOf(d: DataStruct | undefined): string {
  return String(d?.metadata?.x_column_unit ?? "").toLowerCase();
}
function xIsQ(d: DataStruct | undefined): boolean {
  const unit = unitOf(d);
  return /neutron/i.test(String(d?.metadata?.probe ?? "")) || NM.test(unit) || /ang|å|a-1|1\/a/.test(unit);
}

export interface ReflectivityFftState {
  active: Dataset | null;
  columns: ReductionColumn[];
  col: number;
  setCol: (i: number) => void;
  isNeutron: boolean;
  setIsNeutron: (v: boolean) => void;
  wavelength: number;
  setWavelength: (v: number) => void;
  xMin: number | null;
  xMax: number | null;
  setXMin: (v: number | null) => void;
  setXMax: (v: number | null) => void;
  windowFn: string;
  setWindowFn: (w: string) => void;
  preprocess: ReflFftPreprocess;
  setPreprocess: (p: ReflFftPreprocess) => void;
  maxThicknessNm: number;
  setMaxThicknessNm: (v: number) => void;
  peakProminence: number;
  setPeakProminence: (v: number) => void;
  result: ReflectivityFftResult | null;
  busy: boolean;
  error: string | null;
  compute: () => Promise<void>;
  toLibrary: () => void;
  clear: () => void;
}

export function useReflectivityFft(): ReflectivityFftState {
  const active = useActiveDataset();
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);

  const columns: ReductionColumn[] = active
    ? active.data.labels.map((lab, i) => ({ index: i, label: lab || `Column ${i + 1}` }))
    : [];

  const [col, setCol] = useState(0);
  const [isNeutron, setIsNeutron] = useState(() => xIsQ(active?.data));
  const [wavelength, setWavelength] = useState(1.5406);
  const [xMin, setXMin] = useState<number | null>(null);
  const [xMax, setXMax] = useState<number | null>(null);
  const [windowFn, setWindowFn] = useState("hann");
  const [preprocess, setPreprocess] = useState<ReflFftPreprocess>("logR");
  const [maxThicknessNm, setMaxThicknessNm] = useState(500);
  const [peakProminence, setPeakProminence] = useState(0.05);
  const [result, setResult] = useState<ReflectivityFftResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
    setCol(0);
    setIsNeutron(xIsQ(active?.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-default per dataset, not per edit
  }, [active?.id]);

  async function compute(): Promise<void> {
    if (!active) return;
    if (!isNeutron && !(wavelength > 0)) {
      setError("wavelength is required for XRR (2θ) mode");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // #38 deferred edge: resolve the active dataset's full data first.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      const d = analysisData(ds) ?? ds.data;
      const y = d.values.map((row) => row[col]);
      const k = isNeutron && NM.test(unitOf(d)) ? 0.1 : 1; // nm⁻¹ → Å⁻¹
      const res = await reflectivityFft({
        x: k === 1 ? d.time : d.time.map((q) => q * k),
        reflectivity: y,
        is_neutron: isNeutron,
        wavelength_a: isNeutron ? undefined : wavelength,
        x_min: xMin == null ? undefined : xMin * k,
        x_max: xMax == null ? undefined : xMax * k,
        window: windowFn,
        preprocess,
        max_thickness_nm: maxThicknessNm,
        peak_prominence_threshold: peakProminence,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "reflectivity FFT failed");
    } finally {
      setBusy(false);
    }
  }

  function toLibrary(): void {
    if (!result) return;
    const data: DataStruct = {
      time: result.thickness_axis,
      values: result.fft_magnitude.map((v) => [v]),
      labels: ["FFT magnitude"],
      units: [""],
      metadata: { reduction: "reflectivity-fft", thicknesses_nm: result.thicknesses_nm },
    };
    addDataset({
      id: nextDatasetId(),
      name: `${active?.name ?? "scan"} (refl FFT)`,
      data,
    });
    const n = result.thicknesses_nm.length;
    setStatus(`added reflectivity-FFT spectrum (${n} peak${n === 1 ? "" : "s"})`);
  }

  function clear(): void {
    setResult(null);
    setError(null);
  }

  return {
    active,
    columns,
    col,
    setCol,
    isNeutron,
    setIsNeutron,
    wavelength,
    setWavelength,
    xMin,
    xMax,
    setXMin,
    setXMax,
    windowFn,
    setWindowFn,
    preprocess,
    setPreprocess,
    maxThicknessNm,
    setMaxThicknessNm,
    peakProminence,
    setPeakProminence,
    result,
    busy,
    error,
    compute,
    toLibrary,
    clear,
  };
}
