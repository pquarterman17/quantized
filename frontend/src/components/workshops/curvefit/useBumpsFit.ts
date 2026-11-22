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

import { useEffect } from "react";
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
import type { Dataset, FitOverlay } from "../../../lib/types";
import { afterCommit } from "../workbench/afterCommit";
import { datasetInputsToken } from "../workbench/inputsKey";
import { takeBackOverlay } from "./fitOverlayOwnership";

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
  /** `result` was fitted with a model, channels, rows / data or DREAM budget that have since changed. */
  stale: boolean;
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
  /** What `result` was LAUNCHED with (see `bumpsKey`), the model, and the curve it drew. */
  key: string | null;
  model: string | null;
  overlay: FitOverlay | null;
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
  key: null,
  model: null,
  overlay: null,
};

const useBumpsSession = create<BumpsSession>(() => INITIAL);

/** Every input a bumps result depends on: the model, the dataset's rows / data,
 *  the plotted channels and, for DREAM only, the sampling budget. */
export function bumpsKey(
  model: string, ds: Dataset | undefined, xKey: number | null, yKeys: readonly number[] | null,
  seriesOrder: readonly number[] | null, engine: EngineChoice, dream: DreamSettings,
): string {
  return JSON.stringify([model, datasetInputsToken(ds), xKey, yKeys, seriesOrder, engine, engine === "dream" ? dream : null]);
}

/** Bumped by every reset: a run that started before it is orphaned and
 *  writes nothing more into the session (or the plot). */
let generation = 0;

/** Back to a fresh session, cancelling a job still running. Called when the
 *  workspace is replaced (New / Open / Remove all), and by tests. */
export function resetBumpsFitSession(): void {
  const { jobId } = useBumpsSession.getState();
  generation += 1;
  useBumpsSession.setState(INITIAL, true);
  if (jobId) void cancelById(jobId);
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

async function cancelById(id: string): Promise<void> {
  try {
    await cancelJob(id);
  } catch {
    /* job already terminal — the poll loop settles it */
  }
}

async function cancel(): Promise<void> {
  const id = useBumpsSession.getState().jobId;
  if (id) await cancelById(id);
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
    const hadPending = useApp.getState().datasets.find((x) => x.id === activeId)?.pending !== undefined;
    const ds = await useApp.getState().resolveDataset(activeId);
    if (!ds) return;
    // A lazy book that just arrived moved the data identity: let that commit
    // land, then stamp the run with the key it is launched under.
    if (hadPending) await afterCommit();
    const state = useApp.getState();
    const launchKey = bumpsKey(modelName, state.datasets.find((x) => x.id === activeId), state.xKey, state.yKeys, state.seriesOrder, engine, dream);
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
      const jobId = resp.job_id;
      // Review N6: a reset while the submit was in flight could not cancel a
      // job it had no id for — cancel it now, by the id the submit returned.
      if (generation !== mine) return void cancelById(jobId);
      patchMine({ jobId, progress: 0 });
      // The op cancels by this job's own id, not whatever the session holds.
      op.cancellable(() => void cancelById(jobId));
      fit = await pollJob<BumpsFitResult>(resp.job_id, (f) => {
        patchMine({ progress: f });
        op.progress(f);
      });
    } else {
      fit = resp;
    }
    if (generation !== mine) return; // the workspace it was for is gone
    patch({ result: fit, key: launchKey, model: modelName });
    // Overlay the fitted curve, expanded back to full row count so it stays
    // in register with the full-length plot x (same as the parity path).
    if (Array.isArray(fit.yFit)) {
      const n = ds.data.time.length;
      const kept = activeRowIndices(n, droppedRows(ds));
      const aligned = restoreGapRows(fit.yFit, pairs);
      const y = kept.length === n ? aligned : expandToFull(aligned, kept, n);
      const overlay: FitOverlay = { datasetId: ds.id, binding: { yKey: d.yKey, xKey: d.xKey }, y, curveFit: true };
      patch({ overlay });
      useApp.getState().setFitOverlay(overlay);
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

export function useBumpsFit(modelName?: string): BumpsFitState {
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
  const stamped = useBumpsSession((s) => s.key);
  const ranModel = useBumpsSession((s) => s.model);
  const overlay = useBumpsSession((s) => s.overlay);
  const liveKey = useApp((s) => bumpsKey(modelName ?? ranModel ?? "", s.datasets.find((x) => x.id === activeId), s.xKey, s.yKeys, s.seriesOrder, engine, dream));
  const stale = mine && result !== null && stamped !== null && stamped !== liveKey && !busy;
  // An out-of-date fit's curve is taken off the plot (only if it is still ours).
  useEffect(() => {
    if (stale) takeBackOverlay(overlay);
  }, [stale, overlay]);
  return { hasDataset, engine, setEngine, dream, setDream, result: mine ? result : null, stale, busy, progress, error: mine ? error : null, run, cancel };
}
