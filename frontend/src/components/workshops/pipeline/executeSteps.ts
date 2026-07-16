// Step executor (#6, shared by the pipeline runner and the #3 template batch).
// Replays runnable step kinds against ONE target dataset through the same
// store actions that recorded them. Module-level (not a hook) so the batch
// runner can drive it per file; callers own the pipelineRunning flag.

import { fitModel } from "../../../lib/api";
import { fitDataForSpec, fitSpecFromStepParams } from "../../../lib/fitselection";
import { dyForFit } from "../../../lib/fitweights";
import { validateExpression, type PipelineStep } from "../../../lib/pipeline";
import { analysisData } from "../../../lib/rowstate";
import type { CalcResult, CorrectionParams } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

export type StepStatus = "ok" | "skipped" | "failed";

export interface StepLogEntry {
  status: StepStatus;
  note?: string;
}

export interface ExecuteResult {
  log: Record<string, StepLogEntry>;
  /** Every fit-step result, in step order (the batch extracts outputs from
   *  the LAST one). */
  fits: CalcResult[];
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
    return { log, fits };
  }

  for (const step of steps) {
    if (!step.enabled) {
      log[step.id] = { status: "skipped", note: "disabled" };
      onProgress?.({ ...log });
      continue;
    }
    try {
      switch (step.kind) {
        case "expression": {
          const name = String(step.params.name ?? "");
          const expr = String(step.params.expr ?? "");
          const err = validateExpression(
            expr,
            store().datasets.find((d) => d.id === targetId)?.data.labels.length ?? 0,
          );
          if (err) throw new Error(err);
          store().addFormula(targetId, name, expr);
          log[step.id] = { status: "ok" };
          break;
        }
        case "correction": {
          const params = (step.params.params ?? {}) as CorrectionParams;
          const bg = step.params.bg as { datasetId: string; interp: string } | undefined;
          await store().applyCorrections(targetId, params, bg);
          log[step.id] = { status: "ok" };
          break;
        }
        case "reset": {
          store().resetCorrections(targetId);
          log[step.id] = { status: "ok" };
          break;
        }
        case "fit": {
          const ds = store().datasets.find((d) => d.id === targetId);
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
          const r = await fitModel({ model: spec.model, x, y, ...(dy ? { dy } : {}) });
          fits.push(r);
          const r2 = typeof r.R2 === "number" ? ` R²=${r.R2.toFixed(4)}` : "";
          log[step.id] = { status: "ok", note: `fit${r2}${wnote}` };
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
    }
    onProgress?.({ ...log });
  }
  return { log, fits };
}
