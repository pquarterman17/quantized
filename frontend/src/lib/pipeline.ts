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

// The recorded pipeline as a RUNNABLE Python script (origin gap audit 4, G4).
//
// The old export was `qz.setShowGrid(true)`-style lines that nothing could run.
// This writes a real script on the public, in-process `quantized.api`: it
// loads the input file(s), replays the steps that have an API equivalent, and
// saves the final data. It runs headless — no app, no server — and never
// touches the project open in the app (`quantized.client` cannot read or write
// an open project's workbooks either; see its module doc).
//
// Step mapping (`params` as the recorders store them):
//   import      -> qz.load(path) — for an Origin project too: it returns the
//                  primary book, the one the app activates after the import
//   correction  -> qz.apply_corrections(raw, params) — the app always corrects
//                  the dataset's UNcorrected base, so the script does too
//   reset       -> back to that base
//   fit         -> qz.fit_model(model, x, y) on the recorded channels and range,
//                  with the recorded starts, bounds and held parameters
//   ui          -> a comment, but ONLY for the view-only actions in VIEW_ONLY
//                  (axis scales, titles, figure styles, which channels plot):
//                  most "ui" recordings edit data (cell edits, sorts, row and
//                  column moves, recodes, re-imports), and any code not on that
//                  list is treated as one of them
// Everything else (formula columns, transforms, paste, append, a background
// subtraction, a ui step that is not view-only, a step with no known kind)
// has no `quantized.api` equivalent and becomes "NOT REPRODUCED". Every
// comment-only step also keeps the app's own recorded line (`# app: ...`),
// values included, as the audit trail the old export was. Because the data then differs from the app's, every LATER data step is
// listed as a comment too, never run on the wrong data; the script still saves
// what it did reproduce and says which step it stopped at.
//
// Pure and deterministic (no timestamps). Kept in this lazy module rather
// than a file of its own: a separate chunk added its name to the entry's
// preload map, eager bytes the bundle budget has no room for.

/** A JSON-shaped value as a Python literal. */
export function py(value: unknown): string {
  if (value === undefined || value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return 'float("nan")';
    if (!Number.isFinite(value)) return value > 0 ? 'float("inf")' : 'float("-inf")';
    return Object.is(value, -0) ? "-0.0" : String(value);
  }
  // A JSON string literal is a valid Python one (same escapes).
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(py).join(", ")}]`;
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${JSON.stringify(k)}: ${py(v)}`);
    return `{${parts.join(", ")}}`;
  }
  return "None";
}

const I = "    "; // one indent level, inside main()

/** The recorded actions that only change what is SHOWN (store/plotViewSettings,
 *  viewAppliers, the figure appliers, plotInNewWindow). Allow-list, never a
 *  deny-list: a new recorder is data-changing until it is added here. */
const VIEW_ONLY = /^qz\.(setXScale|setYScale|setPlotTitle|setWaterfall|setShowGrid|applyFigure|openFigureDocInWindow|plotInNewWindow|setXKey|setYKeys|setGroupKey|facetByColumn|breakAtGaps)\(/;

interface Emit {
  /** Code lines for main()'s body (already indented). */
  lines: string[];
  /** Does the step change the data? An unmappable one stops the replay. */
  changesData: boolean;
  /** Not reproducible: the reason, for the comment. */
  unmapped?: string;
}

function comment(text: string): string {
  return `${I}# ${text.replace(/\s+/g, " ")}`;
}

/** The app's own recorded line, values included, for a step that is not run
 *  (the old `.qzm` export's audit trail). */
function appLine(step: PipelineStep): string[] {
  return step.code ? [comment(`app: ${step.code}`)] : [];
}

function fitLines(n: number, p: Record<string, unknown>, label: string): Emit {
  const model = typeof p.model === "string" ? p.model : "";
  if (!model) return { lines: [], changesData: false, unmapped: "the fit model was not recorded" };
  if (typeof p.yKey !== "number") return { lines: [], changesData: false, unmapped: "the fitted Y channel was not recorded" };
  if (Array.isArray(p.rowIds)) return { lines: [], changesData: false, unmapped: "it fitted an explicit row selection, which quantized.api cannot select" };
  if (p.weight) return { lines: [], changesData: false, unmapped: "its weighting has no quantized.api equivalent here" };
  // `p0` (null = the model's own starts) is recorded since gap audit 4 lane E;
  // a step without the key cannot say whether the user edited the starts.
  const recorded = Object.hasOwn(p, "p0");
  const starts = Array.isArray(p.p0)
    ? ["p0", "lower", "upper", "fixed"].filter((k) => Array.isArray(p[k])).map((k) => `, ${k}=${py(p[k])}`).join("")
    : "";
  const x = typeof p.xKey === "number" ? `data.column(${p.xKey})` : "data.time";
  const lines = [
    `${I}x, y = np.asarray(${x}, dtype=float), np.asarray(data.column(${p.yKey}), dtype=float)`,
    `${I}keep = np.isfinite(x) & np.isfinite(y)`,
  ];
  const range = Array.isArray(p.range) && p.range.length === 2 ? p.range : null;
  if (range) lines.push(`${I}keep &= (x >= ${py(range[0])}) & (x <= ${py(range[1])})  # the recorded fit window`);
  if (!recorded) {
    lines.push(
      comment("WARNING: recorded before start values, bounds and held parameters were saved; this fit uses the automatic starts."),
      `${I}print(${py(`warning: step ${n} was recorded without its start values, bounds or held parameters; if they were edited in the app, this fit differs`)})`,
    );
  }
  lines.push(`${I}fit = qz.fit_model(${py(model)}, x[keep], y[keep]${starts})`);
  lines.push(`${I}fits.append((${py(`${n}. ${label}`)}, fit))`);
  if (typeof p.nPoints === "number") {
    lines.push(
      `${I}if int(keep.sum()) != ${p.nPoints}:`,
      `${I}${I}print(f"note: step ${n} fit {int(keep.sum())} points; the app fit ${p.nPoints} (rows masked in the app are not recorded)")`,
    );
  }
  if (p.statsVersion !== 2) lines.push(comment("recorded with the legacy (v1) fit statistics; this uses the current ones"));
  return { lines, changesData: false };
}

function stepLines(step: PipelineStep, n: number, inputIndex: number): Emit {
  const p = step.params;
  switch (step.kind) {
    case "import": {
      if (typeof p.name !== "string") {
        return { lines: [], changesData: true, unmapped: Array.isArray(p.names) ? "an appended multi-file import has no quantized.api equivalent" : "the import source was not recorded" };
      }
      // store/dataIntake.ts records a paste as an import labelled "Paste <name>".
      if (step.label.startsWith("Paste ")) return { lines: [], changesData: true, unmapped: "pasted data has no file to load" };
      // An Origin project: qz.load returns its primary book, the one the app
      // makes active after the import (and the recorded steps then ran on).
      return {
        lines: [`${I}data = qz.load(args.inputs[${inputIndex}])`, `${I}raw = data  # the uncorrected base that corrections start from`],
        changesData: true,
      };
    }
    case "correction": {
      if (p.bg) return { lines: [], changesData: true, unmapped: "it subtracts a background dataset, which the pipeline does not record by file" };
      return {
        lines: [
          comment("Error-column bindings set in the app are not recorded; pass error_bindings=[...] to match them."),
          `${I}data = qz.apply_corrections(raw, ${py(p.params ?? {})})`,
        ],
        changesData: true,
      };
    }
    case "reset":
      return { lines: [`${I}data = raw`], changesData: true };
    case "fit":
      return fitLines(n, p, step.label);
    case "ui":
      return VIEW_ONLY.test(step.code)
        ? { lines: [comment("display setting only; there is no data to re-run"), ...appLine(step)], changesData: false }
        : { lines: [], changesData: true, unmapped: "this recorded action can change the data and has no quantized.api equivalent" };
    case "expression":
      return { lines: [], changesData: true, unmapped: "formula columns are evaluated only in the app (no quantized.api equivalent)" };
    case "transform":
      return { lines: [], changesData: true, unmapped: `the ${String(p.op ?? "transform")} transform has no quantized.api equivalent` };
    default:
      return { lines: [], changesData: true, unmapped: "this step kind has no quantized.api equivalent" };
  }
}

/** Render the pipeline as a runnable Python script (see the module doc). */
export function pipelineToPython(steps: readonly PipelineStep[]): string {
  const inputs: string[] = [];
  const body: string[] = [];
  let stoppedAt = 0;
  let loaded = false;
  steps.forEach((step, i) => {
    const n = i + 1;
    body.push("", comment(`${n}. ${step.label}`));
    if (!step.enabled) {
      body.push(comment("(turned off in the pipeline; not run)"), ...appLine(step));
      return;
    }
    if (stoppedAt) {
      body.push(comment(`not run: it follows step ${stoppedAt}, which this script cannot reproduce`), ...appLine(step));
      return;
    }
    if (step.kind !== "import" && step.kind !== "ui" && !loaded) {
      // The pipeline started on a dataset that was already open: load it from
      // the first input given on the command line.
      inputs.push("");
      body.push(comment("The pipeline ran on a dataset that was already open; load its file:"), `${I}data = qz.load(args.inputs[0])`, `${I}raw = data`);
      loaded = true;
    }
    const out = stepLines(step, n, inputs.length);
    if (out.unmapped) {
      body.push(comment(`NOT REPRODUCED: ${out.unmapped}.`), ...appLine(step));
      if (out.changesData) stoppedAt = n;
      return;
    }
    if (step.kind === "import") {
      inputs.push(String(step.params.name));
      loaded = true;
    }
    body.push(...out.lines);
  });
  const usesFits = body.some((l) => l.includes("fits.append"));
  const count = `${steps.length} step${steps.length === 1 ? "" : "s"}`;
  const recorded = inputs.map((s) => (s ? py(s) : "None")).join(", ");
  return [
    "#!/usr/bin/env python3",
    `"""Quantized pipeline: reproducible analysis script (${count}).`,
    "",
    "Re-runs the recorded data pipeline headless with the public quantized.api",
    "(pip install quantized). It runs in this process: no app or server is needed,",
    "and the project open in the app is not changed. Steps with no quantized.api",
    "equivalent are kept as comments that say so.",
    "",
    "Usage: python <this file> [INPUT ...] [--out OUT]",
    "  INPUT  the file(s) the pipeline imports, in order (default: the recorded names)",
    "  OUT    where the final data goes: .csv, .tsv or .xlsx (default pipeline_output.csv)",
    '"""',
    "",
    "import argparse",
    "",
    ...(usesFits ? ["import numpy as np", ""] : []),
    "import quantized.api as qz",
    "",
    `RECORDED_INPUTS = [${recorded}]`,
    "",
    "",
    "def main(argv=None):",
    `${I}parser = argparse.ArgumentParser(description="Re-run a recorded Quantized pipeline.")`,
    `${I}parser.add_argument("inputs", nargs="*", help="input file(s), in import order")`,
    `${I}parser.add_argument("--out", default="pipeline_output.csv", help="output table (.csv/.tsv/.xlsx)")`,
    `${I}args = parser.parse_args(argv)`,
    `${I}if not args.inputs and None not in RECORDED_INPUTS:`,
    `${I}${I}args.inputs = list(RECORDED_INPUTS)`,
    `${I}if len(args.inputs) != len(RECORDED_INPUTS):`,
    `${I}${I}parser.error(f"give {len(RECORDED_INPUTS)} input file(s)")`,
    `${I}data = None`,
    ...(usesFits ? [`${I}fits = []`] : []),
    ...body,
    "",
    ...(usesFits
      ? [
          `${I}for label, fit in fits:`,
          `${I}${I}values = ", ".join(f"{k}={v:.6g}" for k, v in zip(fit["paramNames"], fit["params"]))`,
          `${I}${I}print(f"{label}: {values}  R2={fit['R2']:.6g}")`,
        ]
      : []),
    `${I}if data is None:`,
    `${I}${I}print("nothing to save: no step loaded data")`,
    `${I}${I}return 1`,
    `${I}qz.save_table(data, args.out)`,
    stoppedAt
      ? `${I}print(f"saved {args.out}: the data after step ${stoppedAt - 1}; steps from ${stoppedAt} on were NOT reproduced")`
      : `${I}print(f"saved {args.out}")`,
    `${I}return 0`,
    "",
    "",
    'if __name__ == "__main__":',
    `${I}raise SystemExit(main())`,
    "",
  ].join("\n");
}

/** The exported script (Pipeline panel, Macro card): `pipelineToPython`. */
export const pipelineToScript = pipelineToPython;
