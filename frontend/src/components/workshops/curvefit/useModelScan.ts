// AICc model quick-scan (GOTO #6) — state hook for ModelScanSection. Owns the
// scan call: posts the plotted X / primary-Y over the active dataset's
// ANALYSIS rows (#50/#53, via the shared selectedFitData bridge — the same
// channels + rows every Curve Fit path uses) to the job-queued
// /api/fitting/scan/job (P0.4 feedback/cancel audit tail — generalizing the
// DREAM job pattern, see useBumpsFit.ts), letting the backend pick the
// default registry candidate set (param count < n/3) and adding every saved
// custom equation model (lib/fitmodels) as an extra candidate. The hook lives
// in CurveFitPanel (not the section view) so ranked results survive the
// registry-mode <-> custom-mode flip a row-click apply can trigger.

import { useRef, useState } from "react";

import { type ScanEntry } from "../../../lib/api/curvefit";
import { loadCustomModels } from "../../../lib/fitmodels";
import { scanFitModelsJob } from "../../../lib/fitscan";
import { cancelJob, pollJob, JobCancelledError } from "../../../lib/jobs";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { selectedFitData } from "../../../lib/fitselection";

/** The completed job's result payload — same shape as the synchronous
 *  POST /api/fitting/scan (lib/api.ts's ScanResponse). */
interface ScanJobResult {
  results: ScanEntry[];
}

export interface ModelScanState {
  hasDataset: boolean;
  /** Ranked entries (successes ascending by AICc, failures last), or null
   *  before the first scan / after clear. */
  results: ScanEntry[] | null;
  busy: boolean;
  /** Scan job fraction (0..1) while polling; null otherwise. */
  progress: number | null;
  /** "Scanning i/n: name" while polling; null otherwise. */
  progressMessage: string | null;
  error: string | null;
  scan: () => Promise<void>;
  cancel: () => Promise<void>;
  clear: () => void;
}

export function useModelScan(): ModelScanState {
  const active = useActiveDataset();
  const [results, setResults] = useState<ScanEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef<string | null>(null);

  async function scan(): Promise<void> {
    if (!active || busy) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    setProgressMessage(null);
    try {
      // Resolve a still-pending dataset first (#38), then scan the plotted
      // X/primary-Y over the analysis view (#50/#53) — the same channels + rows
      // the plot shows and every Curve Fit path uses. Read the selection after
      // the await in case the plotted channels changed while a lazy Origin book
      // resolved.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      const state = useApp.getState();
      const d = selectedFitData(ds, state.xKey, state.yKeys, state.seriesOrder);
      if (!d) return;
      const equations = loadCustomModels().map((m) => ({
        name: m.name,
        equation: m.equation,
        guesses: m.guesses,
      }));
      const { job_id } = await scanFitModelsJob({
        x: d.x,
        y: d.y,
        ...(equations.length > 0 ? { equations } : {}),
      });
      jobRef.current = job_id;
      const r = await pollJob<ScanJobResult>(job_id, (f, m) => {
        setProgress(f);
        setProgressMessage(m);
      });
      setResults(r.results);
    } catch (e) {
      if (!(e instanceof JobCancelledError)) {
        setError(e instanceof Error ? e.message : "scan failed");
      }
      // a deliberate cancel is not an error — the prior results (if any) stay
    } finally {
      jobRef.current = null;
      setBusy(false);
      setProgress(null);
      setProgressMessage(null);
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

  function clear(): void {
    setResults(null);
    setError(null);
  }

  return {
    hasDataset: active != null,
    results,
    busy,
    progress,
    progressMessage,
    error,
    scan,
    cancel,
    clear,
  };
}
