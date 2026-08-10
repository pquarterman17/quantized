// RSM workshop — state hook. For a 2D reciprocal-space-map dataset (from the
// XRDML 2D parser: metadata.is2D + Qx/Qz columns) it finds peaks via
// /api/rsm/analyze, then computes strain + relaxation from the substrate/film
// pair via /api/rsm/strain. The math is golden vs MATLAB in calc.rsm_analyze /
// calc.rsm; this hook is orchestration only.
//
// RSM_CUTS_PLAN item 7 adds the peak-anchored radial/transverse cut actions
// here (not in Stage/useMapRuler.ts): the RSM panel already lists every
// fitted peak, so this is "reachable without hunting" (the plan's own
// wording) and needs none of the map's canvas/gesture machinery — a peak's
// Q-centre plus `lib/rsmPeakCut.ts`'s pure builders is enough to shape a
// `/api/rsm/box` request directly. `useCutLanding` is the SAME landing
// implementation the map cut tool and the ROI cuts workshop already share
// (its own header names this as its 4th intended caller) — one click lands
// one library dataset, no dependency on the map's inline commit bar.

import { useEffect, useState } from "react";

import { analyzeRsm, rsmBoxCut, rsmStrain, type BoxCutRequest } from "../../../lib/api/rsm";
import { rulerBoxBody } from "../../../lib/roi";
import { buildPeakRuler, defaultPeakForCut, peakHasQCentre, withPeakCutLabel, type PeakCutKind } from "../../../lib/rsmPeakCut";
import type { Dataset, RsmPeak, RsmStrainResponse } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { useCutLanding } from "../../Stage/useCutLanding";

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
  /** Peak-anchored radial/transverse cut (item 7): builds the ruler,
   *  shows it on the map (`store.mapRuler`), and lands the box_cut result
   *  through it in ONE call — the "1-2 clicks, peak already found" path.
   *  A no-op (with a status message) when `peak` has no finite Q centre. */
  radialCut: (peak: RsmPeak) => Promise<void>;
  transverseCut: (peak: RsmPeak) => Promise<void>;
  /** True while a peak-anchored cut is landing — separate from `busy`
   *  (analyze/strain) so the cut buttons don't spuriously grey out the
   *  Find-peaks/Compute-strain controls, or vice versa. */
  cutBusy: boolean;
  /** The default cut target (Resolved decisions: "film peak as default") —
   *  null until peaks exist. */
  defaultCutPeak: RsmPeak | null;
  /** Why the top-level Radial/Transverse actions are disabled, or null when
   *  they're enabled — never silently inert (repo rule): every disable
   *  reason RsmPanel needs to SHOW, computed here so it's hook-testable. */
  cutDisabledReason: string | null;
}

/** The peak-anchored actions' default target + why they'd be disabled right
 *  now, in one place — RsmPanel just renders `reason`/`peak`, it doesn't
 *  re-derive either. Exported standalone (mirrors `strainPair`) so this
 *  logic is testable without mounting the hook. */
export function cutTarget(isRsm: boolean, peaks: RsmPeak[] | null): { peak: RsmPeak | null; reason: string | null } {
  if (!isRsm) return { peak: null, reason: "Dataset has no Q columns" };
  if (!peaks || peaks.length === 0) return { peak: null, reason: "Find peaks first" };
  const peak = defaultPeakForCut(peaks);
  if (!peak || !peakHasQCentre(peak)) return { peak: null, reason: "No peak has a reciprocal-space centre" };
  return { peak, reason: null };
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
  const setMapRuler = useApp((s) => s.setMapRuler);
  const setMapRoi = useApp((s) => s.setMapRoi);
  const isRsm = isRsmDataset(active);
  const [nPeaks, setNPeaks] = useState(2);
  const [peaks, setPeaks] = useState<RsmPeak[] | null>(null);
  const [strain, setStrain] = useState<RsmStrainResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { busy: cutBusy, land } = useCutLanding();

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
      // #38 deferred edge: resolve the active dataset's full data first.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      const res = await analyzeRsm({ dataset: ds.data, n_peaks: nPeaks });
      setPeaks(res.peaks);
      setRsmPeaks(res.peaks.length ? { datasetId: ds.id, peaks: res.peaks } : null);
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

  async function peakCut(peak: RsmPeak, kind: PeakCutKind): Promise<void> {
    if (!active || !isRsm) return;
    // #38 deferred edge, same as analyze() above: resolve the full dataset
    // (peaks were fitted against it, but `active` may be a lazy stub).
    const ds = await useApp.getState().resolveDataset(active.id);
    if (!ds) return;
    const ruler = buildPeakRuler(ds.data, peak, kind);
    if (!ruler) {
      setError("Peak has no reciprocal-space centre.");
      return;
    }
    // Show the ruler on the map (item 7's overlay) — a visual record of
    // exactly what got cut, and mutually exclusive with any live box.
    setMapRuler(ruler);
    setMapRoi(null);
    const body = rulerBoxBody(ds.data, ruler, { collapse: "x" }) as unknown as BoxCutRequest;
    await land(rsmBoxCut(body).then((cut) => withPeakCutLabel(cut, peak, kind)));
  }

  const { peak: defaultCutPeak, reason: cutDisabledReason } = cutTarget(isRsm, peaks);

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
    radialCut: (peak) => peakCut(peak, "radial"),
    transverseCut: (peak) => peakCut(peak, "transverse"),
    cutBusy,
    defaultCutPeak,
    cutDisabledReason,
  };
}
