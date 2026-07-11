// Reflectivity FFT section — state hook. Film thickness(es) from Kiessig-
// fringe periodicity in an XRR/NR scan, plus MATLAB's superlattice harmonic
// analysis, via /api/reductions/reflectivity-fft ->
// calc.reductions_fft.reflectivity_fft (golden vs MATLAB). Reads the active
// dataset's x/y through lib/rowstate.analysisData (#50/#53); x is 2-theta in
// degrees for XRR (needs `wavelength`) or Q in 1/Angstrom for NR
// (`isNeutron`). "→ Library" writes the FFT magnitude spectrum as a new
// dataset, mirroring useFftThickness / baseline's subtract().

import { useEffect, useState } from "react";

import { reflectivityFft } from "../../../lib/api";
import { analysisData } from "../../../lib/rowstate";
import type { Dataset, DataStruct, ReflectivityFftResult } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import type { ReductionColumn } from "./useFftThickness";

let _seq = 0;

export type ReflFftPreprocess = "logR" | "logRQ4" | "R" | "RQ4";

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
  const [isNeutron, setIsNeutron] = useState(false);
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
      const res = await reflectivityFft({
        x: d.time,
        reflectivity: y,
        is_neutron: isNeutron,
        wavelength_a: isNeutron ? undefined : wavelength,
        x_min: xMin ?? undefined,
        x_max: xMax ?? undefined,
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
      id: `reflfft-${++_seq}`,
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
