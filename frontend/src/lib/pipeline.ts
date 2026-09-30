// Pipeline steps (#6/#7) — the typed step contract behind the macro recorder
// and the editable pipeline view. A PipelineStep carries BOTH the exported
// script line (`code`, what the macro panel has always shown) AND a typed
// {kind, params} payload, so a recording is directly editable and re-runnable
// — one source of truth for the script export and the pipeline runner. Pure
// (no React / store / fetch).

import { compileFormula } from "./formula";
import { channelIndexOf } from "./formulaRename";
import { makeStep, type PipelineStep, type StepKind } from "./pipelineStep";

// The step model (types, `makeStep`, `regenerateStep`, `moveStep`) lives in
// the eager leaf ./pipelineStep.ts (bundle headroom slice 13); re-exported so
// every importer of this module is unchanged.
export { makeStep, moveStep, regenerateStep, type PipelineStep, type StepKind } from "./pipelineStep";

/** Render the pipeline as the exported script: enabled steps emit their code
 *  line, disabled steps a commented-out line. Deterministic (like macro.ts). */
export function pipelineToScript(steps: readonly PipelineStep[]): string {
  const lines = [
    "// Quantized pipeline — reproducible analysis script",
    `// ${steps.length} step${steps.length === 1 ? "" : "s"}`,
    "",
  ];
  if (steps.length === 0) lines.push("// (no steps recorded)");
  else for (const s of steps) lines.push(s.enabled ? s.code : `// off: ${s.code}`);
  return lines.join("\n") + "\n";
}

/** Author-time validation for an expression step (#7 / review finding 5):
 *  compile the formula (no eval — recursive-descent parser) and check its
 *  column references against the dataset's channel letters, both from the
 *  SAME parse pass (formula.ts's `onRef` hook — the same mechanism
 *  `referencedColumns` uses, inlined here so a real parse error keeps its
 *  own message instead of `referencedColumns`' generic "invalid"). Returns
 *  null when valid, else the error message to surface inline.
 *
 *  Deliberately never evaluates: the old version probed with a fabricated
 *  `{x:1, A:1, B:1, …}` row context, which has no fit snapshot and no
 *  aggregate/column window — so it rejected every `fit()`/`fitval()` and
 *  every aggregate (`mean(A)`, …) expression outright, regardless of
 *  whether the dataset actually has a usable fit. A syntax + reference
 *  check can't be fooled that way because it never runs the formula. */
export function validateExpression(expr: string, channelCount: number): string | null {
  const refs: string[] = [];
  try {
    compileFormula(expr, (name) => refs.push(name));
  } catch (e) {
    return e instanceof Error ? e.message : "parse error";
  }
  for (const name of refs) {
    if (name === "x") continue;
    const idx = channelIndexOf(name);
    if (idx === null || idx >= channelCount) return `unknown variable "${name}"`;
  }
  return null;
}

/** The editable fields per runnable kind (schema-driven param form, #6).
 *  "correction" edits are value-typed off the recorded params object itself. */
export const STEP_FIELDS: Record<string, { key: string; label: string }[]> = {
  expression: [
    { key: "name", label: "column name" },
    { key: "expr", label: "expression (x, A, B, …)" },
  ],
  fit: [{ key: "model", label: "fit model" }],
};

/** Every step kind a persisted .dwk / template may carry ("transform", P2.5:
 *  join/stack/unstack/transpose/merge/split/dataset math). An unknown kind is
 *  dropped on load. */
export const STEP_KINDS: readonly string[] = ["ui", "import", "expression", "correction", "reset", "fit", "transform"];

/** Validate persisted steps from a .dwk (v3): drop malformed entries, mint
 *  fresh ids (persisted ids could collide with this session's counter). */
export function sanitizeSteps(v: unknown): PipelineStep[] {
  if (!Array.isArray(v)) return [];
  const out: PipelineStep[] = [];
  for (const s of v) {
    if (typeof s !== "object" || s === null) continue;
    const o = s as Record<string, unknown>;
    if (
      typeof o.label !== "string" ||
      typeof o.code !== "string" ||
      !STEP_KINDS.includes(String(o.kind)) ||
      typeof o.params !== "object" ||
      o.params === null
    ) {
      continue;
    }
    out.push({
      ...makeStep(o.kind as StepKind, o.label, o.code, { ...(o.params as Record<string, unknown>) }),
      enabled: o.enabled !== false,
    });
  }
  return out;
}
