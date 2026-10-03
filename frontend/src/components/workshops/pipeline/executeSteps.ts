// Step executor (#6, shared by the pipeline runner and the #3 template batch).
// Replays runnable step kinds against ONE target dataset through the same
// store actions that recorded them. Module-level (not a hook) so the batch
// runner can drive it per file; callers own the pipelineRunning flag.

import { fitModel } from "../../../lib/api";
import { dropGapRows } from "../../../lib/api/finitePairs";
import { fitDataForSpec } from "../../../lib/fitselection";
import { fitSpecFromStepParams } from "../../../lib/fitStepDecode";
import { dyForFit } from "../../../lib/fitweights";
import { validateExpression, type PipelineStep } from "../../../lib/pipeline";
import { analysisData } from "../../../lib/rowstate";
import type { CalcResult, CorrectionParams } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

export type StepStatus = "ok" | "skipped" | "failed" | "warn";

export interface StepLogEntry {
  status: StepStatus;
  note?: string;
}

export interface ExecuteResult {
  log: Record<string, StepLogEntry>;
  /** Every fit-step result, in step order (the batch extracts outputs from
   *  the LAST one). */
  fits: CalcResult[];
  /** The dataset each fit in `fits` ran on (index-aligned) — `targetId`, or
   *  a transform step's output once one ran (P2.5). */
  fitTargets: string[];
  /** The dataset the run ended on (`targetId` unless a transform ran). */
  target: string;
  /** EVERY dataset a `transform` step created during this run, across every
   *  step, cumulative — for finding #3 (runTemplate.ts): a caller that needs
   *  to roll back exactly what THIS run created reads this instead of
   *  diffing the store's dataset list against a before/after snapshot, which
   *  would also catch an unrelated dataset a concurrent import created while
   *  this run awaited the backend. */
  created: string[];
  /** The outputs of the LAST `transform` step that actually ran — REPLACED,
   *  not accumulated, each time one runs, so a chain (stack, then transpose)
   *  reports only transpose's own output, never stack's now-superseded
   *  intermediate one. For finding #7: a caller stamping provenance wants
   *  every output the run's FINAL step produced (a split's children are
   *  siblings, equally final), not every dataset any step ever created —
   *  `created` above would also catch a chain's intermediate steps' outputs,
   *  which nothing should be reading any more once a later step consumed
   *  them. Empty when no transform step ran at all. */
  lastOutputs: string[];
}

/** Run `steps` against dataset `targetId`. A failing step logs `failed` and
 *  the run continues (failure isolation); disabled / ui / import steps are
 *  skipped with a note. `onProgress` fires after every step for live UIs. */
export async function executeSteps(
  steps: readonly PipelineStep[],
  targetId: string,
  onProgress?: (log: Record<string, StepLogEntry>) => void,
): Promise<ExecuteResult> {
  const log: Record<string, StepLogEntry> = {};
  const fits: CalcResult[] = [];
  const fitTargets: string[] = [];
  const created: string[] = [];
  let lastOutputs: string[] = [];
  const store = () => useApp.getState();

  // #38 deferred edge: a still-pending (preview-only) target must resolve to
  // full data before ANY step runs, or every step below would silently
  // compute on the small preview. This is the shared core for the interactive
  // pipeline run, the file batch, AND the folder batch (runTemplateOnFolder)
  // — the most dangerous case, since folder members are often datasets that
  // were never activated/rendered. Abort the whole run (no partial output)
  // rather than let some steps execute against wrong data.
  try {
    await store().resolveDataset(targetId);
  } catch (e) {
    const note = `couldn't load full data — ${e instanceof Error ? e.message : "error"}`;
    for (const step of steps) log[step.id] = { status: "failed", note };
    onProgress?.({ ...log });
    return { log, fits, fitTargets, target: targetId, created, lastOutputs };
  }

  // The dataset each step acts on. A `transform` step (P2.5) derives a new
  // dataset and every later step continues on THAT output — the same thing
  // recording did, since the output became the active dataset.
  let target = targetId;
  // Set when a transform FAILS or is DISABLED: every later step was recorded
  // against that transform's output, which does not exist — running them on
  // the input instead would edit the user's source dataset in place. They
  // are skipped.
  let blockedBy: string | null = null;
  // Recorded transform outputs -> this run's outputs (lib/transformReplay.ts),
  // so a later step's reference to an earlier step's output follows the replay.
  const produced = new Map<string, string | null>();
  for (const step of steps) {
    if (!step.enabled || blockedBy) {
      if (step.kind === "transform") {
        (await import("../../../lib/transformReplay")).markNotReproduced(produced, step.params);
        if (!step.enabled) blockedBy ??= `${step.label} is disabled`;
      }
      log[step.id] = {
        status: "skipped",
        note: step.enabled ? `not run — an earlier transform did not run (${blockedBy})` : "disabled",
      };
      onProgress?.({ ...log });
      continue;
    }
    try {
      switch (step.kind) {
        case "expression": {
          const name = String(step.params.name ?? "");
          const expr = String(step.params.expr ?? "");
          if (step.params.derived === true) {
            // P2.5: re-derive on THIS target — its units, its fit, its bound
            // errors — exactly as the ƒx bar did when it was recorded.
            const { addDerivedColumn } = await import("../../../store/derivedColumnRun");
            const r = await addDerivedColumn(target, {
              name,
              expr,
              propagate: step.params.propagate === true,
              allowUnitMismatch: step.params.allowUnitMismatch === true,
            });
            if (!r.ok) throw new Error(r.error);
            log[step.id] = { status: "ok" };
            break;
          }
          const err = validateExpression(
            expr,
            store().datasets.find((d) => d.id === target)?.data.labels.length ?? 0,
          );
          if (err) throw new Error(err);
          if (!store().addFormula(target, name, expr)) {
            throw new Error(store().status || "couldn't add the computed column");
          }
          log[step.id] = { status: "ok" };
          break;
        }
        case "correction": {
          const params = (step.params.params ?? {}) as CorrectionParams;
          const bg = step.params.bg as { datasetId: string; interp: string } | undefined;
          // applyCorrections reports failure by returning false with the
          // reason on the status line — never log that as "ok".
          if (!(await store().applyCorrections(target, params, bg))) throw new Error(store().status);
          log[step.id] = { status: "ok" };
          break;
        }
        case "reset": {
          store().resetCorrections(target);
          log[step.id] = { status: "ok" };
          break;
        }
        case "fit": {
          const ds = store().datasets.find((d) => d.id === target);
          const d = analysisData(ds);
          if (!ds || !d || d.values.length === 0) throw new Error("no data to fit");
          const spec = fitSpecFromStepParams(step.params);
          let x: number[];
          let y: number[];
          let dy: number[] | null | undefined;
          let wnote = "";
          if (spec.yKey === undefined) {
            // Legacy {model}-only step (pre-#6 templates): fit time vs values[0]
            // unweighted, deliberately — a saved template's outputs must not
            // change when replayed under the new channel-aware path.
            x = d.time;
            y = d.values.map((row) => row[0]);
          } else {
            // Reproduce the recorded channels + weighting over the TARGET's
            // analysis rows. analysisData(ds) already honors the TARGET's
            // exclusion∪filter — the correct semantics for cross-dataset batch
            // replay (source row indices would be meaningless on another file).
            // Same live-fallback + unweighted-on-missing-column semantics as the
            // recalc-graph recompute (store.recalc, fitDataForSpec).
            const st = store();
            const sel = fitDataForSpec(ds, spec, st.xKey, st.yKeys, st.seriesOrder);
            if (!sel || sel.x.length === 0) throw new Error("no data to fit");
            x = sel.x;
            y = sel.y;
            dy = sel.dy;
            if (spec.weight && spec.weight.mode !== "none" && sel.dy === null) {
              // Weighting was recorded but the target's error column can't
              // resolve; fit unweighted and SAY SO — folder batches need it.
              wnote = ` (${dyForFit(ds, sel.yKey, spec.weight).issue ?? "weight column missing"})`;
            }
          }
          const pairs = dropGapRows(x, y);
          if (pairs.x.length === 0) throw new Error("no finite X/Y pairs are available to fit");
          const finiteDy = dy ? pairs.keep.map((i) => dy![i]!) : undefined;
          const gapNote = pairs.complete ? "" : ` (${pairs.n - pairs.keep.length} gap rows excluded)`;
          const r = await fitModel({ model: spec.model, x: pairs.x, y: pairs.y, ...(finiteDy ? { dy: finiteDy } : {}) });
          fits.push(r);
          fitTargets.push(target);
          const r2 = typeof r.R2 === "number" ? ` R²=${r.R2.toFixed(4)}` : "";
          log[step.id] = { status: "ok", note: `fit${r2}${wnote}${gapNote}` };
          break;
        }
        case "transform": {
          // Lazy: only a pipeline that recorded a transform pays for it.
          const { replayTransform } = await import("../../../lib/transformReplay");
          const out = await replayTransform(store, step.params, target, produced);
          target = out.id;
          // Finding #3: EVERY dataset any step created, cumulative (a
          // split's children, not just the one `target` continues on) — an
          // in-place op (promote/metaclean) reports `outputs: []`, so it
          // contributes nothing here, matching "no new dataset" for those.
          created.push(...out.outputs.map((o) => o.id));
          // Finding #7: REPLACED (not accumulated) — the outputs of THIS
          // step, so a later step's own outputs supersede an earlier step's
          // now-intermediate ones (a chain's stack → transpose must not
          // leave stack's output looking "final" too). An in-place op
          // creates nothing new; `target` itself (unchanged by this step)
          // is still the run's current output.
          lastOutputs = out.outputs.length ? out.outputs.map((o) => o.id) : [target];
          const n = out.warnings.length;
          log[step.id] = {
            // Finding #4: a metaclean replay whose rules were all refused
            // logs "warn" (naming the refusal in `note`), not "ok" — the
            // batch log should point at this step, not read as a clean pass.
            status: out.refused ? "warn" : "ok",
            note: out.note ?? `created "${out.name}"${n ? ` (${n} warning${n === 1 ? "" : "s"}: ${out.warnings.map((w) => w.text).join(" ")})` : ""}`,
          };
          break;
        }
        default:
          log[step.id] = {
            status: "skipped",
            note: step.kind === "import" ? "input slot" : "ui step",
          };
      }
    } catch (e) {
      log[step.id] = {
        status: "failed",
        note: e instanceof Error ? e.message : "error",
      };
      if (step.kind === "transform") blockedBy = `${step.label} failed`;
    }
    onProgress?.({ ...log });
  }
  return { log, fits, fitTargets, target, created, lastOutputs };
}
