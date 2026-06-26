// RSM workshop — state hook. For a 2D reciprocal-space-map dataset (from the
// XRDML 2D parser: metadata.is2D + Qx/Qz columns) it finds peaks via
// /api/rsm/analyze, then computes strain + relaxation from the substrate/film
// pair via /api/rsm/strain. The math is golden vs MATLAB in calc.rsm_analyze /
// calc.rsm; this hook is orchestration only.

import { useEffect, useState } from "react";

import { analyzeRsm, rsmStrain } from "../../../lib/api";
import type { Dataset, RsmPeak, RsmStrainResponse } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

export interface RsmState {
  active: Dataset | null;
  isRsm: boolean;
  nPeaks: number;
  peaks: RsmPeak[] | null;
  strain: RsmStrainResponse | null;
  busy: boolean;
  error: string | null;
  setNPeaks: (n: number) => void;
  analyze: () => Promise<void>;
  computeStrain: () => Promise<void>;
  clear: () => void;
}

/** A dataset is an RSM when the 2D parser flagged it and Q-space is present. */
export function isRsmDataset(ds: Dataset | null): boolean {
  if (!ds) return false;
  const is2d = ds.data.metadata?.["is2D"] === true;
  return is2d && ds.data.labels.includes("Qx") && ds.data.labels.includes("Qz");
}

/** Pull the substrate + film Q-centres from a peak list (by classification,
 *  falling back to the two brightest). Returns null if either lacks finite Q. */
export function strainPair(
  peaks: RsmPeak[],
): { sub: [number, number]; film: [number, number] } | null {
  const sub = peaks.find((p) => p.classification === "substrate") ?? peaks[0];
  const film = peaks.find((p) => p.classification === "film") ?? peaks[1];
  if (!sub || !film) return null;
  const finite2 = (q: [number | null, number | null]): q is [number, number] =>
    q[0] != null && q[1] != null && Number.isFinite(q[0]) && Number.isFinite(q[1]);
  if (!finite2(sub.centre_Q) || !finite2(film.centre_Q)) return null;
  return { sub: sub.centre_Q, film: film.centre_Q };
}

export function useRsm(): RsmState {
  const active = useActiveDataset();
  const setRsmPeaks = useApp((s) => s.setRsmPeaks);
  const isRsm = isRsmDataset(active);
  const [nPeaks, setNPeaks] = useState(2);
  const [peaks, setPeaks] = useState<RsmPeak[] | null>(null);
  const [strain, setStrain] = useState<RsmStrainResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new active dataset invalidates the current analysis.
  useEffect(() => {
    setPeaks(null);
    setStrain(null);
    setError(null);
  }, [active]);

  async function analyze(): Promise<void> {
    if (!active || !isRsm) return;
    setBusy(true);
    setError(null);
    setStrain(null);
    try {
      const res = await analyzeRsm({ dataset: active.data, n_peaks: nPeaks });
      setPeaks(res.peaks);
      setRsmPeaks(res.peaks.length ? { datasetId: active.id, peaks: res.peaks } : null);
      if (res.n_peaks_found === 0) setError("No peaks found above threshold.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "RSM analysis failed");
    } finally {
      setBusy(false);
    }
  }

  async function computeStrain(): Promise<void> {
    if (!peaks) return;
    const pair = strainPair(peaks);
    if (!pair) {
      setError("Need a substrate + film peak with finite Q-space centres.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setStrain(await rsmStrain({ q_sub: pair.sub, q_film: pair.film }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "strain calculation failed");
    } finally {
      setBusy(false);
    }
  }

  function clear(): void {
    setPeaks(null);
    setStrain(null);
    setError(null);
    setRsmPeaks(null);
  }

  return {
    active,
    isRsm,
    nPeaks,
    peaks,
    strain,
    busy,
    error,
    setNPeaks,
    analyze,
    computeStrain,
    clear,
  };
}
