// Pipeline steps (#6/#7) — the typed step contract behind the macro recorder
// and the editable pipeline view. A PipelineStep carries BOTH the exported
// script line (`code`, what the macro panel has always shown) AND a typed
// {kind, params} payload, so a recording is directly editable and re-runnable
// — one source of truth for the script export and the pipeline runner. Pure
// (no React / store / fetch).

import { compileFormula } from "./formula";
import { editTargetIndex, formulaEditOf, LEGACY_EDIT } from "./formulaEditStep";
import { headlessFormulaProblem } from "./formulaHeadless";
import { resampleScriptParams, sigopScriptParams } from "./transformScriptParams";
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

/** A fit step's params after an edit: when the MODEL changed, the recorded
 *  start values, bounds and held flags belonged to the old model's
 *  parameters, so they are reset to "the model's own starts" (`p0: null`)
 *  rather than applied to a model they do not describe. */
export function fitParamsForEdit(step: PipelineStep, params: Record<string, unknown>): Record<string, unknown> {
  if (step.kind !== "fit" || params.model === step.params.model) return params;
  const { lower: _l, upper: _u, fixed: _f, ...rest } = params;
  return { ...rest, p0: null };
}

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
//   correction  -> qz.apply_corrections(raw, params, error_bindings=roles) —
//                  the app always corrects the dataset's UNcorrected base,
//                  with the error-column roles it seeded on import
//                  (qz.seed_error_roles), so the script does too; a
//                  background subtraction loads the background from a file
//                  the script asks for (--background, one per such step)
//   reset       -> back to that base
//   expression  -> a formula column, qz.add_formula_columns, when the formula
//                  is in the headless subset (lib/formulaHeadless.ts); like
//                  the app, every formula column is recomputed on top of the
//                  base after each correction / reset
//   transform   -> resample (n points / step / range) via qz.resample,
//                  and the signal / Reduce XY operations via qz.run_signal_op;
//                  the output is the new dataset later steps work on
//   fit         -> qz.fit_model(model, x, y) on the recorded channels and range,
//                  with the recorded starts, bounds and held parameters
//   ui          -> a comment, but ONLY for the view-only actions in VIEW_ONLY
//                  (axis scales, title, grid, waterfall, which channels plot):
//                  most "ui" recordings edit data (cell edits, sorts, row and
//                  column moves, recodes, re-imports), and any code not on that
//                  list is treated as one of them
// Everything else (a formula outside the subset or a derived column with
// units, the other transforms — join, merge, stack, split, dataset math, a
// resample onto another dataset —, paste, append, a ui step that is not
// view-only, a step with no known kind) has no `quantized.api` equivalent and
// becomes "NOT REPRODUCED". `qz run` (quantized/recipe_run.py) replays the
// same subset from a saved template. Every
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

/** The recorded actions that only change what is SHOWN: plot-view state in
 *  store/plotViewSettings that neither edits cells nor changes which dataset
 *  is active. Allow-list, never a deny-list: a new recorder is data-changing
 *  until it is added here. Deliberately NOT here (each can build a dataset or
 *  make another one active, so the steps after it ran on other data):
 *  applyFigure (a cross-book figure builds and activates an overlay),
 *  plotInNewWindow, facetByColumn, breakAtGaps, openFigureDocInWindow. */
const VIEW_ONLY = /^qz\.(setXScale|setYScale|setPlotTitle|setWaterfall|setShowGrid|setXKey|setYKeys|setGroupKey)\(/;

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
  // lib/fitStepDecode.ts keeps only two finite, ordered numbers.
  const r = p.range;
  const range = Array.isArray(r) && r.length === 2 && r.every((v) => typeof v === "number" && Number.isFinite(v)) && r[0] <= r[1] ? r : null;
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

/** What the generator knows while it walks the steps: the formula columns the
 *  current dataset carries (names, in order) and how many background files
 *  the script asks for so far. */
interface Gen {
  formulas: string[];
  backgrounds: number;
}

/** `target = <value>`, then the formula columns back on top (the app's order:
 *  corrections act on the base; computed columns are recomputed after). */
function rebase(value: string, g: Gen): string[] {
  return g.formulas.length
    ? [`${I}base = ${value}`, `${I}data = qz.add_formula_columns(base, formulas)  # the formula columns, recomputed`]
    : [`${I}data = ${value}`];
}

const ROWS_NOTE = comment("rows excluded or filtered in the app are not recorded; this uses every row");

function expressionLines(step: PipelineStep, g: Gen): Emit {
  const p = step.params;
  if (typeof p.name !== "string" || typeof p.expr !== "string") {
    return { lines: [], changesData: true, unmapped: "this worksheet operation has no quantized.api equivalent" };
  }
  if (p.derived === true) return { lines: [], changesData: true, unmapped: "derived columns (units and error propagation) are evaluated only in the app" };
  const problem = headlessFormulaProblem(p.expr);
  if (problem) return { lines: [], changesData: true, unmapped: `formula ${JSON.stringify(p.expr)} is evaluated only in the app: ${problem}` };
  // An edit replaces the column it edited (lib/formulaEditStep.ts), as the app's
  // Run pipeline does; the script holds only the pipeline's own columns.
  const of = formulaEditOf(step);
  if (of === null) return { lines: [], changesData: true, unmapped: LEGACY_EDIT };
  const at = of === undefined ? g.formulas.length : editTargetIndex(g.formulas, of);
  if (typeof at !== "number") return { lines: [], changesData: true, unmapped: `${at.error} among the columns this pipeline added` };
  const lines = g.formulas.length ? [] : [`${I}base = data  # the worksheet before its formula columns`];
  lines.push(of === undefined ? `${I}formulas.append((${py(p.name)}, ${py(p.expr)}))` : `${I}formulas[${at}] = (${py(p.name)}, ${py(p.expr)})  # edits ${py(of)}`);
  g.formulas[at] = p.name;
  if (typeof p.errorOf === "string") lines.push(comment(`bound as column ${p.errorOf}'s error bars in the app; the binding is not applied here`));
  lines.push(`${I}data = qz.add_formula_columns(base, formulas)`);
  return { lines, changesData: true };
}

/** The transform's call, from params validated by the app's OWN replay
 *  validators (what a replay would send), or why it is not reproduced. */
function transformCall(p: Record<string, unknown>): string | { unmapped: string } {
  try {
    if (p.op === "sigop") {
      const s = sigopScriptParams(p);
      return `qz.run_signal_op(data, ${py(s.method)}, ${py(s.channels)}, ${py(s.args)}).data`;
    }
    if (p.op === "resample" && p.mode !== "match") {
      const r = resampleScriptParams(p);
      const grid = r.mode === "n_points" ? `, n_points=${py(r.nPoints)}` : r.mode === "step" ? `, step=${py(r.step)}` : `, start=${py(r.start)}, stop=${py(r.stop)}, step=${py(r.step)}`;
      return `qz.resample(data, mode=${py(r.mode)}${grid}, method=${py(r.method)}, out_of_range=${py(r.outOfRange)}, unsorted=${py(r.sortUnsorted ? "sort" : "refuse")}).data`;
    }
  } catch (e) {
    return { unmapped: `its recorded settings are invalid (${e instanceof Error ? e.message : "error"})` };
  }
  const what = p.op === "resample" ? "a resample onto another dataset's x" : `the ${String(p.op ?? "transform")} transform`;
  return { unmapped: `${what} has no quantized.api equivalent` };
}

function transformLines(p: Record<string, unknown>, g: Gen): Emit {
  const call = transformCall(p);
  if (typeof call !== "string") return { lines: [], changesData: true, unmapped: call.unmapped };
  const reset = g.formulas.length ? [`${I}formulas = []  # the new dataset holds them as plain values`] : [];
  g.formulas = [];
  return {
    lines: [ROWS_NOTE, `${I}data = ${call}`, `${I}raw = data  # a new dataset: its own base`, `${I}roles = None  # with no error-column roles, as in the app`, ...reset],
    changesData: true,
  };
}

function correctionLines(p: Record<string, unknown>, g: Gen): Emit {
  const lines = [comment("Error-column roles changed by hand in the app are not recorded; this uses the roles seeded on import.")];
  let bg = "";
  const ref = p.bg as { interp?: unknown } | null | undefined;
  if (ref) {
    lines.push(
      comment("The background is read from the file given with --background, as loaded: if it was corrected in the app, correct it here first."),
      `${I}background = qz.load(args.background[${g.backgrounds}])`,
    );
    bg = `, bg_dataset=background, bg_interp=${py(String(ref.interp ?? "linear"))}`;
    g.backgrounds++;
  }
  return { lines: [...lines, ...rebase(`qz.apply_corrections(raw, ${py(p.params ?? {})}${bg}, error_bindings=roles)`, g)], changesData: true };
}

function stepLines(step: PipelineStep, n: number, inputIndex: number, g: Gen): Emit {
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
      const reset = g.formulas.length ? [`${I}formulas = []`] : [];
      g.formulas = [];
      return {
        lines: [`${I}data = qz.load(args.inputs[${inputIndex}])`, `${I}raw = data  # the uncorrected base that corrections start from`, `${I}roles = qz.seed_error_roles(data)  # the error-column roles the app gives the file on import`, ...reset],
        changesData: true,
      };
    }
    case "correction":
      return correctionLines(p, g);
    case "reset":
      return { lines: rebase("raw", g), changesData: true };
    case "fit":
      return fitLines(n, p, step.label);
    case "ui":
      return VIEW_ONLY.test(step.code)
        ? { lines: [comment("display setting only; there is no data to re-run"), ...appLine(step)], changesData: false }
        : { lines: [], changesData: true, unmapped: "this recorded action can change the data and has no quantized.api equivalent" };
    case "expression":
      return expressionLines(step, g);
    case "transform":
      return transformLines(p, g);
    default:
      return { lines: [], changesData: true, unmapped: "this step kind has no quantized.api equivalent" };
  }
}

/** Render the pipeline as a runnable Python script (see the module doc). */
export function pipelineToPython(steps: readonly PipelineStep[]): string {
  const inputs: string[] = [];
  const body: string[] = [];
  let stoppedAt = 0;
  let stopWhy = "which this script cannot reproduce";
  let loaded = false;
  const gen: Gen = { formulas: [], backgrounds: 0 };
  steps.forEach((step, i) => {
    const n = i + 1;
    body.push("", comment(`${n}. ${step.label}`));
    if (!step.enabled) {
      body.push(comment("(turned off in the pipeline; not run)"), ...appLine(step));
      // As the app's Run pipeline: every later step was recorded on this
      // transform's output, which does not exist (executeSteps' blockedBy).
      if (step.kind === "transform" && !stoppedAt) {
        stoppedAt = n;
        stopWhy = "a turned-off transform: the steps after it were recorded on its output";
      }
      return;
    }
    if (stoppedAt) {
      body.push(comment(`not run: it follows step ${stoppedAt}, ${stopWhy}`), ...appLine(step));
      return;
    }
    if (step.kind !== "import" && step.kind !== "ui" && !loaded) {
      // The pipeline started on a dataset that was already open: load it from
      // the first input given on the command line.
      inputs.push("");
      body.push(comment("The pipeline ran on a dataset that was already open; load its file:"), `${I}data = qz.load(args.inputs[0])`, `${I}raw = data`, `${I}roles = qz.seed_error_roles(data)  # the error-column roles the app gives the file on import`);
      loaded = true;
    }
    const out = stepLines(step, n, inputs.length, gen);
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
  const usesFormulas = body.some((l) => l.includes("add_formula_columns"));
  const bgs = gen.backgrounds;
  // Choosing a dataset in the Library is not recorded, so after a second
  // import (or an Origin project's many books) the app may have run later
  // steps on another dataset than the one this script holds.
  const several = inputs.length > 1 || inputs.some((s) => /\.opju?$/i.test(s));
  const caveat = several
    ? [
        comment("NOTE: switching datasets in the app is not recorded. Each step here runs on the data"),
        comment("loaded or produced last; check that this is the dataset the app's steps ran on."),
        `${I}print("note: dataset switches in the app are not recorded; this script runs each step on the data it loaded last")`,
      ]
    : [];
  const count = `${steps.length} step${steps.length === 1 ? "" : "s"}`;
  const recorded = inputs.map((s) => (s ? py(s) : "None")).join(", ");
  return [
    "#!/usr/bin/env python3",
    `"""Quantized pipeline: reproducible analysis script (${count}).`,
    "",
    "Re-runs the recorded data pipeline headless with the public quantized.api",
    "(pip install quantized-lab). It runs in this process: no app or server is needed,",
    "and the project open in the app is not changed. Steps with no quantized.api",
    "equivalent are kept as comments that say so.",
    "",
    `Usage: python <this file> [INPUT ...] [--out OUT]${bgs ? " --background FILE".repeat(bgs) : ""}`,
    "  INPUT  the file(s) the pipeline imports, in order (default: the recorded names)",
    "  OUT    where the final data goes: .csv, .tsv or .xlsx (default pipeline_output.csv)",
    ...(bgs ? [`  FILE   the background each background-subtraction step subtracts, in step order (${bgs})`] : []),
    '"""',
    "",
    "import argparse",
    "import sys",
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
    ...(bgs
      ? [`${I}parser.add_argument("--background", action="append", default=[], help="background file, one per background-subtraction step")`]
      : []),
    `${I}args = parser.parse_args(argv)`,
    `${I}if hasattr(sys.stdout, "reconfigure"):  # labels may hold \u03bc etc.; a cp1252 console must not crash`,
    `${I}${I}sys.stdout.reconfigure(errors="backslashreplace")`,
    `${I}if not args.inputs and None not in RECORDED_INPUTS:`,
    `${I}${I}args.inputs = list(RECORDED_INPUTS)`,
    `${I}if len(args.inputs) != len(RECORDED_INPUTS):`,
    `${I}${I}parser.error(f"give {len(RECORDED_INPUTS)} input file(s)")`,
    ...(bgs
      ? [`${I}if len(args.background) != ${bgs}:`, `${I}${I}parser.error("give ${bgs} --background file(s), one per background-subtraction step")`]
      : []),
    `${I}data = None`,
    ...caveat,
    ...(usesFits ? [`${I}fits = []`] : []),
    ...(usesFormulas ? [`${I}formulas = []  # the formula columns (name, expression), recomputed after each correction`] : []),
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
    // The script's own output: replaced on a re-run (overwrite), but never
    // one of the inputs it read (protect) — quantized.api.save_table refuses.
    `${I}qz.save_table(data, args.out, overwrite=True, protect=args.inputs${bgs ? " + args.background" : ""})  # replaces --out, never an input`,
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
