// Peaks workshop — state hook. Auto-finds peaks in the active dataset's first
// channel via /api/peaks/find and pushes markers into the store as a plot
// overlay. Also exposes two fit actions over the detected peaks: fitTogether
// (simultaneous /api/peaks/fit-multi) and fitEach (independent /api/peaks/fit
// per peak). Re-runs find — and clears any fit — when the active dataset changes.

import { useCallback, useEffect, useState } from "react";

import { findPeaks, fitMultiPeak, fitPeak, type PeakSeed } from "../../../lib/api";
import { fullPlottedX, selectedFitData } from "../../../lib/fitselection";
import { peakOverlayArray } from "../../../lib/plotdata";
import { analysisData } from "../../../lib/rowstate";
import type { Dataset, FittedPeak, MultiFitResult, Peak } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

export interface PeakFitOptions {
  model: string;
  bgDegree: number;
  linkMode: string;
  constrain: boolean;
}

export interface PeaksState {
  active: Dataset | null;
  peaks: Peak[];
  busy: boolean;
  error: string | null;
  fitResult: MultiFitResult | null;
  fitting: boolean;
  fitError: string | null;
  fitTogether: (opts: PeakFitOptions) => Promise<void>;
  fitEach: (opts: PeakFitOptions) => Promise<void>;
}

/** The (x, y) the peak tools DETECT/FIT on — the PLOTTED X + primary Y over the
 *  analysis view (audit P1 #1), so peaks track what the user sees and excluded/
 *  filtered rows (#50/#53) don't produce or bias peaks. `fullX` is the same
 *  channel's FULL column, for aligning marker overlays to the full-length plot
 *  x. Falls back to the first channel when nothing is plotted. */
function peakInputs(
  ds: Dataset,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
): { x: number[]; y: number[]; fullX: number[] } {
  const fullX = fullPlottedX(ds.data, xKey);
  const sel = selectedFitData(ds, xKey, yKeys, seriesOrder);
  if (sel) return { x: sel.x, y: sel.y, fullX };
  const d = analysisData(ds) ?? ds.data;
  return { x: d.time, y: d.values.map((row) => row[0]), fullX };
}

function seedsFrom(peaks: Peak[]): PeakSeed[] {
  return peaks.map((p) => ({ center: p.center, fwhm: p.fwhm, height: p.height }));
}

export function usePeaks(): PeaksState {
  const active = useActiveDataset();
  const setPeakOverlay = useApp((s) => s.setPeakOverlay);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const [peaks, setPeaks] = useState<Peak[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fitResult, setFitResult] = useState<MultiFitResult | null>(null);
  const [fitting, setFitting] = useState(false);
  const [fitError, setFitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPeaks([]);
    setError(null);
    setFitResult(null); // a new dataset invalidates any prior fit
    setFitError(null);
    if (!active) {
      setPeakOverlay(null);
      return;
    }
    setBusy(true);
    const activeId = active.id;
    void (async () => {
      try {
        // #38 deferred edge: auto-find must never run on the small preview —
        // resolve the active dataset's full data first (no-op if it isn't
        // pending).
        const ds = await useApp.getState().resolveDataset(activeId);
        if (cancelled || !ds) return;
        const { x, y, fullX } = peakInputs(ds, xKey, yKeys, seriesOrder);
        const res = await findPeaks({ x, y });
        if (cancelled) return;
        setPeaks(res.peaks);
        // Overlay on the FULL plotted x (not the pruned x) so markers align with
        // the full-length plot; peak centers land on their nearest full-x point.
        setPeakOverlay({
          datasetId: ds.id,
          y: peakOverlayArray(fullX, res.peaks.map((p) => ({ center: p.center, height: p.height }))),
        });
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "peak find failed");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, setPeakOverlay, xKey, yKeys, seriesOrder]);

  // Draw fitted peak tops (height above the local background) as the overlay,
  // on the FULL plotted x so markers align with the full-length plot x.
  const overlayFitted = useCallback(
    (ds: Dataset, fitted: FittedPeak[], fullX: number[]) => {
      setPeakOverlay({
        datasetId: ds.id,
        y: peakOverlayArray(fullX, fitted.map((p) => ({ center: p.center, height: p.height + p.bg }))),
      });
    },
    [setPeakOverlay],
  );

  const fitTogether = useCallback(
    async (opts: PeakFitOptions) => {
      if (!active || peaks.length === 0) {
        setFitError("Find peaks before fitting.");
        return;
      }
      setFitting(true);
      setFitError(null);
      try {
        // #38 deferred edge: resolve the active dataset's full data before
        // fitting (a no-op if it isn't pending).
        const ds = await useApp.getState().resolveDataset(active.id);
        if (!ds) return;
        const st = useApp.getState();
        const { x, y, fullX } = peakInputs(ds, st.xKey, st.yKeys, st.seriesOrder);
        const res = await fitMultiPeak({
          x, y, peaks: seedsFrom(peaks), model: opts.model,
          bg_degree: opts.bgDegree, constrain: opts.constrain, link_mode: opts.linkMode,
        });
        setFitResult(res);
        overlayFitted(ds, res.peaks, fullX);
      } catch (e: unknown) {
        setFitError(e instanceof Error ? e.message : "simultaneous fit failed");
      } finally {
        setFitting(false);
      }
    },
    [active, peaks, overlayFitted],
  );

  const fitEach = useCallback(
    async (opts: PeakFitOptions) => {
      if (!active || peaks.length === 0) {
        setFitError("Find peaks before fitting.");
        return;
      }
      setFitting(true);
      setFitError(null);
      try {
        // #38 deferred edge: resolve the active dataset's full data before
        // fitting (a no-op if it isn't pending).
        const ds = await useApp.getState().resolveDataset(active.id);
        if (!ds) return;
        const st = useApp.getState();
        const { x, y, fullX } = peakInputs(ds, st.xKey, st.yKeys, st.seriesOrder);
        const fitted: FittedPeak[] = [];
        for (const p of peaks) {
          const half = (Number.isFinite(p.fwhm) && p.fwhm > 0 ? p.fwhm : 1) * 3;
          const r = await fitPeak({
            x, y, x_lo: p.center - half, x_hi: p.center + half,
            seed_center: p.center, seed_fwhm: p.fwhm, model: opts.model,
          });
          if (r.success) {
            fitted.push({
              center: r.center, fwhm: r.fwhm, height: r.height, bg: r.bg,
              eta: r.eta, area: r.area, status: "fitted", model: r.model,
            });
          }
        }
        const result: MultiFitResult = {
          peaks: fitted, bgCoeffs: [], R2: null, rmse: null,
          nPeaks: fitted.length, model: opts.model,
        };
        setFitResult(result);
        if (fitted.length > 0) overlayFitted(ds, fitted, fullX);
        if (fitted.length === 0) setFitError("No peaks could be fit individually.");
      } catch (e: unknown) {
        setFitError(e instanceof Error ? e.message : "per-peak fit failed");
      } finally {
        setFitting(false);
      }
    },
    [active, peaks, overlayFitted],
  );

  return { active, peaks, busy, error, fitResult, fitting, fitError, fitTogether, fitEach };
}
