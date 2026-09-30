// The pipeline STEP model — the part of lib/pipeline.ts the macro recorder
// (store/macroPipeline.ts, composed into useApp) needs on every recorded
// action: the step types, `makeStep` (and the session id counter it owns),
// `regenerateStep` and `moveStep`. Split out verbatim (bundle headroom slice
// 13, plans/BUNDLE_HEADROOM.md, the slice-12 "small eager half" shape) so the
// rest of lib/pipeline.ts — script export, expression validation, the param
// form schema and the .dwk sanitizer, used only by the lazy Pipeline panel,
// Macro card and workspace codec — stays out of the entry chunk.
// lib/pipeline.ts re-exports everything here (so `sanitizeSteps` and every
// importer share this ONE `makeStep` counter); an eager module must import
// from THIS file (architecture.test.ts's DRAGGED_OUT list is the guard).

import { lit } from "./macro";

/** Step kinds. Runnable kinds re-execute against the active dataset;
 *  "ui" steps (axis toggles, titles, figure applies…) replay as script lines
 *  only and are skipped by the runner. "import" marks the input slot (a
 *  future template binds a file to it, #2). "transform" (P2.5) derives a NEW
 *  dataset from the target (join/stack/unstack/transpose/merge/split/dataset
 *  math — lib/transformRun.ts owns its params); the runner then continues on
 *  that output, exactly as recording did (the output became active). */
export type StepKind = "ui" | "import" | "expression" | "correction" | "reset" | "fit" | "transform";

export interface PipelineStep {
  id: string;
  kind: StepKind;
  label: string;
  /** The reproducible qz.* line (regenerated for runnable kinds on edit). */
  code: string;
  params: Record<string, unknown>;
  enabled: boolean;
}

let _seq = 0;

/** Build a step with a unique id. */
export function makeStep(
  kind: StepKind,
  label: string,
  code: string,
  params: Record<string, unknown> = {},
): PipelineStep {
  return { id: `step-${++_seq}`, kind, label, code, params, enabled: true };
}

/** Regenerate a runnable step's label + code after a params edit ("ui" and
 *  unknown kinds keep their recorded text verbatim). */
export function regenerateStep(step: PipelineStep): PipelineStep {
  const p = step.params;
  switch (step.kind) {
    case "expression":
      return {
        ...step,
        label: `Add column ${String(p.name ?? "")}`,
        // Finding 5: keep the `{ errors: true }` propagate flag on a
        // regenerate, the same template store/derivedColumnRun.ts records —
        // dropping it silently un-derived the σ column on the next re-run.
        code: `qz.addColumn(${lit(p.name)}, ${lit(p.expr)}${p.propagate ? ", { errors: true }" : ""})`,
      };
    case "correction":
      return {
        ...step,
        label: "Corrections → active dataset",
        code: `qz.applyCorrections("<active>", ${lit(p.params)})`,
      };
    case "reset":
      return { ...step, label: "Reset corrections", code: `qz.resetCorrections("<active>")` };
    case "fit":
      return {
        ...step,
        label: `Fit ${String(p.model ?? "")}`,
        code: `qz.fit(${lit(p.model)})`,
      };
    default:
      return step;
  }
}

/** Reorder helper: move the step at `index` by `delta`, clamped. */
export function moveStep(
  steps: readonly PipelineStep[],
  index: number,
  delta: number,
): PipelineStep[] {
  const to = Math.max(0, Math.min(steps.length - 1, index + delta));
  if (to === index) return [...steps];
  const out = [...steps];
  const [s] = out.splice(index, 1);
  out.splice(to, 0, s);
  return out;
}
