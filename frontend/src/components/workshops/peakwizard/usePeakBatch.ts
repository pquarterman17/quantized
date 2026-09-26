// Peak Analyzer batch — state hook (audit P2.4 slice 4): run a SAVED v2
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
import type { PeakRecipe } from "../../../lib/peakwizard";
import { nextDatasetId, useActiveDataset, useApp } from "../../../store/useApp";
import {
  applyPointBudget,
  BATCH_ITEM_DEADLINE_S,
  BATCH_MAX_DATASETS,
  BATCH_MAX_TOTAL_POINTS,
  BATCH_PREP_CONCURRENCY,
  batchChannels,
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

export type BatchPhase = "idle" | "preparing" | "fitting" | "cancelling" | "done" | "cancelled" | "failed";

export interface BatchRun {
  recipe: PeakRecipe;
  channels: BatchChannels;
  sources: { id: string; name: string }[];
  ranAt: string;
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
  phase: BatchPhase;
  done: number;
  total: number;
  message: string;
  error: string | null;
  results: BatchDatasetResult[] | null;
  /** What produced `results` (recipe as run, channels, sources, time). */
  ran: BatchRun | null;
  run: () => Promise<void>;
  cancel: () => void;
  /** Land the table in the library as a dataset; returns its id. */
  addAsTable: () => string | null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function usePeakBatch(recipes: readonly PeakRecipe[], initialRecipe: string, pollMs = 1000): PeakBatchState {
  const active = useActiveDataset();
  const datasets = useApp((s) => s.datasets);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const resolveDataset = useApp((s) => s.resolveDataset);
  const addDataset = useApp((s) => s.addDataset);

  const [chosen, setRecipeName] = useState(initialRecipe);
  // The chosen recipe while it is still saved, else the first saved one (a
  // recipe saved or deleted in the wizard after this view opened).
  const recipeName = recipes.some((r) => r.name === chosen) ? chosen : (recipes[0]?.name ?? "");
  const [pickedRaw, setPicked] = useState<string[]>(() => (active ? [active.id] : []));
  // A dataset deleted from the library since it was picked is not counted.
  const picked = useMemo(() => pickedRaw.filter((id) => datasets.some((d) => d.id === id)), [pickedRaw, datasets]);
  const [phase, setPhase] = useState<BatchPhase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0, message: "" });
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BatchDatasetResult[] | null>(null);
  const [ran, setRan] = useState<BatchRun | null>(null);
  const seq = useRef(0);
  const jobRef = useRef<string | null>(null);
  const phaseRef = useRef<BatchPhase>("idle");
  phaseRef.current = phase;

  const channels = useMemo(() => batchChannels(active, xKey, yKeys, seriesOrder), [active, xKey, yKeys, seriesOrder]);
  const recipe = recipes.find((r) => r.name === recipeName) ?? null;
  const busy = phase === "preparing" || phase === "fitting" || phase === "cancelling";
  const block = busy
    ? null
    : !recipe
      ? "save a recipe first (step 5 of the wizard), then pick it here"
      : recipeBatchBlock(recipe)
        ?? (!channels ? "select a dataset with a plotted Y column: the batch fits those columns, by name, in every dataset" : null)
        ?? (picked.length === 0 ? "pick at least one dataset" : null)
        ?? (picked.length > BATCH_MAX_DATASETS ? `at most ${BATCH_MAX_DATASETS} datasets per batch` : null);

  // Unmount: stop writing, and do not leave a job fitting for nobody.
  useEffect(() => () => {
    seq.current++;
    if (jobRef.current) void cancelBatchJob(jobRef.current).catch(() => undefined);
    jobRef.current = null;
  }, []);

  const run = async () => {
    if (block || busy || !recipe || !channels) return;
    const id = ++seq.current;
    const live = () => seq.current === id;
    const ids = picked;
    const names = new Map(datasets.map((d) => [d.id, d.name]));
    setPhase("preparing");
    setError(null);
    setResults(null);
    setRan(null);
    setProgress({ done: 0, total: ids.length, message: `preparing 0/${ids.length}` });

    const prepareOne = async (dsId: string): Promise<PreparedItem> => {
      try {
        const ds = await resolveDataset(dsId);
        if (!ds) return { ok: false, error: "the dataset is no longer available" };
        return await prepareBatchItem(ds, recipe, channels);
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
    const runInfo: BatchRun = {
      recipe, channels, sources: ids.map((i) => ({ id: i, name: names.get(i) ?? i })), ranAt: new Date().toISOString(),
    };
    const finish = (job: Parameters<typeof mergeBatch>[1], note: string, next: BatchPhase = "done") => {
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
    try {
      for (;;) {
        const snap = await batchJobStatus(jobId);
        if (!live()) return;
        setProgress({ done: Math.round(snap.progress * items.length), total: items.length, message: snap.message });
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
  };

  const cancel = () => {
    if (phaseRef.current === "preparing") {
      seq.current++;
      // The job may have been queued in the same tick (the phase has not
      // re-rendered to "fitting" yet): the stopped loop will never poll it.
      if (jobRef.current) void cancelBatchJob(jobRef.current).catch(() => undefined);
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

  const addAsTable = useCallback((): string | null => {
    if (!results || !ran) return null;
    const rows = batchTableRows(results);
    const data = batchDataStruct(rows, {
      recipeName: ran.recipe.name, recipe: ran.recipe, sources: ran.sources, ranAt: ran.ranAt,
    });
    const id = nextDatasetId();
    const n = ran.sources.length;
    addDataset({ id, name: `Peak batch — ${ran.recipe.name} (${n} dataset${n === 1 ? "" : "s"})`, data });
    return id;
  }, [results, ran, addDataset]);

  return {
    recipeName,
    setRecipeName,
    picked,
    togglePicked: (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])),
    setPicked,
    channels,
    block,
    phase,
    done: progress.done,
    total: progress.total,
    message: progress.message,
    error,
    results,
    ran,
    run,
    cancel,
    addAsTable,
  };
}
