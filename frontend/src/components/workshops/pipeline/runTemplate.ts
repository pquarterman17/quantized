// Shared "run one analysis template against one LOADED dataset" core — the
// #3 file batch (useTemplates.runBatch) and the folder bulk ops (project-
// organization item 8) both drive it: execute the steps, extract the declared
// outputs into a BatchRow, and land a per-run #36 fit report when a fit ran.
// Module-level (not a hook); callers own the pipelineRunning flag and the
// summary worksheet.
//
// ── APPLY A SAVED TRANSFORMATION RECIPE (P2.5 box 4) ─────────────────────
// `applyRecipe` runs a template (a transformation recipe) on one or many
// loaded datasets, for the Pipeline workshop's ApplyRecipeSection.
//
// PER DATASET: preflight again at run time (lib/recipePreflight.ts — the
// workspace may have changed since the preview), refuse on any blocking issue,
// otherwise run the recipe's steps through the SAME `executeSteps` the
// pipeline and the template batch use, starting on:
//   - a WORKING COPY laid out like the recording input (`conformData`) when the
//     columns were rebound, or when a step would edit the dataset in place —
//     the source dataset is never edited;
//   - the dataset itself otherwise (its first step derives a new dataset).
// EVERY dataset the run actually derived (a split's children, not just the
// one later steps continue on) gets `metadata.transform_recipe`: the recipe's
// name and revision, the input, the column bindings, when. A run with a
// failed step, or one that derived nothing — including a step that never ran
// at all (disabled, or skipped because an earlier one was), which otherwise
// reports an untouched working copy as a successful output (finding #5) — is
// ROLLED BACK: exactly the datasets THIS run created (the working copy, plus
// `executeSteps`'s own `created` list — finding #3), never a before/after
// diff of the whole store, which would also delete a dataset an unrelated
// concurrent import created while this run's steps awaited the backend.
//
// ONE UNDO STEP PER APPLY, however many datasets and steps. The steps run
// through store actions that each record their own history entry and do not
// take a `withHistoryBatch` token, so `asOneUndoStep` collapses the entries
// the apply pushed into one, holding the state from before it. KNOWN
// LIMITATION: an unrelated edit made WHILE an apply is running (its steps
// await the backend) folds into the apply's entry, so undoing the apply also
// undoes that edit. Threading a `withHistoryBatch` token through every action
// executeSteps drives (formulas, corrections, transforms, split, metadata)
// would give that edit its own entry, but not stop undoing the batch from
// reverting it: the batch restores an absolute snapshot, and its own doc
// (store/history.ts) says any await after its last fold reopens exactly this
// hole — executeSteps awaits the backend between folds. So the much wider
// change would not make it safe. Recording is suppressed while it runs
// (`pipelineRunning`), exactly like a folder batch.

import { executeSteps, PipelineCancelledError } from "./executeSteps";
import { reportEmit } from "../../../lib/api";
import {
  conformData,
  conformErrorRoles,
  conformFilter,
  needsWorkingCopy,
  preflightRecipe,
  runnableSteps,
  type Binding,
} from "../../../lib/recipePreflight";
import { excludedSet } from "../../../lib/rowstate";
import { inputSegment } from "../../../lib/recipeExpect";
import { extractOutputs, type AnalysisTemplate, type BatchRow } from "../../../lib/template";
import { analyzePipeline } from "../../../lib/pipelineStudio";
import { snapshotOf } from "../../../store/historySnapshot";
import { removeDatasetsPatch } from "../../../store/removeDatasets";
import { addReportWithProvenance } from "../../../store/addReportWithProvenance";
import { nextDatasetId, useApp } from "../../../store/useApp";


/** Run template `t` against the loaded dataset `targetId`. Step failures are
 *  isolated (a flagged row, never a throw); the report emission is best-effort
 *  and can't turn a successful analysis into a failed one. */
export async function runTemplateOnDataset(
  t: AnalysisTemplate,
  targetId: string,
  displayName: string,
  signal?: AbortSignal,
): Promise<BatchRow> {
  signal?.throwIfAborted();
  const before = useApp.getState();
  const target = before.datasets.find((dataset) => dataset.id === targetId) ?? null;
  const preflight = analyzePipeline(t.steps, target, before.datasets);
  if (!preflight.canRun) {
    const failures = preflight.steps
      .filter((step) => step.state === "invalid")
      .map((step) => step.issue ?? "invalid step");
    return {
      file: displayName,
      values: extractOutputs(t.outputs, undefined),
      failed: failures.join("; ") || "template preflight failed",
    };
  }
  // A transform step (P2.5) moves the run onto its output, so the fit report
  // cites the dataset the fit actually ran on (`fitTargets`), not the input.
  const run = await executeSteps(t.steps, targetId, undefined, signal);
  const { fits, fitTargets, log } = run;
  if (signal?.aborted) throw new PipelineCancelledError(run.created);
  const failedSteps = Object.values(log).filter((l) => l.status === "failed");
  const lastFit = fits[fits.length - 1];
  const fitOn = fitTargets[fitTargets.length - 1] ?? targetId;
  const fitName = fitOn === targetId ? displayName : (useApp.getState().datasets.find((d) => d.id === fitOn)?.name ?? displayName);

  if (lastFit) {
    try {
      const nParams = ((lastFit.params as number[] | undefined) ?? []).length;
      const names = t.outputs.filter((o) => o !== "R2");
      const { report } = await reportEmit({
        kind: "curve_fit",
        result: lastFit as Record<string, unknown>,
        param_names:
          names.length === nParams
            ? names
            : Array.from({ length: nParams }, (_, k) => `p${k}`),
        title: `${t.name} — ${displayName}`,
        source_refs: [{ kind: "dataset", id: fitOn, name: fitName }],
      });
      if (signal?.aborted) throw new PipelineCancelledError(run.created);
      addReportWithProvenance(`${t.name} — ${displayName}`, report, fitOn);
    } catch {
      // Report generation is best-effort, but cancellation is control flow:
      // swallowing it here would let the batch continue to the next file.
      if (signal?.aborted) throw new PipelineCancelledError(run.created);
      /* offline / report route down — the extracted row still lands */
    }
  }

  return {
    file: displayName,
    values: extractOutputs(t.outputs, lastFit),
    ...(failedSteps.length
      ? { failed: failedSteps.map((l) => l.note ?? "step failed").join("; ") }
      : {}),
  };
}

export interface ApplyPlan {
  datasetId: string;
  bindings: Binding[];
}

export interface ApplyResult {
  datasetId: string;
  name: string;
  status: "ok" | "refused" | "failed";
  /** The derived output (status "ok"). */
  outputId?: string;
  outputName?: string;
  /** Every dataset the run created (status "ok"): a working copy and every
   *  step's output -- what a caller that must take the run back removes. */
  created?: string[];
  note: string;
}

/** Provenance stamped on a recipe's output (`metadata.transform_recipe`). */
export interface RecipeProvenance {
  recipe: string;
  revision: number;
  input: { id: string; name: string };
  /** Expected column → the input column bound to it, or null (blank). */
  bindings: { column: string; from: string | null }[];
  steps: number;
  appliedAt: string;
}

/** Run `fn` as ONE undo entry labelled `label` (module doc). Entries `fn`
 *  pushed are replaced by one holding the state from before it; nothing is
 *  pushed when `fn` pushed nothing.
 *
 *  Finding #2: the pre-apply top entry is found by its `seq` (store/
 *  history.ts), not by object identity. Identity breaks the moment anything
 *  rewrites that entry IN PLACE (in the same array slot) rather than
 *  replacing it — `endHistoryRun`/`undo` closing a coalescing run, or
 *  `scrubDatasetsFromHistory` pruning a permanently-deleted dataset out of
 *  every snapshot, both of which spread the original entry into a new
 *  object. An identity lookup then reads that rewritten entry as GONE, and
 *  used to fall through to the HISTORY_DEPTH-eviction branch even though
 *  nothing was actually evicted — wiping the whole stack down to this one
 *  apply's entry. `seq` survives every such spread untouched, so only a
 *  REAL eviction (the entry truly fell off the back at HISTORY_DEPTH) still
 *  takes that branch. */
export async function asOneUndoStep<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const h0 = useApp.getState().history;
  const lastSeq = h0[h0.length - 1]?.seq;
  const snapshot = snapshotOf(useApp.getState());
  try {
    return await fn();
  } finally {
    // `foldHistorySince` (store/history.ts) does the collapsing, keyed by
    // `seq` rather than the pre-apply entry's OBJECT — see that field's own
    // doc for why identity breaks the moment something rewrites the entry
    // in place (`closeRun`, `scrubDatasetsFromHistory`) instead of evicting
    // it (finding #2).
    useApp.getState().foldHistorySince(lastSeq, label, snapshot);
  }
}

/** Apply `recipe` to every plan's dataset, in order, as one undo step. */
export async function applyRecipe(
  recipe: AnalysisTemplate,
  plans: readonly ApplyPlan[],
  opts: { ackUnits: boolean },
): Promise<ApplyResult[]> {
  const s = useApp.getState;
  s().setPipelineRunning(true);
  try {
    return await asOneUndoStep(`apply recipe “${recipe.name}”`, async () => {
      const results: ApplyResult[] = [];
      for (const plan of plans) results.push(await applyOne(recipe, plan, opts.ackUnits));
      const ok = results.filter((r) => r.status === "ok").length;
      s().setStatus(`applied “${recipe.name}” to ${ok}/${results.length} dataset${results.length === 1 ? "" : "s"}`);
      return results;
    });
  } finally {
    s().setPipelineRunning(false);
  }
}

async function applyOne(recipe: AnalysisTemplate, plan: ApplyPlan, ackUnits: boolean): Promise<ApplyResult> {
  const s = useApp.getState;
  const listed = s().datasets.find((d) => d.id === plan.datasetId);
  const base = { datasetId: plan.datasetId, name: listed?.name ?? plan.datasetId };
  if (!listed) return { ...base, status: "refused", note: "no longer in the workspace" };
  let ds;
  try {
    ds = await s().resolveDataset(plan.datasetId);
  } catch (e) {
    return { ...base, status: "refused", note: `couldn't load full data — ${e instanceof Error ? e.message : "error"}` };
  }
  if (!ds || ds.pending) return { ...base, status: "refused", note: "its full data could not be loaded" };
  const pf = preflightRecipe(recipe, ds, plan.bindings, new Set(s().datasets.map((d) => d.id)), ackUnits);
  if (pf.blocked) {
    return { ...base, status: "refused", note: pf.issues.filter((i) => i.blocking).map((i) => i.text).join("; ") };
  }
  const columns = recipe.expects?.columns ?? [];
  const active = s().activeId;
  let start = ds.id;
  const renamesRecordedColumns = columns.some((column, index) => {
    const binding = plan.bindings[index];
    return typeof binding === "number" && ds.data.labels[binding] !== column.name;
  });
  const hasSignalTransform = inputSegment(recipe.steps).some((step) =>
    step.enabled && step.kind === "transform" && step.params.op === "signal");
  const conformed = needsWorkingCopy(recipe.steps, plan.bindings) || (hasSignalTransform && renamesRecordedColumns);
  if (conformed) {
    const c = conformData(ds.data, columns, plan.bindings, recipe.steps);
    const filter = conformFilter(ds.filter, c);
    const errorRoles = conformErrorRoles(ds.errorRoles, c);
    // Same rows, so the row exclusions carry over as they are.
    const excluded = [...excludedSet(ds)].sort((a, b) => a - b);
    start = nextDatasetId();
    s().addDataset({
      id: start,
      name: `${ds.name} (${recipe.name} input)`,
      data: { ...c.data, metadata: { ...c.data.metadata, recipe_working_copy: { recipe: recipe.name, of: { id: ds.id, name: ds.name } } } },
      ...(excluded.length ? { excludedRows: excluded } : {}),
      ...(filter ? { filter } : {}),
      ...(errorRoles ? { errorRoles } : {}),
    });
  }
  const run = await executeSteps(
    recipe.steps,
    start,
    undefined,
    undefined,
    conformed ? { allowPositionFallback: true } : undefined,
  );
  const failed = Object.values(run.log).filter((l) => l.status === "failed");
  const output = run.target;
  // Finding #3: exactly what THIS run created — the working copy (if one was
  // made) plus every dataset `executeSteps` reports (`run.created`, every
  // transform output, not just `output`) — never a before/after diff of the
  // whole store, which would also sweep up a dataset a concurrent import
  // created while this run's steps awaited the backend.
  const createdByRun = [...(start !== ds.id ? [start] : []), ...run.created];
  // Finding #5: "no step ran" is a failure too — a disabled step (or one
  // `blockedBy` an earlier disabled/failed transform) can leave `target`
  // sitting on the untouched working copy, which must not be reported as a
  // successful, provenanced output. `output === ds.id` alone doesn't catch
  // that: a working copy's id is never `ds.id`, so it stays wrongly outside
  // this check. Guarded by `ranSomething` so a LEGITIMATE in-place-only
  // recipe (e.g. one lone expression step, which never moves `target` off
  // the working copy either) is still reported as the success it is.
  const ranSomething = Object.values(run.log).some((l) => l.status === "ok" || l.status === "warn");
  if (failed.length || output === ds.id || (output === start && !ranSomething)) {
    // The bare removal patch, not the `removeDatasets` action: its trash
    // capture would keep the rollback's leftovers, and its permanent form
    // rewrites every history entry, which `asOneUndoStep` tells apart by
    // `seq` (finding #2), never identity — but this call predates either
    // entry anyway.
    if (createdByRun.length) useApp.setState((st) => removeDatasetsPatch(st, createdByRun));
    // An output made itself active; hand the view back to what it showed.
    if (active && active !== s().activeId && s().datasets.some((d) => d.id === active)) s().setActive(active);
    const why = failed.length ? failed.map((l) => l.note ?? "a step failed").join("; ") : "no step derived a dataset";
    return { ...base, status: "failed", note: `${why} — nothing kept` };
  }
  // Finding #7: every output of the run's FINAL step gets provenance, not
  // just `output` (`run.target`) — a split's children 2..N are just as much
  // that step's result as its first child, which is all `run.lastOutputs`
  // ever holds (finding #7's own fix in executeSteps.ts: replaced, never
  // accumulated, so an earlier step's now-superseded intermediate output in
  // a chain — e.g. a stack a later transpose consumed — is never stamped
  // alongside the dataset that actually is the run's result). When nothing
  // was derived (the in-place-only case, `output === start`), the working
  // copy itself is the sole result.
  const outputs = run.lastOutputs.length ? run.lastOutputs : [output];
  const prov: RecipeProvenance = {
    recipe: recipe.name,
    revision: recipe.revision ?? 1,
    input: { id: ds.id, name: ds.name },
    bindings: columns.map((c, i) => {
      const b = plan.bindings[i];
      return { column: c.name, from: typeof b === "number" ? (ds.data.labels[b] ?? null) : null };
    }),
    steps: runnableSteps(recipe.steps).length,
    appliedAt: new Date().toISOString(),
  };
  const stamp = new Set(outputs);
  useApp.setState((st) => ({
    datasets: st.datasets.map((d) =>
      stamp.has(d.id) ? { ...d, data: { ...d.data, metadata: { ...d.data.metadata, transform_recipe: prov } } } : d,
    ),
  }));
  const outNames = outputs.map((id) => s().datasets.find((d) => d.id === id)?.name ?? id);
  const outName = s().datasets.find((d) => d.id === output)?.name ?? output;
  const warned = Object.values(run.log).filter((l) => l.status === "warn").length;
  const created = outNames.map((n) => `“${n}”`).join(", ");
  return { ...base, status: "ok", outputId: output, outputName: outName, created: createdByRun, note: `created ${created}${warned ? ` (${warned} step warning${warned === 1 ? "" : "s"})` : ""}` };
}
