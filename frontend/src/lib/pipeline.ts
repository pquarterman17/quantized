// Pipeline steps (#6/#7) — the typed step contract behind the macro recorder
// and the editable pipeline view. A PipelineStep carries BOTH the exported
// script line (`code`, what the macro panel has always shown) AND a typed
// {kind, params} payload, so a recording is directly editable and re-runnable
// — one source of truth for the script export and the pipeline runner. Pure
// (no React / store / fetch).

import { compileFormula } from "./formula";
import { lit } from "./macro";

/** Step kinds. Runnable kinds re-execute against the active dataset;
 *  "ui" steps (axis toggles, titles, figure applies…) replay as script lines
 *  only and are skipped by the runner. "import" marks the input slot (a
 *  future template binds a file to it, #2). */
export type StepKind = "ui" | "import" | "expression" | "correction" | "reset" | "fit";

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
        code: `qz.addColumn(${lit(p.name)}, ${lit(p.expr)})`,
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

/** Author-time validation for an expression step (#7): compile the formula
 *  (no eval — recursive-descent parser) and check its column references
 *  against the dataset's channel letters. Returns null when valid, else the
 *  error message to surface inline. */
export function validateExpression(expr: string, channelCount: number): string | null {
  let fn;
  try {
    fn = compileFormula(expr);
  } catch (e) {
    return e instanceof Error ? e.message : "parse error";
  }
  // Probe with a representative row context: x plus A.. for each channel.
  const ctx: Record<string, number> = { x: 1 };
  for (let i = 0; i < channelCount; i++) {
    ctx[String.fromCharCode(65 + (i % 26))] = 1;
  }
  try {
    const v = fn(ctx);
    return Number.isFinite(v) || Number.isNaN(v) ? null : "expression must yield a number";
  } catch (e) {
    return e instanceof Error ? e.message : "evaluation error";
  }
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

/** Validate persisted steps from a .dwk (v3): drop malformed entries, mint
 *  fresh ids (persisted ids could collide with this session's counter). */
export function sanitizeSteps(v: unknown): PipelineStep[] {
  if (!Array.isArray(v)) return [];
  const kinds: readonly string[] = ["ui", "import", "expression", "correction", "reset", "fit"];
  const out: PipelineStep[] = [];
  for (const s of v) {
    if (typeof s !== "object" || s === null) continue;
    const o = s as Record<string, unknown>;
    if (
      typeof o.label !== "string" ||
      typeof o.code !== "string" ||
      !kinds.includes(String(o.kind)) ||
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
