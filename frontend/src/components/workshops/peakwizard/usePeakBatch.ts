// Peak analyzer batch — state hook (audit P2.4 slice 4): run a SAVED v2
// recipe over many datasets and collect the uncertainty / diagnostic table.
//
// LIFECYCLE. `run` prepares every picked dataset on the client
// (./peakBatchPrep — the wizard's own range / baseline / find / seeding, see
// that file for why the split sits there; BATCH_PREP_CONCURRENCY at a time,
// rows kept in the picked order; a dataset whose loading or preparation
// fails in ANY way is an error row, and preparation always ends), caps the
// total points at the route's limit (later datasets become "not run" rows
// saying so, never a 422 for the whole batch), then submits the prepared fits as
// ONE job (POST /api/peaks/model-fit-batch) and GET-polls it (~1 s) for
// "fitting k/N" until it is done, failed or cancelled. Progress is n/N in both
// phases. A dataset that cannot be prepared or fitted is an error row; the
// batch goes on (calc/peak_model_batch.py isolates each fit).
//
// CANCEL. While preparing: immediate (nothing is on the server yet). While
// fitting: POST /api/jobs/{id}/cancel and keep polling — the job stops at
// its next model evaluation and reports "cancelled", which is what the phase
// then says (and if the job finished first, its rows are kept and the view
// says so). Unmount cancels a running job and writes nothing more.
//
// SEQUENCING. Every run, cancel-while-preparing and unmount bumps `seq`; an
// async step whose id is no longer current writes nothing (the useModelFit
// pattern), so a superseded run can never overwrite a newer one.
//
// Store access by selector only (architecture.test.ts's getState ratchet).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  batchJobResult,
  batchJobStatus,
  cancelBatchJob,
  submitPeakBatch,
  type PeakBatchItem,
} from "../../../lib/api/peakBatch";
import { summaryX, summaryXNote, type SummaryXChoice } from "../../../lib/batchSummaryX";
import type { PeakRecipe } from "../../../lib/peakwizard";
import { trackJob, type TrackedJob } from "../../../store/pendingOpActions";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { useLatestRef } from "../../../lib/previewKey";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { datasetsInputsToken } from "../workbench/inputsKey";
import { commitBatchTable } from "../../../store/commitBatchTable";
import { useReopenSeed } from "../resultcommit/useReopenSession";
import { useReplaceLayoutBlock } from "../resultcommit/useReplaceLayoutBlock";
import {
  applyPointBudget,
  BATCH_ITEM_DEADLINE_S,
  BATCH_MAX_DATASETS,
  BATCH_MAX_TOTAL_POINTS,
  BATCH_PREP_CONCURRENCY,
  batchChannels,
  batchErrKeys,
  batchTotalDeadline,
  mapPool,
  prepareBatchItem,
  recipeBatchBlock,
  type BatchChannels,
  type PreparedItem,
} from "./peakBatchPrep";
import {
  batchDataStruct,
  batchTableRows,
  mergeBatch,
  type BatchDatasetResult,
  type PrepOutcome,
} from "./peakBatchRows";

const PEAK_BATCH_PRODUCER = { id: "peak-batch", label: "Peak batch", version: 1 } as const;

/** A short content hash of a recipe, recorded beside a committed table so a
 *  reopen can say the saved recipe of that name has changed since (lane RO2). */
export function recipeDigest(recipe: PeakRecipe): string {
  const text = JSON.stringify(recipe);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

export type BatchPhase = "idle" | "preparing" | "fitting" | "cancelling" | "done" | "cancelled" | "failed";

export interface BatchRun {
  recipe: PeakRecipe;
  channels: BatchChannels;
  sources: { id: string; name: string }[];
  /** Each read dataset's analysis-view fingerprint at run time (the commit's staleness basis). */
  fps: Record<string, string>;
  ranAt: string;
  /** The row / data identity of the fitted datasets when the run ended (the "Out of date" basis). */
  data: string;
  /** A fitted dataset changed (or was gone) before the run ended. */
  changed: boolean;
}

export interface PeakBatchState {
  recipeName: string;
  setRecipeName: (name: string) => void;
  picked: string[];
  togglePicked: (id: string) => void;
  setPicked: (ids: string[]) => void;
  channels: BatchChannels | null;
  /** Why Run is disabled right now, or null. */
  block: string | null;
  /** Opened from a committed table: the recorded recipe is gone or has changed since (else null). */
  recipeNote: string | null;
  phase: BatchPhase;
  done: number;
  total: number;
  message: string;
  error: string | null;
  results: BatchDatasetResult[] | null;
  /** What produced `results` (recipe as run, channels, sources, time). */
  ran: BatchRun | null;
  /** `results` were fitted on datasets that have since changed: export and Add as table are withheld. */
  stale: boolean;
  run: () => Promise<void>;
  cancel: () => void;
  /** Land the table in the library as a dataset; returns its id. `x` puts a
   *  physical parameter of each row's dataset on X (default: the row number). */
  addAsTable: (x?: SummaryXChoice) => { id: string; replaced: boolean } | null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function usePeakBatch(recipes: readonly PeakRecipe[], initialRecipe: string, pollMs = 1000): PeakBatchState {
  const active = useActiveDataset();
  const datasets = useApp((s) => s.datasets);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const errKeys = useApp((s) => s.errKeys);
  const resolveDataset = useApp((s) => s.resolveDataset);
  const setStatus = useApp((s) => s.setStatus);

  // Opened from a committed table (lane RO2): its recipe and every source it fitted.
  const seed = useReopenSeed(PEAK_BATCH_PRODUCER.id, active?.id);
  const seedRecipe = typeof seed?.settings["recipe"] === "string" ? seed.settings["recipe"] : null;
  const [chosen, setRecipeName] = useState(seedRecipe ?? initialRecipe);
  // The chosen recipe while it is still saved, else the first saved one (a
  // recipe saved or deleted in the wizard after this view opened). A reopened
  // table's recipe that is no longer saved is NOT swapped for another one.
  const recipeName = recipes.some((r) => r.name === chosen) ? chosen : (seedRecipe !== null && chosen === seedRecipe ? "" : (recipes[0]?.name ?? ""));
  const [pickedRaw, setPicked] = useState<string[]>(() => (seed ? [...seed.sourceIds] : active ? [active.id] : []));
  // A dataset deleted from the library since it was picked is not counted.
  const picked = useMemo(() => pickedRaw.filter((id) => datasets.some((d) => d.id === id)), [pickedRaw, datasets]);
  const [phase, setPhase] = useState<BatchPhase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0, message: "" });
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BatchDatasetResult[] | null>(null);
  const [ran, setRan] = useState<BatchRun | null>(null);
  const seq = useRef(0);
  // The library as of the latest render, for the stamp taken when a run ends.
  const latestDatasets = useLatestRef(datasets);
  const jobRef = useRef<string | null>(null);
  const opRef = useRef<TrackedJob | null>(null);
  const phaseRef = useRef<BatchPhase>("idle");
  phaseRef.current = phase;

  const channels = useMemo(() => batchChannels(active, xKey, yKeys, seriesOrder), [active, xKey, yKeys, seriesOrder]);
  const recipe = recipes.find((r) => r.name === recipeName) ?? null;
  const busy = phase === "preparing" || phase === "fitting" || phase === "cancelling";
  const recipeDigestNow = recipe ? recipeDigest(recipe) : null;
  const recordedDigest = typeof seed?.extra?.["recipeDigest"] === "string" ? seed.extra["recipeDigest"] : null;
  const recipeNote = !seedRecipe ? null
    : !recipes.some((r) => r.name === seedRecipe) ? `The recipe “${seedRecipe}” of this table is not saved any more: pick a saved recipe, or save it again in step 5 of the wizard.`
    : recipeName === seedRecipe && recordedDigest !== null && recordedDigest !== recipeDigestNow
      && !(ran && recipeDigest(ran.recipe) === recipeDigestNow)
      ? `The saved recipe “${seedRecipe}” changed after this table was computed; Run again to see what it gives now.`
    : null;
  const block = busy
    ? null
    : !recipe
      ? (seedRecipe !== null && recipeName === "" && recipes.length > 0
        ? `pick a saved recipe: “${seedRecipe}” is not saved any more`
        : "save a recipe first (step 5 of the wizard), then pick it here")
      : recipeBatchBlock(recipe)
        ?? (!channels ? "select a dataset with a plotted Y column: the batch fits those columns, by name, in every dataset" : null)
        ?? (picked.length === 0 ? "pick at least one dataset" : null)
        ?? (picked.length > BATCH_MAX_DATASETS ? `at most ${BATCH_MAX_DATASETS} datasets per batch` : null);

  // A finished table belongs to the recipe AND the channels it ran with. When
  // the chosen recipe changes (switched, or re-saved with other settings), or
  // the plotted X / Y column becomes another one, the old rows must not sit
  // under the new setting: drop them. A run in flight finishes with what it
  // started with, then is dropped the same way (this effect re-runs when the
  // phase turns terminal). NOT a reset: picking other datasets, or the active
  // worksheet moving to this batch's OWN table (adding it activates the new
  // worksheet, whose columns are the table's, not a channel change). The
  // channel test is by name, so another worksheet plotting the same columns
  // keeps the table.
  const settingsKey = JSON.stringify(recipe);
  const ranKey = useRef<string | null>(null);
  const ownTables = useRef<Set<string>>(new Set());
  const terminal = phase === "done" || phase === "cancelled" || phase === "failed";
  const nowX = channels?.xLabel ?? null;
  const nowY = channels?.yLabel ?? null;
  const onOwnTable = active ? ownTables.current.has(active.id) : false;
  // No explicit plotted Y (an undo / history restore clears xKey and yKeys, and
  // the view then falls back to the first column): the fallback is not a column
  // the user chose, so it is never a channel change.
  const explicitPlot = !!yKeys && yKeys.length > 0;
  useEffect(() => {
    if (!terminal || ranKey.current === null) return;
    const recipeChanged = ranKey.current !== settingsKey;
    const channelChanged = !!ran && explicitPlot && nowY !== null && !onOwnTable && (ran.channels.yLabel !== nowY || ran.channels.xLabel !== nowX);
    if (!recipeChanged && !channelChanged) return;
    ranKey.current = null;
    setResults(null);
    setRan(null);
    setError(null);
    setProgress({ done: 0, total: 0, message: "" });
    setPhase("idle");
  }, [terminal, settingsKey, ran, nowX, nowY, onOwnTable, explicitPlot]);

  // Unmount: stop writing, and do not leave a job fitting for nobody.
  useEffect(() => () => {
    seq.current++;
    if (jobRef.current) void cancelBatchJob(jobRef.current).catch(() => undefined);
    jobRef.current = null;
    opRef.current?.end();
  }, []);

  const run = async () => {
    if (block || busy || !recipe || !channels) return;
    // P3.4: the whole run (preparing + fitting) is ONE op in the shared
    // StatusBar location, with its n/N progress and this view's own Cancel.
    // Cancel-while-preparing and unmount end it at once (opRef) rather than
    // when the superseded run's in-flight preparation happens to settle.
    const op = trackJob("Peak batch");
    opRef.current = op;
    op.cancellable(() => cancel());
    try {
      const id = ++seq.current;
      const live = () => seq.current === id;
      ranKey.current = settingsKey;
      const ids = picked;
      const names = new Map(datasets.map((d) => [d.id, d.name]));
      setPhase("preparing");
      setError(null);
      setResults(null);
      setRan(null);
      setProgress({ done: 0, total: ids.length, message: `preparing 0/${ids.length}` });
      op.progress(0, `preparing 0/${ids.length}`);

      const fps: Record<string, string> = {};
      const prepareOne = async (dsId: string): Promise<PreparedItem> => {
        try {
          const ds = await resolveDataset(dsId);
          if (!ds) return { ok: false, error: "the dataset is no longer available" };
          fps[dsId] = analysisDataFingerprint(ds);
          // Each dataset is weighted by its OWN error column (./peakBatchPrep batchErrKeys).
          return await prepareBatchItem(ds, recipe, channels, batchErrKeys(ds, active?.id ?? null, errKeys));
        } catch (e) {
          return { ok: false, error: `could not load the dataset: ${e instanceof Error ? e.message : "unknown error"}` };
        }
      };
      let prepared: PreparedItem[];
      try {
        let done = 0;
        const out = await mapPool(ids, BATCH_PREP_CONCURRENCY, async (dsId) => {
          const prep = await prepareOne(dsId);
          if (live()) {
            done += 1;
            setProgress({ done, total: ids.length, message: `preparing ${done}/${ids.length}` });
            op.progress(done / ids.length, `preparing ${done}/${ids.length}`);
          }
          return prep;
        }, () => !live());
        if (!live()) return;
        prepared = applyPointBudget(
          out.map((p): PreparedItem => p ?? { ok: false, error: "not prepared" }),
          BATCH_MAX_TOTAL_POINTS,
        );
      } catch (e) {
        // Nothing above should throw; if something does, never stay "preparing".
        if (!live()) return;
        setError(e instanceof Error ? e.message : "the datasets could not be prepared");
        setPhase("failed");
        return;
      }
      const preps: PrepOutcome[] = [];
      const items: PeakBatchItem[] = [];
      prepared.forEach((prep, k) => {
        const dsId = ids[k];
        const name = names.get(dsId) ?? dsId;
        if (prep.ok) {
          const itemId = `i${k}`;
          items.push({ id: itemId, ...prep.item });
          preps.push({ datasetId: dsId, name, ok: true, itemId, notes: prep.notes });
        } else {
          preps.push({ datasetId: dsId, name, ok: false, error: prep.error, ...(prep.notRun ? { notRun: true as const } : {}) });
        }
      });
      const finish = (job: Parameters<typeof mergeBatch>[1], note: string, next: BatchPhase = "done") => {
        // Stamp the fitted datasets as they are NOW: one that changed while the
        // job ran (its fingerprint no longer the one it was read with) leaves
        // the table out of date from the start.
        const now = latestDatasets.current;
        const fitted = ids.filter((i) => i in fps);
        const changed = fitted.some((i) => {
          const d = now.find((x) => x.id === i);
          return !d || !!d.pending || analysisDataFingerprint(d) !== fps[i];
        });
        const runInfo: BatchRun = {
          recipe, channels, sources: ids.map((i) => ({ id: i, name: names.get(i) ?? i })), fps, ranAt: new Date().toISOString(),
          data: datasetsInputsToken(fitted, now), changed,
        };
        setResults(mergeBatch(preps, job));
        setRan(runInfo);
        setProgress((p) => ({ ...p, message: note }));
        setPhase(next);
      };
      if (items.length === 0) {
        finish(null, "no dataset could be prepared — every row says why");
        return;
      }

      let jobId: string;
      try {
        // Budget scaled to the item count (./peakBatchPrep batchTotalDeadline);
        // Cancel, or closing the analyzer, ends it sooner.
        jobId = (await submitPeakBatch({
          items, item_deadline_s: BATCH_ITEM_DEADLINE_S, total_deadline_s: batchTotalDeadline(items.length),
        })).job_id;
      } catch (e) {
        if (!live()) return;
        setError(e instanceof Error ? e.message : "the batch could not be queued");
        setPhase("failed");
        return;
      }
      if (!live()) {
        void cancelBatchJob(jobId).catch(() => undefined);
        return;
      }
      jobRef.current = jobId;
      phaseRef.current = "fitting"; // a Cancel before the re-render goes to the job
      setPhase("fitting");
      setProgress({ done: 0, total: items.length, message: `fitting 0/${items.length}` });
      op.progress(0, `fitting 0/${items.length}`);
      try {
        for (;;) {
          const snap = await batchJobStatus(jobId);
          if (!live()) return;
          setProgress({ done: Math.round(snap.progress * items.length), total: items.length, message: snap.message });
          op.progress(snap.progress, snap.message);
          if (snap.status === "done") {
            const res = await batchJobResult(jobId);
            if (!live()) return;
            // Read through the ref: a Cancel may have landed during the awaits.
            const late = (phaseRef.current as BatchPhase) === "cancelling";
            finish(res, late
              ? "the batch finished before the cancel reached it — its results are shown"
              : res.stopped === "deadline"
                ? res.n_not_run > 0
                  ? "the batch reached its time limit — the rest were not fitted"
                  : "the batch reached its time limit — the last fit was cut short (see its warnings)"
                : `fitted ${res.n_ok}/${ids.length} datasets`);
            return;
          }
          if (snap.status === "error") throw new Error(snap.error || "the batch job failed");
          if (snap.status === "cancelled") {
            setPhase("cancelled");
            setProgress((p) => ({ ...p, message: "cancelled — no results were kept" }));
            return;
          }
          await sleep(pollMs);
          if (!live()) return;
        }
      } catch (e) {
        if (!live()) return;
        // Polling broke (or the job failed): never leave it fitting for nobody.
        void cancelBatchJob(jobId).catch(() => undefined);
        setError(e instanceof Error ? e.message : "the batch job failed");
        setPhase("failed");
      } finally {
        if (live()) jobRef.current = null;
      }
  
    } finally {
      op.end();
    }
  };

  const cancel = () => {
    if (phaseRef.current === "preparing") {
      seq.current++;
      // The job may have been queued in the same tick (the phase has not
      // re-rendered to "fitting" yet): the stopped loop will never poll it.
      if (jobRef.current) void cancelBatchJob(jobRef.current).catch(() => undefined);
      opRef.current?.end();
      setPhase("cancelled");
      setProgress((p) => ({ ...p, message: "cancelled — no results were kept" }));
      return;
    }
    if (phaseRef.current !== "fitting" || !jobRef.current) return;
    setPhase("cancelling");
    phaseRef.current = "cancelling";
    setProgress((p) => ({ ...p, message: "cancelling…" }));
    void cancelBatchJob(jobRef.current).catch(() => undefined);
  };

  const stale = results !== null && ran !== null && !busy &&
    (ran.changed || ran.data !== datasetsInputsToken(Object.keys(ran.fps), datasets));

  // Replace's column check (lane RPL) runs before the button, on the table it would write.
  const primaryId = ran?.sources.find((s) => s.id in ran.fps)?.id;
  const tableLabels = useMemo(() => (results && ran && !stale
    ? batchDataStruct(batchTableRows(results), { recipeName: ran.recipe.name, recipe: ran.recipe, sources: ran.sources, ranAt: ran.ranAt }).labels
    : null), [results, ran, stale]);
  useReplaceLayoutBlock(PEAK_BATCH_PRODUCER.id, primaryId, tableLabels);

  const addAsTable = useCallback((choice?: SummaryXChoice): { id: string; replaced: boolean } | null => {
    if (!results || !ran || stale) return null;
    const rows = batchTableRows(results);
    const x = choice
      ? summaryX(rows.map((r) => {
        const d = datasets.find((e) => e.id === r.datasetId);
        return { name: r.dataset, metadata: d?.data.metadata, labels: d?.data.labels };
      }), choice)
      : undefined;
    const data = batchDataStruct(rows, {
      recipeName: ran.recipe.name, recipe: ran.recipe, sources: ran.sources, ranAt: ran.ranAt,
    }, x);
    const note = x ? summaryXNote(x) : "";
    if (note) setStatus(`batch table: ${note}`);
    const n = ran.sources.length;
    // One undo step, no duplicate on a repeat click, stale when ANY fitted
    // dataset changes (store/analysisOutputCommit.ts). A repeat Add (or a
    // refusal) says so in the status line and returns null.
    const outcome = commitBatchTable({
      producer: PEAK_BATCH_PRODUCER,
      sources: ran.sources.filter((s) => s.id in ran.fps).map((s) => ({ id: s.id, computedOn: ran.fps[s.id] })),
      settings: { recipe: ran.recipe.name, x: choice ?? null },
      reopenExtra: { channels: ran.channels, recipeDigest: recipeDigest(ran.recipe) },
      name: `Peak batch — ${ran.recipe.name} (${n} dataset${n === 1 ? "" : "s"})`,
      data,
      status: note ? `batch table: ${note}` : `added the peak batch table (${n} dataset${n === 1 ? "" : "s"})`,
    });
    if (outcome.kind !== "created" && outcome.kind !== "replaced") return null;
    ownTables.current.add(outcome.outputId);
    return { id: outcome.outputId, replaced: outcome.kind === "replaced" };
  }, [results, ran, stale, datasets, setStatus]);

  return {
    recipeName,
    setRecipeName,
    picked,
    togglePicked: (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])),
    setPicked,
    channels,
    block,
    recipeNote,
    phase,
    done: progress.done,
    total: progress.total,
    message: progress.message,
    error,
    results,
    ran,
    stale,
    run,
    cancel,
    addAsTable,
  };
}
