// Reflectivity FFT section — state hook. Film thickness(es) from Kiessig-
// fringe periodicity in an XRR/NR scan, plus MATLAB's superlattice harmonic
// analysis, via /api/reductions/reflectivity-fft ->
// calc.reductions_fft.reflectivity_fft (golden vs MATLAB). Reads the active
// dataset's x/y through lib/rowstate.analysisData (#50/#53); x is 2-theta in
// degrees for XRR (needs `wavelength`) or Q in 1/Angstrom for NR
// (`isNeutron`). "→ Library" writes the FFT magnitude spectrum as a new
// dataset, mirroring useFftThickness / baseline's subtract().

import { useEffect, useRef, useState } from "react";

import { reflectivityFft } from "../../../lib/api/reductions";
import type { ReflectivityFftResult } from "../../../lib/reductionTypes";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { analysisData } from "../../../lib/rowstate";
import type { Dataset, DataStruct } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { useAnalysisCommit } from "../resultcommit/useAnalysisCommit";
import { useLatestRef } from "../../../lib/previewKey";
import { afterCommit } from "../workbench/afterCommit";
import { datasetInputsToken } from "../workbench/inputsKey";
import { useRunStamp } from "../workbench/useRunStamp";
import { type ReflFftPreprocess, reflectivityFftBody, xIsQ } from "./reductionRequests";
import type { ReductionColumn } from "./useFftThickness";

export type { ReflFftPreprocess };

const REFL_FFT_PRODUCER = { id: "reflectivity-fft", label: "Reflectivity FFT", version: 1 } as const;

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
  /** The shown result was computed under settings or rows that have since changed. */
  stale: boolean;
  busy: boolean;
  error: string | null;
  compute: () => Promise<void>;
  toLibrary: () => void;
  /** Why "→ Library" is unavailable (out of date, or already added); null when it is enabled. */
  addDisabledReason: string | null;
  clear: () => void;
}

export function useReflectivityFft(): ReflectivityFftState {
  const active = useActiveDataset();

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
  // What the shown result was computed from: the source worksheet and the settings
  // the run was made with (the commit key and the out-of-date stamp).
  const [ran, setRan] = useState<{ sourceId: string; sourceName: string; computedOn: string; inputs: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Lane WB6: stamped with the key the run LAUNCHED with (see useFftThickness).
  const runKey = JSON.stringify([
    datasetInputsToken(active), col, isNeutron, wavelength, xMin, xMax, windowFn, preprocess, maxThicknessNm, peakProminence,
  ]);
  const stamp = useRunStamp(runKey);
  const stale = result !== null && stamp.stale;
  const settingsKey = JSON.stringify([col, isNeutron, wavelength, xMin, xMax, windowFn, preprocess, maxThicknessNm, peakProminence]);
  const settingsRef = useLatestRef(settingsKey);
  const seq = useRef(0);

  useEffect(() => {
    seq.current += 1;
    stamp.record(null);
    setBusy(false);
    setResult(null);
    setRan(null);
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
    const id = ++seq.current;
    const clickSettings = settingsKey;
    const clickKey = runKey;
    setBusy(true);
    setError(null);
    try {
      // #38 deferred edge: resolve the active dataset's full data first; a lazy
      // book's arrival moves the run key, so it commits before the key is taken.
      // The key this run LAUNCHES with is the click's own render key: the refs below catch
      // up in a passive effect, and a row or fingerprint change during the awaits must
      // leave the result stamped with the rows the click was made on (so it lands stale),
      // never current. Only a lazy book's arrival legitimately moves the key.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      if (active.pending) await afterCommit();
      if (id !== seq.current) return;
      // The user changed a setting while the book loaded: this request carries the
      // old ones, so abandon it rather than stamp it with the new key.
      if (settingsRef.current !== clickSettings) return;
      const launchKey = active.pending ? stamp.launchKey() : clickKey;
      const d = analysisData(ds) ?? ds.data;
      const res = await reflectivityFft(reflectivityFftBody(d, col, {
        isNeutron, wavelength, xMin, xMax, windowFn, preprocess, maxThicknessNm, peakProminence,
      }));
      if (id !== seq.current) return;
      stamp.record(launchKey);
      setRan({
        sourceId: ds.id, sourceName: ds.name, computedOn: analysisDataFingerprint(ds),
        inputs: { col, isNeutron, wavelength, xMin, xMax, windowFn, preprocess, maxThicknessNm, peakProminence },
      });
      setResult(res);
    } catch (e) {
      if (id !== seq.current) return;
      setError(e instanceof Error ? e.message : "reflectivity FFT failed");
    } finally {
      if (id === seq.current) setBusy(false);
    }
  }

  const commit = useAnalysisCommit(result && ran && !stale ? {
    producer: REFL_FFT_PRODUCER,
    sourceId: ran.sourceId,
    computedOn: ran.computedOn,
    settings: { ...(ran.inputs as Record<string, unknown>), thicknessesNm: result.thicknesses_nm, n: result.thickness_axis.length },
    status: `added reflectivity-FFT spectrum (${result.thicknesses_nm.length} peak${result.thicknesses_nm.length === 1 ? "" : "s"})`,
    output: () => {
      const data: DataStruct = {
        time: result.thickness_axis,
        values: result.fft_magnitude.map((v) => [v]),
        labels: ["FFT magnitude"],
        units: [""],
        metadata: { reduction: "reflectivity-fft", thicknesses_nm: result.thicknesses_nm },
      };
      return { name: `${ran.sourceName} (refl FFT)`, data };
    },
  } : null);

  function toLibrary(): void {
    if (stale || commit.disabledReason) return;
    commit.commit();
  }

  function clear(): void {
    seq.current += 1;
    stamp.record(null);
    setBusy(false);
    setResult(null);
    setRan(null);
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
    stale,
    busy,
    error,
    compute,
    toLibrary,
    addDisabledReason: stale ? "Out of date: the settings or rows changed since this result. Compute again." : commit.disabledReason,
    clear,
  };
}
