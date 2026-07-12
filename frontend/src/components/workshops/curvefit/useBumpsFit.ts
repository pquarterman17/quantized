// Curve Fit workshop — optional bumps engine state hook (GOTO #10).
// Deliberately isolated from useCurveFit (a parallel workstream edits that
// file): owns the engine choice, the synchronous bumps fits, and the DREAM
// job lifecycle (submit -> GET-poll progress -> result / cancel) via
// lib/jobs. The MATLAB-parity engine stays the workshop's default Fit path;
// this hook only runs when a bumps engine is selected.

import { useRef, useState } from "react";

import { fitBumps, type BumpsEngine, type BumpsFitResult } from "../../../lib/fitbumps";
import { cancelJob, isJobSubmit, JobCancelledError, pollJob } from "../../../lib/jobs";
import { activeRowIndices, droppedRows, expandToFull } from "../../../lib/rowstate";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { selectedFitData } from "./fitSelection";

export type EngineChoice = "parity" | BumpsEngine;

// DREAM defaults: enough draws for a usable posterior without minutes-long
// runs; the job runner keeps the window responsive either way.
const DREAM_BUDGET = { samples: 10_000, burn: 100, pop: 10 };

export interface BumpsFitState {
  hasDataset: boolean;
  engine: EngineChoice;
  setEngine: (e: EngineChoice) => void;
  result: BumpsFitResult | null;
  busy: boolean;
  /** DREAM job fraction (0..1) while polling; null otherwise. */
  progress: number | null;
  error: string | null;
  run: (modelName: string) => Promise<void>;
  cancel: () => Promise<void>;
}

export function useBumpsFit(): BumpsFitState {
  const active = useActiveDataset();
  const [engine, setEngineState] = useState<EngineChoice>("parity");
  const [result, setResult] = useState<BumpsFitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef<string | null>(null);

  function setEngine(e: EngineChoice): void {
    setEngineState(e);
    setResult(null);
    setError(null);
  }

  async function run(modelName: string): Promise<void> {
    if (!active || engine === "parity" || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // Resolve past a lazy preview, then fit the analysis view (excluded/
      // filtered rows dropped) — same contract as the parity fit path.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      const state = useApp.getState();
      const d = selectedFitData(ds, state.xKey, state.yKeys, state.seriesOrder);
      if (!d) return;
      const resp = await fitBumps({
        model: modelName,
        x: d.x,
        y: d.y,
        engine,
        ...(engine === "dream" ? DREAM_BUDGET : {}),
      });
      let fit: BumpsFitResult;
      if (isJobSubmit(resp)) {
        jobRef.current = resp.job_id;
        setProgress(0);
        fit = await pollJob<BumpsFitResult>(resp.job_id, (f) => setProgress(f));
      } else {
        fit = resp;
      }
      setResult(fit);
      // Overlay the fitted curve, expanded back to full row count so it stays
      // in register with the full-length plot x (same as the parity path).
      if (Array.isArray(fit.yFit)) {
        const n = ds.data.time.length;
        const kept = activeRowIndices(n, droppedRows(ds));
        const y = kept.length === n ? fit.yFit : expandToFull(fit.yFit, kept, n);
        useApp.getState().setFitOverlay({ datasetId: ds.id, y });
      }
    } catch (e) {
      if (!(e instanceof JobCancelledError)) {
        setError(e instanceof Error ? e.message : "bumps fit failed");
      }
      // a deliberate cancel is not an error — just return to idle
    } finally {
      jobRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  }

  async function cancel(): Promise<void> {
    const id = jobRef.current;
    if (!id) return;
    try {
      await cancelJob(id);
    } catch {
      /* job already terminal — the poll loop settles it */
    }
  }

  return {
    hasDataset: active != null,
    engine,
    setEngine,
    result,
    busy,
    progress,
    error,
    run,
    cancel,
  };
}
