// FFT film-thickness section — state hook. Film thickness from Laue-fringe
// periodicity in a 2-theta/intensity XRD scan via
// /api/reductions/fft-thickness -> calc.reductions_fft.fft_thickness (golden
// vs MATLAB). Reads the active dataset's x/y through lib/rowstate.analysisData
// (the #50/#53 row-state chokepoint) so excluded/filtered rows never bias the
// FFT; the backend does the 2theta-range subsetting itself (two_theta_min/max
// are optional pass-throughs, not sliced client-side). "→ Library" writes the
// FFT magnitude spectrum as a new dataset — the same addDataset-derived-result
// pattern baseline's subtract() and datasetmath's compute() use.

import { useEffect, useState } from "react";

import { fftThickness } from "../../../lib/api";
import { analysisData } from "../../../lib/rowstate";
import type { Dataset, DataStruct, FftThicknessResult } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

let _seq = 0;

export interface ReductionColumn {
  index: number;
  label: string;
}

export interface FftThicknessState {
  active: Dataset | null;
  columns: ReductionColumn[];
  col: number;
  setCol: (i: number) => void;
  wavelength: number;
  setWavelength: (v: number) => void;
  /** null = auto (full range); passed through to the backend un-sliced. */
  twoThetaMin: number | null;
  twoThetaMax: number | null;
  setTwoThetaMin: (v: number | null) => void;
  setTwoThetaMax: (v: number | null) => void;
  windowFn: string;
  setWindowFn: (w: string) => void;
  maxThicknessNm: number;
  setMaxThicknessNm: (v: number) => void;
  result: FftThicknessResult | null;
  busy: boolean;
  error: string | null;
  compute: () => Promise<void>;
  toLibrary: () => void;
  clear: () => void;
}

export function useFftThickness(): FftThicknessState {
  const active = useActiveDataset();
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);

  const columns: ReductionColumn[] = active
    ? active.data.labels.map((lab, i) => ({ index: i, label: lab || `Column ${i + 1}` }))
    : [];

  const [col, setCol] = useState(0);
  const [wavelength, setWavelength] = useState(1.5406);
  const [twoThetaMin, setTwoThetaMin] = useState<number | null>(null);
  const [twoThetaMax, setTwoThetaMax] = useState<number | null>(null);
  const [windowFn, setWindowFn] = useState("hann");
  const [maxThicknessNm, setMaxThicknessNm] = useState(200);
  const [result, setResult] = useState<FftThicknessResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new active dataset invalidates the current result and resets the picker.
  useEffect(() => {
    setResult(null);
    setError(null);
    setCol(0);
  }, [active?.id]);

  async function compute(): Promise<void> {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      // #38 deferred edge: never FFT against the small preview — resolve the
      // active dataset's full data first.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      const d = analysisData(ds) ?? ds.data;
      const y = d.values.map((row) => row[col]);
      const res = await fftThickness({
        two_theta_deg: d.time,
        intensity: y,
        wavelength_a: wavelength,
        two_theta_min: twoThetaMin ?? undefined,
        two_theta_max: twoThetaMax ?? undefined,
        window: windowFn,
        max_thickness_nm: maxThicknessNm,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "FFT thickness failed");
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
      metadata: { reduction: "fft-thickness", thickness_nm: result.thickness_nm },
    };
    addDataset({
      id: `fftthk-${++_seq}`,
      name: `${active?.name ?? "scan"} (FFT thickness)`,
      data,
    });
    setStatus(`added FFT-thickness spectrum (${result.thickness_nm.toFixed(2)} nm)`);
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
    wavelength,
    setWavelength,
    twoThetaMin,
    twoThetaMax,
    setTwoThetaMin,
    setTwoThetaMax,
    windowFn,
    setWindowFn,
    maxThicknessNm,
    setMaxThicknessNm,
    result,
    busy,
    error,
    compute,
    toLibrary,
    clear,
  };
}
