// FFT film-thickness section — state hook. Film thickness from Laue-fringe
// periodicity in a 2-theta/intensity XRD scan via
// /api/reductions/fft-thickness -> calc.reductions_fft.fft_thickness (golden
// vs MATLAB). Reads the active dataset's x/y through lib/rowstate.analysisData
// (the #50/#53 row-state chokepoint) so excluded/filtered rows never bias the
// FFT; the backend does the 2theta-range subsetting itself (two_theta_min/max
// are optional pass-throughs, not sliced client-side). "→ Library" writes the
// FFT magnitude spectrum as a new dataset — the same addDataset-derived-result
// pattern baseline's subtract() and datasetmath's compute() use.

import { useEffect, useRef, useState } from "react";

import { fftThickness } from "../../../lib/api/reductions";
import type { FftThicknessResult } from "../../../lib/reductionTypes";
import { analysisData } from "../../../lib/rowstate";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { Dataset, DataStruct } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { useAnalysisCommit } from "../resultcommit/useAnalysisCommit";
import { useLatestRef } from "../../../lib/previewKey";
import { afterCommit } from "../workbench/afterCommit";
import { datasetInputsToken } from "../workbench/inputsKey";
import { useRunStamp } from "../workbench/useRunStamp";
import { fftThicknessBody, gapProblem } from "./reductionRequests";

const FFT_THICKNESS_PRODUCER = { id: "fft-thickness", label: "FFT thickness", version: 1 } as const;

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
  /** The shown result was computed under settings or rows that have since changed. */
  stale: boolean;
  busy: boolean;
  error: string | null;
  compute: () => Promise<void>;
  toLibrary: () => void;
  /** Why "→ Library" is disabled (already added, or nothing to add). */
  addDisabledReason: string | null;
  clear: () => void;
}

export function useFftThickness(): FftThicknessState {
  const active = useActiveDataset();

  const columns: ReductionColumn[] = active
    ? active.data.labels.map((lab, i) => ({ index: i, label: lab || `Column ${i + 1}` }))
    : [];

  const [col, setCol] = useState(0);
  const [wavelength, setWavelength] = useState(1.5406);
  const [twoThetaMin, setTwoThetaMin] = useState<number | null>(null);
  const [twoThetaMax, setTwoThetaMax] = useState<number | null>(null);
  const [windowFn, setWindowFn] = useState("hann");
  const [maxThicknessNm, setMaxThicknessNm] = useState(200);
  // The run as computed: the source and its analysis-view fingerprint, and the
  // inputs, so the commit is keyed by value (one undo step, no duplicate,
  // stale when the source changes: store/analysisOutputCommit.ts).
  const [computed, setComputed] = useState<{
    res: FftThicknessResult; sourceId: string; sourceName: string; computedOn: string; inputs: Record<string, unknown>;
  } | null>(null);
  const result = computed?.res ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Lane WB6: the result is stamped with the key its run LAUNCHED with; any
  // setting or source-row change afterwards marks it out of date.
  const runKey = JSON.stringify([datasetInputsToken(active), col, wavelength, twoThetaMin, twoThetaMax, windowFn, maxThicknessNm]);
  const stamp = useRunStamp(runKey);
  const stale = computed !== null && stamp.stale;
  const settingsKey = JSON.stringify([col, wavelength, twoThetaMin, twoThetaMax, windowFn, maxThicknessNm]);
  const settingsRef = useLatestRef(settingsKey);
  // Bumped on a dataset switch, Clear and every run: an answer for a run the
  // user has left is dropped.
  const seq = useRef(0);

  // A new active dataset invalidates the current result and resets the picker.
  useEffect(() => {
    seq.current += 1;
    stamp.record(null);
    setBusy(false);
    setComputed(null);
    setError(null);
    setCol(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per dataset, not per render of the stamp
  }, [active?.id]);

  async function compute(): Promise<void> {
    if (!active) return;
    const id = ++seq.current;
    const clickSettings = settingsKey;
    const clickKey = runKey;
    setBusy(true);
    setError(null);
    try {
      // #38 deferred edge: never FFT against the small preview — resolve the
      // active dataset's full data first. A lazy book's arrival moves the run
      // key, so let that commit land before taking the key this run is asked with.
      // The key this run LAUNCHES with is the click's own render key: the refs below catch
      // up in a passive effect, and a row or fingerprint change during the awaits must
      // leave the result stamped with the rows the click was made on (so it lands stale),
      // never current. Only a lazy book's arrival legitimately moves the key.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) throw new Error("The worksheet is no longer available (removed or replaced while its full data loaded); nothing was computed.");
      if (active.pending) await afterCommit();
      if (id !== seq.current) return;
      // The user changed a setting while the book loaded: this request carries the
      // old ones, so abandon it rather than stamp it with the new key.
      if (settingsRef.current !== clickSettings) return;
      const launchKey = active.pending ? stamp.launchKey() : clickKey;
      const d = analysisData(ds) ?? ds.data;
      const gap = gapProblem(d, col);
      if (gap) throw new Error(gap);
      const res = await fftThickness(fftThicknessBody(d, col, { wavelength, twoThetaMin, twoThetaMax, windowFn, maxThicknessNm }));
      if (id !== seq.current) return;
      stamp.record(launchKey);
      setComputed({
        res, sourceId: ds.id, sourceName: ds.name, computedOn: analysisDataFingerprint(ds),
        inputs: { col, wavelength, twoThetaMin, twoThetaMax, windowFn, maxThicknessNm },
      });
    } catch (e) {
      if (id !== seq.current) return;
      setError(e instanceof Error ? e.message : "FFT thickness failed");
    } finally {
      if (id === seq.current) setBusy(false);
    }
  }

  const commit = useAnalysisCommit(computed && !stale ? {
    producer: FFT_THICKNESS_PRODUCER,
    sourceId: computed.sourceId,
    computedOn: computed.computedOn,
    settings: { ...computed.inputs, thicknessNm: computed.res.thickness_nm, n: computed.res.thickness_axis.length },
    status: `added FFT-thickness spectrum (${computed.res.thickness_nm.toFixed(2)} nm)`,
    output: () => {
      const data: DataStruct = {
        time: computed.res.thickness_axis,
        values: computed.res.fft_magnitude.map((v) => [v]),
        labels: ["FFT magnitude"],
        units: [""],
        metadata: { reduction: "fft-thickness", thickness_nm: computed.res.thickness_nm },
      };
      return { name: `${computed.sourceName} (FFT thickness)`, data };
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
    setComputed(null);
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
    stale,
    busy,
    error,
    compute,
    toLibrary,
    addDisabledReason: stale ? "Out of date: the settings or rows changed since this result. Compute again." : commit.disabledReason,
    clear,
  };
}
