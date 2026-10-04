import { validateExpression } from "./pipeline";
import type { PipelineStep } from "./pipelineStep";
import { transformParamsOf } from "./transformRun";
import type { Dataset } from "./types";
import type { PipelineStructuralAction } from "./pipelineStructuralEdit";

export type PipelineStepState = "ready" | "display_only" | "input" | "disabled" | "invalid" | "blocked";

export interface PipelineStepReview {
  id: string;
  state: PipelineStepState;
  summary: string;
  impact: string;
  issue?: string;
}

export interface PipelineReview {
  steps: PipelineStepReview[];
  runnable: number;
  displayOnly: number;
  inputs: number;
  disabled: number;
  invalid: number;
  blocked: number;
  canRun: boolean;
}

export interface PipelineEditImpact {
  title: string;
  detail: string;
  requiresConfirmation: boolean;
}

function refsIn(value: unknown): { id: string; name: string }[] {
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    ? [{ id: item.id, name: typeof item.name === "string" ? item.name : item.id }]
    : [];
}

function outputIds(step: PipelineStep): string[] {
  return refsIn(step.params.outputs).map((ref) => ref.id);
}

function problem(
  step: PipelineStep,
  dataset: Dataset | null,
  schemaDataset: Dataset | null,
  loadedDatasets: ReadonlyMap<string, Dataset>,
  loaded: ReadonlySet<string>,
  available: ReadonlySet<string>,
  columnCount: number | null,
): string | undefined {
  if (!dataset) return "No active worksheet is available.";
  if (step.kind === "expression") {
    const name = String(step.params.name ?? "").trim();
    const expr = String(step.params.expr ?? "").trim();
    if (!name) return "The output column name is empty.";
    if (!expr) return "The expression is empty.";
    // A preceding transform may change the schema. Validate syntax there but
    // defer exact column compatibility to execution; rejecting against the
    // original input would be a false failure.
    const syntax = validateExpression(expr, columnCount ?? 16_384);
    if (syntax) return syntax;
    return undefined;
  }
  if (step.kind === "fit") {
    if (!String(step.params.model ?? "").trim()) return "The fit model is missing.";
  }
  if (step.kind === "correction") {
    if (schemaDataset?.derivedFrom) {
      return "This input is a derived worksheet; freeze a copy before applying corrections.";
    }
    const bg = step.params.bg as { datasetId?: unknown } | undefined;
    // Correction replay does not translate recorded transform-output IDs the
    // way transformReplay does. Only a worksheet that is loaded right now is
    // a valid background; accepting a prior recorded output here would pass
    // preflight and then fail (or target the wrong sheet) at execution time.
    if (typeof bg?.datasetId === "string" && !loaded.has(bg.datasetId)) {
      return `The background worksheet “${bg.datasetId}” is not loaded.`;
    }
  }
  if (step.kind === "reset" && schemaDataset?.derivedFrom) {
    return "This input is a derived worksheet; its source-owned corrections cannot be reset here.";
  }
  if (step.kind === "transform") {
    try {
      transformParamsOf(step.params);
    } catch (error) {
      return error instanceof Error ? error.message : "The transform settings are invalid.";
    }
    const refs = [
      ...(step.params.inputIsTarget === false ? refsIn(step.params.input) : []),
      ...refsIn(step.params.with),
    ];
    const missing = refs.find((ref) => !available.has(ref.id));
    if (missing) return `Referenced worksheet “${missing.name}” is not loaded and was not produced earlier.`;

    // Catch stale recorded column indices while the step's input schema is
    // knowable. After a shape-changing transform the exact schema is not
    // available without executing it, so that compatibility remains a run-
    // time check instead of being compared with the original worksheet.
    const explicit = step.params.inputIsTarget === false ? refsIn(step.params.input)[0] : undefined;
    const primaryColumns = explicit
      ? loadedDatasets.get(explicit.id)?.data.labels.length ?? null
      : columnCount;
    const channelOnly = [step.params.col];
    if (Array.isArray(step.params.channels)) channelOnly.push(...step.params.channels);
    const withX = [step.params.key, step.params.category, step.params.value, step.params.leftKey];
    const stale = [...channelOnly, ...withX].find((value, index) => {
      if (typeof value !== "number") return false;
      const allowsX = index >= channelOnly.length;
      return value < (allowsX ? -1 : 0) || (primaryColumns !== null && value >= primaryColumns);
    });
    if (typeof stale === "number") return `Column ${stale + 1} is not available in this step's input.`;

    const second = refsIn(step.params.with)[0];
    const rightKey = step.params.rightKey;
    if (second && typeof rightKey === "number") {
      const secondaryColumns = loadedDatasets.get(second.id)?.data.labels.length;
      if (secondaryColumns !== undefined && (rightKey < -1 || rightKey >= secondaryColumns)) {
        return `Column ${rightKey + 1} is not available in “${second.name}”.`;
      }
    }
  }
  return undefined;
}

function stepSummary(step: PipelineStep, dataset: Dataset | null): string {
  if (step.kind === "expression") return `Create “${String(step.params.name ?? "unnamed")}” from ${String(step.params.expr ?? "an empty expression")}.`;
  if (step.kind === "fit") {
    const y = typeof step.params.yKey === "number" ? dataset?.data.labels[step.params.yKey] : undefined;
    return `Fit ${String(step.params.model ?? "an unspecified model")}${y ? ` to ${y}` : " using the recorded or current channel selection"}.`;
  }
  if (step.kind === "correction") {
    const params = step.params.params as Record<string, unknown> | undefined;
    const names = params ? Object.keys(params).filter((key) => params[key] !== undefined) : [];
    return names.length ? `Apply corrections: ${names.join(", ")}.` : "Apply the recorded correction settings.";
  }
  if (step.kind === "reset") return "Remove corrections from the current pipeline output.";
  if (step.kind === "transform") return `Run ${String(step.params.op ?? "an unknown transform")}; later steps use its output.`;
  if (step.kind === "import") return "Marks the recipe input; the interactive runner uses the active worksheet.";
  return "Saved for script export only; this display action is not replayed by Pipeline Studio.";
}

function stepImpact(step: PipelineStep, later: number): string {
  if (step.kind === "transform") return `Changes the pipeline dataset${later ? ` for ${later} later enabled step${later === 1 ? "" : "s"}` : ""}.`;
  if (step.kind === "expression" || step.kind === "correction" || step.kind === "reset") {
    return `Changes the current table${later ? ` before ${later} later enabled step${later === 1 ? "" : "s"}` : ""}.`;
  }
  if (step.kind === "fit") return "Produces a fit result without replacing the pipeline dataset.";
  return "Does not change data during interactive replay.";
}

function compatibilityWarning(step: PipelineStep, columnCount: number | null): string | undefined {
  if (step.kind !== "fit" || columnCount === null) return undefined;
  const yKey = step.params.yKey;
  if (typeof yKey === "number" && Number.isInteger(yKey) && (yKey < 0 || yKey >= columnCount)) {
    return `Recorded Y column ${yKey + 1} is missing; the run will use the current plotted selection.`;
  }
  const xKey = step.params.xKey;
  if (typeof xKey === "number" && Number.isInteger(xKey) && (xKey < 0 || xKey >= columnCount)) {
    return `Recorded X column ${xKey + 1} is missing; the run will use the worksheet X column.`;
  }
  const weight = step.params.weight as { mode?: unknown; errKey?: unknown } | undefined;
  if ((weight?.mode === "yerr" || weight?.mode === "manual") &&
      (typeof weight.errKey !== "number" || weight.errKey < 0 || weight.errKey >= columnCount)) {
    return "The recorded uncertainty column is missing; this fit will run unweighted.";
  }
  return undefined;
}

export function analyzePipeline(steps: readonly PipelineStep[], dataset: Dataset | null, datasets: readonly Dataset[]): PipelineReview {
  const loaded = new Set(datasets.map((item) => item.id));
  const loadedDatasets = new Map(datasets.map((item) => [item.id, item]));
  const available = new Set(loaded);
  let blockedBy: string | null = null;
  let columnCount: number | null = dataset?.data.labels.length ?? null;
  let schemaDataset = dataset;
  const reviews: PipelineStepReview[] = [];
  steps.forEach((step, index) => {
    const later = steps.slice(index + 1).filter((item) => item.enabled && item.kind !== "ui" && item.kind !== "import").length;
    const summary = stepSummary(step, dataset);
    const impact = stepImpact(step, later);
    if (!step.enabled) {
      reviews.push({ id: step.id, state: "disabled", summary, impact, issue: "This step will be skipped." });
      if (step.kind === "transform") blockedBy = step.label;
    } else if (blockedBy) {
      reviews.push({ id: step.id, state: "blocked", summary, impact, issue: `Blocked because “${blockedBy}” will not produce its output.` });
    } else if (step.kind === "ui") {
      reviews.push({ id: step.id, state: "display_only", summary, impact });
    } else if (step.kind === "import") {
      reviews.push({ id: step.id, state: "input", summary, impact });
    } else {
      const issue = problem(step, dataset, schemaDataset, loadedDatasets, loaded, available, columnCount);
      const warning = issue ? undefined : compatibilityWarning(step, columnCount);
      reviews.push({ id: step.id, state: issue ? "invalid" : "ready", summary, impact, issue: issue ?? warning });
      if (issue && step.kind === "transform") blockedBy = step.label;
    }
    const landed = reviews.at(-1)?.state === "ready";
    if (landed && step.kind === "expression" && columnCount !== null) {
      // Propagated expressions append both the value and its sigma column.
      columnCount += step.params.derived === true && step.params.propagate === true ? 2 : 1;
    }
    if (landed && step.kind === "transform") {
      columnCount = null;
      schemaDataset = null;
    }
    for (const id of outputIds(step)) available.add(id);
  });
  return {
    steps: reviews,
    runnable: reviews.filter((step) => step.state === "ready").length,
    displayOnly: reviews.filter((step) => step.state === "display_only").length,
    inputs: reviews.filter((step) => step.state === "input").length,
    disabled: reviews.filter((step) => step.state === "disabled").length,
    invalid: reviews.filter((step) => step.state === "invalid").length,
    blocked: reviews.filter((step) => step.state === "blocked").length,
    canRun: dataset != null && reviews.every((step) => step.state !== "invalid"),
  };
}

export function pipelineEditImpact(
  steps: readonly PipelineStep[],
  stepId: string,
  action: PipelineStructuralAction,
): PipelineEditImpact {
  const index = steps.findIndex((step) => step.id === stepId);
  if (index < 0) return { title: "Step no longer exists", detail: "The pipeline changed before this edit could be applied.", requiresConfirmation: false };
  const step = steps[index];
  const later = steps.slice(index + 1).filter((item) => item.enabled && item.kind !== "ui" && item.kind !== "import").length;
  const structural = step.kind !== "ui" && step.kind !== "import";
  if (action === "remove") return {
    title: `Remove “${step.label}”?`,
    detail: later ? `${later} later enabled step${later === 1 ? "" : "s"} may receive different input.` : "This removes the step from the saved pipeline.",
    requiresConfirmation: structural,
  };
  if (action === "toggle") return {
    title: step.enabled ? `Disable “${step.label}”?` : `Enable “${step.label}”?`,
    detail: step.kind === "transform" && step.enabled
      ? later
        ? `${later} later enabled step${later === 1 ? "" : "s"} will be blocked because the transform output will not exist.`
        : "This transform will not run or produce an output."
      : later
        ? `${later} later enabled step${later === 1 ? "" : "s"} may receive different input.`
        : `This step will be ${step.enabled ? "skipped" : "included"} on the next run.`,
    requiresConfirmation: structural && later > 0,
  };
  return {
    title: `Reorder “${step.label}”?`,
    detail: "Changing step order changes which table and columns this step receives. You can undo this edit.",
    requiresConfirmation: structural && steps.length > 1,
  };
}
