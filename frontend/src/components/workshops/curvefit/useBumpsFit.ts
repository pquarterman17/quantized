// Curve Fit workshop — optional bumps engine state hook (GOTO #10).
// Deliberately isolated from useCurveFit (a parallel workstream edits that
// file): owns the engine choice, the synchronous bumps fits, and the DREAM
// job lifecycle (submit -> GET-poll progress -> result / cancel) via
// lib/jobs. The MATLAB-parity engine stays the workshop's default Fit path;
// this hook only runs when a bumps engine is selected.
//
// Soak-test fix: the session (engine, DREAM settings, busy/progress, job id,
// result) lives in a MODULE-level store, not component state. Closing the
// Curve Fit window only hides it (store/curveFitSession.ts), so a DREAM job
// still running when the panel unmounts must be there to re-attach to when it
// reopens: the run loop keeps writing here after unmount, the reopened panel
// shows the engine, progress and Cancel, then the posterior table — and a
// second concurrent job cannot be started while the first is live.

import { create } from "zustand";

import { fitBumps, type BumpsEngine, type BumpsFitResult } from "../../../lib/fitbumps";
import { dropGapRows, restoreGapRows } from "../../../lib/api/finitePairs";
import { cancelJob, isJobSubmit, JobCancelledError, pollJob } from "../../../lib/jobs";
import { activeRowIndices, droppedRows, expandToFull } from "../../../lib/rowstate";
import { useApp } from "../../../store/useApp";
import { trackJob } from "../../../store/pendingOpActions";
import { toast } from "../../../store/toasts";
import { onWorkspaceReplace } from "../../../store/workspaceReplace";
import { selectedFitData, throwFitSelectionRefusal } from "../../../lib/fitselection";

export type EngineChoice = "parity" | BumpsEngine;

/** DREAM sampling budget — user-tunable (audit P1 #2: allow sampling controls).
 *  Defaults: enough draws for a usable posterior without minutes-long runs; the
 *  job runner keeps the window responsive either way. */
export interface DreamSettings {
  samples: number;
  burn: number;
  pop: number;
}
const DREAM_DEFAULTS: DreamSettings = { samples: 10_000, burn: 100, pop: 10 };

export interface BumpsFitState {
  hasDataset: boolean;
  engine: EngineChoice;
  setEngine: (e: EngineChoice) => void;
  dream: DreamSettings;
  setDream: (patch: Partial<DreamSettings>) => void;
  result: BumpsFitResult | null;
  busy: boolean;
  /** DREAM job fraction (0..1) while polling; null otherwise. */
  progress: number | null;
  error: string | null;
  run: (modelName: string) => Promise<void>;
  cancel: () => Promise<void>;
}

interface BumpsSession {
  engine: EngineChoice;
  dream: DreamSettings;
  result: BumpsFitResult | null;
  busy: boolean;
  progress: number | null;
  error: string | null;
  /** The live DREAM job, while one is being polled. */
  jobId: string | null;
  /** The dataset `result`/`error` (and a running job) belong to: the panel
   *  shows them only beside THAT dataset (review D1). */
  datasetId: string | null;
}

const INITIAL: BumpsSession = {
  engine: "parity",
  dream: DREAM_DEFAULTS,
  result: null,
  busy: false,
  progress: null,
  error: null,
  jobId: null,
  datasetId: null,
};

const useBumpsSession = create<BumpsSession>(() => INITIAL);

/** Bumped by every reset: a run that started before it is orphaned and
 *  writes nothing more into the session (or the plot). */
let generation = 0;

/** Back to a fresh session, cancelling a job still running. Called when the
 *  workspace is replaced (New / Open / Remove all), and by tests. */
export function resetBumpsFitSession(): void {
  const { jobId } = useBumpsSession.getState();
  generation += 1;
  useBumpsSession.setState(INITIAL, true);
  if (jobId) void cancelJob(jobId).catch(() => undefined);
}
onWorkspaceReplace(resetBumpsFitSession);

const patch = (p: Partial<BumpsSession>): void => useBumpsSession.setState(p);

function setEngine(engine: EngineChoice): void {
  // A run in flight keeps its engine: switching mid-run would orphan the job.
  if (useBumpsSession.getState().busy) return;
  patch({ engine, result: null, error: null });
}

function setDream(p: Partial<DreamSettings>): void {
  patch({ dream: { ...useBumpsSession.getState().dream, ...p } });
}

async function cancel(): Promise<void> {
  const id = useBumpsSession.getState().jobId;
  if (!id) return;
  try {
    await cancelJob(id);
  } catch {
    /* job already terminal — the poll loop settles it */
  }
}

async function run(modelName: string): Promise<void> {
  const { engine, busy, dream } = useBumpsSession.getState();
  const activeId = useApp.getState().activeId;
  if (!activeId || engine === "parity" || busy) return;
  const mine = generation;
  // Every write below is this run's only while no reset has happened since.
  const patchMine = (p: Partial<BumpsSession>): void => {
    if (generation === mine) patch(p);
  };
  patch({ busy: true, error: null, result: null, datasetId: activeId });
  // P3.4: the run is one op in the shared StatusBar location (percent +
  // Cancel once the DREAM job exists), not only this panel's own bar.
  const op = trackJob(engine === "dream" ? "Bumps DREAM fit" : `Bumps ${engine} fit`);
  try {
    // Resolve past a lazy preview, then fit the analysis view (excluded/
    // filtered rows dropped) — same contract as the parity fit path.
    const ds = await useApp.getState().resolveDataset(activeId);
    if (!ds) return;
    const state = useApp.getState();
    const d = selectedFitData(ds, state.xKey, state.yKeys, state.seriesOrder);
    if (!d) return throwFitSelectionRefusal(ds, state.xKey, state.yKeys, state.seriesOrder);
    const pairs = dropGapRows(d.x, d.y);
    if (pairs.x.length === 0) throw new Error("no finite X/Y pairs are available to fit");
    if (!pairs.complete) {
      toast(`${pairs.n - pairs.keep.length} of ${pairs.n} rows are gaps; they were excluded from the fit.`);
    }
    const resp = await fitBumps({
      model: modelName,
      x: pairs.x,
      y: pairs.y,
      engine,
      ...(engine === "dream" ? dream : {}),
    });
    let fit: BumpsFitResult;
    if (isJobSubmit(resp)) {
      patchMine({ jobId: resp.job_id, progress: 0 });
      op.cancellable(() => void cancel());
      fit = await pollJob<BumpsFitResult>(resp.job_id, (f) => {
        patchMine({ progress: f });
        op.progress(f);
      });
    } else {
      fit = resp;
    }
    if (generation !== mine) return; // the workspace it was for is gone
    patch({ result: fit });
    // Overlay the fitted curve, expanded back to full row count so it stays
    // in register with the full-length plot x (same as the parity path).
    if (Array.isArray(fit.yFit)) {
      const n = ds.data.time.length;
      const kept = activeRowIndices(n, droppedRows(ds));
      const aligned = restoreGapRows(fit.yFit, pairs);
      const y = kept.length === n ? aligned : expandToFull(aligned, kept, n);
      useApp.getState().setFitOverlay({ datasetId: ds.id, binding: { yKey: d.yKey, xKey: d.xKey }, y });
    }
  } catch (e) {
    if (!(e instanceof JobCancelledError)) {
      patchMine({ error: e instanceof Error ? e.message : "bumps fit failed" });
    }
    // a deliberate cancel is not an error — just return to idle
  } finally {
    op.end();
    patchMine({ jobId: null, busy: false, progress: null });
  }
}

export function useBumpsFit(): BumpsFitState {
  const hasDataset = useApp((s) => s.datasets.some((d) => d.id === s.activeId));
  const activeId = useApp((s) => s.activeId);
  const engine = useBumpsSession((s) => s.engine);
  const dream = useBumpsSession((s) => s.dream);
  // A result or error is shown only beside its own dataset. `busy` stays
  // global: a job is running either way, and a second one must not start.
  const mine = useBumpsSession((s) => s.datasetId === activeId);
  const result = useBumpsSession((s) => s.result);
  const busy = useBumpsSession((s) => s.busy);
  const progress = useBumpsSession((s) => s.progress);
  const error = useBumpsSession((s) => s.error);
  return { hasDataset, engine, setEngine, dream, setDream, result: mine ? result : null, busy, progress, error: mine ? error : null, run, cancel };
}
