// Pipeline panel — the editable-field schema of a recorded `transform` step
// (audit P2.5: "editing a transform step's params in the Pipeline panel").
// Pure tables + one validator; the view is TransformStepEditor.tsx.
//
// What is a field: every SCALAR parameter the op's own workshop offers (a
// column, a mode, an aggregate, a grid size). What is not: a dataset
// reference (a join's right side, an append's inputs, dataset math's B, a
// resample match), a key mapping, SIMS' nested settings and metadata-cleanup
// rule lists — those get a one-sentence note and an "Open in workshop" route.
//
// Validation and the regenerated label/script line come from lib/transformRun
// (`transformParamsOf`, `transformStepText`): the SAME validator a replay runs,
// so an edit the panel accepts is exactly what the next run executes. Lazy
// (with TransformStepEditor) — transformRun stays out of the panel's chunk.

import { OPERATIONS } from "../datasetmath/useDatasetMath";
import { MODE_OPTIONS, OUT_OF_RANGE_OPTIONS } from "../resample/resampleForm";
import { RESAMPLE_METHODS } from "../../../lib/transformResample";
import { transformParamsOf, transformStepText } from "../../../lib/transformRun";

export interface Option {
  value: string;
  label: string;
}

export type FieldSpec =
  | { key: string; label: string; type: "text" | "number" | "bool" | "columns" }
  | { key: string; label: string; type: "column"; withX?: boolean }
  | { key: string; label: string; type: "select"; options: Option[]; fallback: string };

/** Where "Open in workshop" goes for an op with structured params. */
export type WorkshopRoute = "join" | "merge" | "algebra" | "sims" | "meta";

export interface TransformForm {
  fields: FieldSpec[];
  note?: string;
  workshop?: WorkshopRoute;
}

const opts = (vs: readonly string[]): Option[] => vs.map((v) => ({ value: v, label: v }));
const select = (key: string, label: string, options: Option[], fallback = options[0].value): FieldSpec => ({
  key,
  label,
  type: "select",
  options,
  fallback,
});

function resampleFields(d: Record<string, unknown>): FieldSpec[] {
  // "match" needs a recorded dataset to match; it is offered only when the
  // step has one (picking a dataset is the workshop's job).
  const modes = MODE_OPTIONS.filter((m) => m.value !== "match" || d.with !== undefined);
  const f: FieldSpec[] = [select("mode", "grid", modes)];
  if (d.mode === "n_points") f.push({ key: "nPoints", label: "points", type: "number" });
  if (d.mode === "range") {
    f.push({ key: "start", label: "start", type: "number" }, { key: "stop", label: "stop", type: "number" });
  }
  if (d.mode === "step" || d.mode === "range") f.push({ key: "step", label: "step", type: "number" });
  f.push(
    select("method", "interpolation", opts(RESAMPLE_METHODS)),
    select("outOfRange", "outside the data", OUT_OF_RANGE_OPTIONS),
    { key: "sortUnsorted", label: "sort x that reverses direction", type: "bool" },
  );
  return f;
}

/** The form for a step's (draft) params. Resample's fields follow its grid. */
export function transformForm(d: Record<string, unknown>): TransformForm {
  switch (String(d.op ?? "")) {
    case "transpose":
      return { fields: [], note: "Transpose has no parameters." };
    case "stack":
      return { fields: [{ key: "channels", label: "columns to stack", type: "columns" }] };
    case "unstack":
      return {
        fields: [
          { key: "key", label: "row key", type: "column", withX: true },
          { key: "category", label: "category column", type: "column", withX: true },
          { key: "value", label: "value column", type: "column", withX: true },
          select("aggregate", "duplicate cells", opts(["mean", "first", "last"])),
        ],
      };
    case "join":
      return {
        fields: [select("mode", "rows to retain", opts(["inner", "left", "right", "full"]))],
        note: "Join keys and the right dataset are set in the workshop.",
        workshop: "join",
      };
    case "merge":
      return {
        fields: [
          select("match", "match columns", opts(["position", "name"])),
          { key: "sourceFactor", label: "source column (blank = none)", type: "text" },
        ],
        note: "The appended datasets are chosen in the workshop.",
        workshop: "merge",
      };
    case "algebra":
      return {
        fields: [select("operation", "operation", OPERATIONS), select("interp", "interpolation", opts(["pchip", "linear", "spline"]))],
        note: "Dataset B is chosen in the workshop.",
        workshop: "algebra",
      };
    case "split":
      return {
        fields: [
          { key: "col", label: "split column", type: "column" },
          { key: "tolerance", label: "tolerance (blank = exact)", type: "number" },
        ],
      };
    case "resample":
      return { fields: resampleFields(d) };
    case "promote":
      return {
        fields: [{ key: "name", label: "column name", type: "text" }, select("as", "factor type", opts(["categorical", "numeric"]))],
      };
    case "metaclean":
      return { fields: [], note: "Cleanup rules are edited in the Metadata → factors workshop.", workshop: "meta" };
    case "sims":
    case "simscompare":
      return { fields: [], note: "SIMS settings are nested; edit them in the SIMS workshop.", workshop: "sims" };
    default:
      return { fields: [] };
  }
}

/** Recording provenance a transform step carries beside its op params
 *  (lib/transformRun.recordedProvenance; `datasets` for metadata ops). */
const PROVENANCE = ["input", "inputIsTarget", "outputs", "datasets"] as const;

export type TransformEdit =
  | { ok: true; params: Record<string, unknown>; text: { label: string; code: string } }
  | { ok: false; error: string };

/** Validate a draft through the replay's own validator. The stored params
 *  are what the replay reads plus the recorded provenance, so a leftover
 *  from another resample grid is not kept. */
export function checkTransformEdit(draft: Record<string, unknown>): TransformEdit {
  try {
    const p = transformParamsOf(draft);
    const kept = Object.fromEntries(PROVENANCE.filter((k) => k in draft).map((k) => [k, draft[k]]));
    const input = draft.input as { name?: unknown } | undefined;
    const primary = typeof input?.name === "string" ? input.name : "dataset";
    return { ok: true, params: { ...p, ...kept }, text: transformStepText(p, primary) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Column options for a column field over `labels`; a recorded index the
 *  current dataset does not have is kept as "column N". */
export function columnOptions(labels: readonly string[], withX: boolean, keep: readonly number[]): Option[] {
  const out: Option[] = labels.map((l, i) => ({ value: String(i), label: l || `column ${i + 1}` }));
  if (withX) out.unshift({ value: "-1", label: "X (x)" });
  for (const k of keep) {
    if (!out.some((o) => o.value === String(k))) out.push({ value: String(k), label: `column ${k + 1}` });
  }
  return out;
}
