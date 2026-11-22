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
//
// Out of date (lane WB4): the scan stays a button on the poll-model job (own
// Cancel / StatusBar op), so it stamps the ranking with the key it was LAUNCHED
// with (workbench/useRunStamp): the dataset's row / data identity, the plotted
// channels and the saved equations it scanned. A ranking whose key has moved on
// is listed but marked, and a row click no longer applies it.

import { useRef, useState, useSyncExternalStore } from "react";

import { type ScanEntry } from "../../../lib/api/curvefit";
import { dropGapRows } from "../../../lib/api/finitePairs";
import { candidateGuesses, customModelsRevision, loadCustomModels, subscribeCustomModels } from "../../../lib/fitmodels";
import { scanFitModelsJob } from "../../../lib/fitscan";
import { cancelJob, pollJob, JobCancelledError } from "../../../lib/jobs";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { trackJob } from "../../../store/pendingOpActions";
import { toast } from "../../../store/toasts";
import { fitSelectionRefusal, selectedFitData } from "../../../lib/fitselection";
import { datasetInputsToken } from "../workbench/inputsKey";
import { afterCommit } from "../workbench/afterCommit";
import { Refusal } from "../workbench/refusal";
import { useRunStamp } from "../workbench/useRunStamp";

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
  /** `error` is a refusal (nothing to scan), not a failed job. */
  refusal: boolean;
  /** `results` were scanned under data, channels or saved equations that have since changed. */
  stale: boolean;
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
  const [refusalText, setRefusalText] = useState<string | null>(null);
  const jobRef = useRef<string | null>(null);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  // The saved-equation library by revision (one storage read per write, not per render).
  const library = useSyncExternalStore(subscribeCustomModels, customModelsRevision);
  const stamp = useRunStamp(
    active ? JSON.stringify([datasetInputsToken(active), xKey, yKeys, seriesOrder, library]) : "",
  );

  async function scan(): Promise<void> {
    if (!active || busy) return;
    setBusy(true);
    setError(null);
    setRefusalText(null);
    setProgress(0);
    setProgressMessage(null);
    // P3.4: the scan is one op in the shared StatusBar location (percent +
    // Cancel once the job exists), not only this section's own bar.
    const op = trackJob("Fit model scan");
    try {
      // Resolve a still-pending dataset first (#38), then scan the plotted
      // X/primary-Y over the analysis view (#50/#53) — the same channels + rows
      // the plot shows and every Curve Fit path uses. Read the selection after
      // the await in case the plotted channels changed while a lazy Origin book
      // resolved.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      // A lazy book that just arrived moved the key: let that commit land first,
      // then take the key this scan is asked with (not what it ends up under).
      if (active.pending) await afterCommit();
      const launchKey = stamp.launchKey();
      const state = useApp.getState();
      const d = selectedFitData(ds, state.xKey, state.yKeys, state.seriesOrder);
      if (!d) {
        const why = fitSelectionRefusal(ds, state.xKey, state.yKeys, state.seriesOrder);
        if (why) throw new Refusal(why);
        return;
      }
      const pairs = dropGapRows(d.x, d.y);
      if (pairs.x.length === 0) throw new Refusal("no finite X/Y pairs are available to scan");
      if (!pairs.complete) {
        toast(`${pairs.n - pairs.keep.length} of ${pairs.n} rows are gaps; they were excluded from the scan.`);
      }
      const equations = loadCustomModels().map((m) => ({
        name: m.name,
        equation: m.equation,
        ...candidateGuesses(m),
      }));
      const { job_id } = await scanFitModelsJob({
        x: pairs.x,
        y: pairs.y,
        ...(equations.length > 0 ? { equations } : {}),
      });
      jobRef.current = job_id;
      op.cancellable(() => void cancel());
      const r = await pollJob<ScanJobResult>(job_id, (f, m) => {
        setProgress(f);
        setProgressMessage(m);
        op.progress(f, m);
      });
      stamp.record(launchKey);
      setResults(r.results);
    } catch (e) {
      if (e instanceof Refusal) setRefusalText(e.message);
      if (!(e instanceof JobCancelledError)) {
        setError(e instanceof Error ? e.message : "scan failed");
      }
      // a deliberate cancel is not an error — the prior results (if any) stay
    } finally {
      op.end();
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
    stamp.record(null);
    setError(null);
  }

  return {
    hasDataset: active != null,
    results,
    busy,
    progress,
    progressMessage,
    error,
    refusal: error !== null && error === refusalText,
    stale: results !== null && stamp.stale,
    scan,
    cancel,
    clear,
  };
}
