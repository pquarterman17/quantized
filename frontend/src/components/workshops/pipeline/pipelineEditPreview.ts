// Bounded, non-mutating preview for a proposed structural Pipeline Studio
// edit. This deliberately computes on small dataset clones and never calls a
// store action: cancelling the confirmation cannot alter data, history,
// selection, windows, or recorded steps.

import { applyCorrections as applyCorrectionsApi } from "../../../lib/api";
import { deriveColumns } from "../../../lib/derivedColumn";
import { baseColumns } from "../../../lib/formula";
import { recomputeFromBaseOrEmpty } from "../../../lib/formulaInputs";
import type { PipelineStep } from "../../../lib/pipeline";
import { analyzePipeline } from "../../../lib/pipelineStudio";
import { sliceRowSidecars } from "../../../lib/rowSidecars";
import { computeTransformPreview } from "../../../lib/transformPreviewCompute";
import { transformParamsOf, type TransformParams } from "../../../lib/transformRun";
import type { ComputedColumn, CorrectionParams, DataStruct, Dataset } from "../../../lib/types";

export const PIPELINE_PREVIEW_ROWS = 20;
const SAMPLE_ROWS = 3;
const SAMPLE_COLUMNS = 4;
const STEP_CAP = 50;

export interface PipelinePreviewSnapshot {
  name: string;
  rows: number;
  columns: number;
  labels: string[];
  units: string[];
  sample: number[][];
}

export interface PipelineEditPreview {
  status: "ready" | "partial" | "blocked" | "unavailable";
  input: PipelinePreviewSnapshot | null;
  output: PipelinePreviewSnapshot | null;
  warnings: string[];
  capped: boolean;
  canCommit: boolean;
}

function head(data: DataStruct): { data: DataStruct; capped: boolean } {
  // Use the longer side so malformed row arrays are bounded too. Taking the
  // minimum would leave an unexpectedly large values/time array untouched.
  const longest = Math.max(data.time.length, data.values.length);
  const matched = Math.min(data.time.length, data.values.length);
  const limit = Math.min(matched, PIPELINE_PREVIEW_ROWS);
  const capped = longest > PIPELINE_PREVIEW_ROWS;
  if (!capped && data.time.length === data.values.length) return { data, capped: false };
  const indexes = Array.from({ length: limit }, (_, index) => index);
  return {
    data: {
      ...data,
      time: data.time.slice(0, limit),
      values: data.values.slice(0, limit),
      metadata: sliceRowSidecars(data.metadata, indexes),
    },
    capped,
  };
}

class PreviewBlockedError extends Error {}

function boundedDataset(dataset: Dataset): { dataset: Dataset; capped: boolean } {
  const data = head(dataset.data);
  const raw = dataset.raw ? head(dataset.raw) : null;
  return {
    dataset: {
      ...dataset,
      data: data.data,
      ...(raw ? { raw: raw.data } : {}),
      pending: undefined,
    },
    capped: data.capped || Boolean(raw?.capped),
  };
}

function snapshot(dataset: Dataset): PipelinePreviewSnapshot {
  const d = dataset.data;
  const width = Math.min(SAMPLE_COLUMNS, d.labels.length);
  return {
    name: dataset.name,
    rows: d.time.length,
    columns: d.labels.length,
    labels: d.labels.slice(0, width),
    units: d.units.slice(0, width),
    sample: d.values.slice(0, SAMPLE_ROWS).map((row, index) => [d.time[index] ?? Number.NaN, ...row.slice(0, width)]),
  };
}

function recordedRefs(value: unknown): { id: string; name: string }[] {
  if (Array.isArray(value)) return value.flatMap(recordedRefs);
  if (!value || typeof value !== "object") return [];
  const ref = value as Record<string, unknown>;
  return typeof ref.id === "string"
    ? [{ id: ref.id, name: typeof ref.name === "string" ? ref.name : ref.id }]
    : [];
}

function transformRefs(params: TransformParams): { id: string; name: string }[] {
  return "with" in params ? recordedRefs(params.with) : [];
}

function outputIds(step: PipelineStep): string[] {
  return recordedRefs(step.params.outputs).map((output) => output.id);
}

function appendExpression(dataset: Dataset, step: PipelineStep): { dataset: Dataset; warnings: string[] } {
  const name = String(step.params.name ?? "").trim();
  const expr = String(step.params.expr ?? "").trim();
  let columns: ComputedColumn[];
  if (step.params.derived === true) {
    const result = deriveColumns(dataset, {
      name,
      expr,
      propagate: step.params.propagate === true,
      allowUnitMismatch: step.params.allowUnitMismatch === true,
    });
    if (!result.ok) throw new PreviewBlockedError(result.error);
    columns = result.columns;
  } else {
    columns = [{ name, expr }];
  }
  const formulas = [...(dataset.formulas ?? []), ...columns];
  const base = baseColumns(dataset.data, dataset.formulas?.length ?? 0);
  const computed = recomputeFromBaseOrEmpty(base, formulas);
  return {
    dataset: { ...dataset, ...computed, formulas },
    warnings: Object.entries(computed.formulaErrors ?? {}).map(([column, issue]) => `${column}: ${issue}`),
  };
}

async function applyCorrectionPreview(
  dataset: Dataset,
  step: PipelineStep,
  byId: ReadonlyMap<string, Dataset>,
): Promise<Dataset> {
  const formulas = dataset.formulas ?? [];
  const raw = dataset.raw ?? baseColumns(dataset.data, formulas.length);
  const params = (step.params.params ?? {}) as CorrectionParams;
  const bg = step.params.bg as { datasetId?: unknown; interp?: unknown } | undefined;
  const background = typeof bg?.datasetId === "string" ? byId.get(bg.datasetId) : undefined;
  const corrected = await applyCorrectionsApi({
    dataset: raw,
    params,
    error_bindings: dataset.errorRoles,
    ...(background ? {
      bg_dataset: background.data,
      bg_interp: typeof bg?.interp === "string" ? bg.interp : "linear",
    } : {}),
  });
  return {
    ...dataset,
    ...recomputeFromBaseOrEmpty(corrected, formulas),
    raw,
    corrections: params,
  };
}

/** Preview `steps` against `active` without resolving lazy data or mutating
 * the store. The caller ignores stale async completions with its request id. */
export async function previewPipelineEdit(
  steps: readonly PipelineStep[],
  active: Dataset | null,
  datasets: readonly Dataset[],
): Promise<PipelineEditPreview> {
  if (!active) return {
    status: "blocked", input: null, output: null,
    warnings: ["Choose a worksheet before previewing this edit."], capped: false, canCommit: false,
  };
  if (active.pending) return {
    status: "unavailable", input: null, output: null,
    warnings: ["Full data is not loaded. The pipeline edit remains undoable, but a numeric preview is unavailable."],
    capped: false, canCommit: true,
  };
  const review = analyzePipeline(steps, active, datasets);
  const invalid = review.steps.filter((step) => step.state === "invalid");
  if (invalid.length > 0) return {
    status: "blocked",
    input: snapshot(active),
    output: null,
    warnings: invalid.map((step) => step.issue ?? "An invalid step blocks the proposed recipe."),
    capped: false,
    canCommit: false,
  };

  const bounded = datasets.map(boundedDataset);
  const byId = new Map(bounded.map((item) => [item.dataset.id, item.dataset]));
  const sourceById = new Map(datasets.map((item) => [item.id, item]));
  const cappedById = new Map(bounded.map((item) => [item.dataset.id, item.capped]));
  const activeBounded = byId.get(active.id) ?? boundedDataset(active).dataset;
  let current = activeBounded;
  // While the table is still the untouched active worksheet, transforms can
  // inspect the full source. `computeTransformPreview` performs its own
  // bounded materialization but deliberately analyzes every row for warnings.
  // Once a numeric pipeline step changes the table, only the bounded derived
  // result exists in this preview and the source identity must be discarded.
  let currentSourceId: string | null = active.id;
  const input = snapshot(current);
  let capped = cappedById.get(active.id) ?? boundedDataset(active).capped;
  const warnings: string[] = [];
  const produced = new Map<string, Dataset>();
  let partial = false;
  let currentStep = "Pipeline preview";

  const resolveDataset = (id: string, name: string, fullForTransform = false): Dataset => {
    const generated = produced.get(id);
    if (generated) return generated;
    const source = sourceById.get(id);
    if (source?.pending) {
      throw new Error(`“${name}” has not loaded its full data, so this result cannot be previewed yet.`);
    }
    const dataset = byId.get(id);
    if (!dataset) throw new PreviewBlockedError(`The referenced worksheet “${name}” is unavailable.`);
    capped ||= cappedById.get(id) === true;
    return fullForTransform && source ? source : dataset;
  };

  try {
    for (const step of steps.slice(0, STEP_CAP)) {
      currentStep = `“${step.label}”`;
      if (!step.enabled) {
        if (step.kind === "transform") {
          warnings.push(`Preview stops at disabled transform “${step.label}”; later steps will be skipped.`);
          partial = true;
          break;
        }
        continue;
      }
      if (step.kind === "ui" || step.kind === "import" || step.kind === "fit") continue;
      if (step.kind === "expression") {
        const result = appendExpression(current, step);
        current = result.dataset;
        currentSourceId = null;
        warnings.push(...result.warnings.map((warning) => `${currentStep}: ${warning}`));
        continue;
      }
      if (step.kind === "correction") {
        const bg = step.params.bg as { datasetId?: unknown } | undefined;
        if (typeof bg?.datasetId === "string") resolveDataset(bg.datasetId, bg.datasetId);
        current = await applyCorrectionPreview(current, step, byId);
        currentSourceId = null;
        continue;
      }
      if (step.kind === "reset") {
        if (current.raw) {
          current = {
            ...current,
            ...recomputeFromBaseOrEmpty(current.raw, current.formulas),
            raw: undefined,
            corrections: undefined,
            bgRef: undefined,
          };
        }
        currentSourceId = null;
        continue;
      }

      const params = transformParamsOf(step.params);
      if (params.op === "split" || params.op === "promote" || params.op === "metaclean") {
        warnings.push(`A bounded numeric preview is not available past “${step.label}” (${params.op}).`);
        partial = true;
        break;
      }
      const explicit = step.params.inputIsTarget === false
        ? recordedRefs(step.params.input)[0]
        : undefined;
      // These operations have a purpose-built preview implementation that
      // bounds materialization while analyzing warnings against full inputs.
      // Other operations fall back to their real compute path, so keep those
      // on the already-bounded clones to avoid a supposedly lightweight
      // structural preview materializing an entire large worksheet.
      const fullWarningInputs = params.op === "stack" || params.op === "unstack" ||
        params.op === "join" || params.op === "merge";
      const primary = explicit
        ? resolveDataset(explicit.id, explicit.name, fullWarningInputs)
        : currentSourceId
          ? resolveDataset(currentSourceId, current.name, fullWarningInputs)
          : current;
      const others = transformRefs(params).map((ref) => resolveDataset(ref.id, ref.name, fullWarningInputs));
      const computed = await computeTransformPreview(params, primary, others);
      current = { id: `preview-${step.id}`, name: computed.name, data: computed.data };
      currentSourceId = null;
      for (const id of outputIds(step)) produced.set(id, current);
      warnings.push(...computed.preview.warnings.map((warning) => `${currentStep}: ${warning.text}`));
      capped ||= computed.preview.previewCapped === true;
    }
    if (steps.length > STEP_CAP) {
      warnings.push(`Preview stops after ${STEP_CAP} enabled and disabled steps.`);
      partial = true;
    }
    return {
      status: partial ? "partial" : "ready",
      input,
      output: snapshot(current),
      warnings: [...new Set(warnings)],
      capped,
      canCommit: true,
    };
  } catch (error: unknown) {
    const blocked = error instanceof PreviewBlockedError;
    return {
      status: blocked ? "blocked" : "unavailable",
      input,
      output: snapshot(current),
      warnings: [`${currentStep}: ${error instanceof Error ? error.message : "The proposed result could not be previewed."}`],
      capped,
      canCommit: !blocked,
    };
  }
}
