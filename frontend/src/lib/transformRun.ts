// Recordable combine/reshape operations (audit P2.5 — "saved transformation
// recipe, undo, provenance, derived output" + "warnings for duplicate keys,
// unit mismatch, or row loss"). ONE commit path for transpose / stack /
// unstack / join / merge (append) / dataset algebra, shared by the
// interactive commands AND the pipeline replay (`executeSteps`), so a
// recorded step replays through exactly the code that produced it:
//
//   resolve inputs -> compute the derived data -> analyze (lib/transformWarnings)
//   -> [interactive only] review the warnings -> addDataset (one undo entry,
//   warnings stamped into metadata) -> record a `transform` pipeline step.
//
// Split lives in the store (`splitDatasetByColumn`, which folders its
// children); its step shape is defined here and it records itself.
//
// DATASET REFERENCES (multi-input ops). The pipeline's one existing reference
// model is a dataset id — a `correction` step's background is
// `bg: {datasetId}` and replays by looking that id up. Join / merge / algebra
// record their SECOND inputs the same way (`with: {id, name}`; the name is for
// display only). The PRIMARY input is the pipeline's current target when it
// was the active dataset at recording time (so a template batch joins/merges
// each file with the recorded second input); otherwise it too is an explicit
// reference (`recordedProvenance`). A reference whose dataset is no longer in
// the workspace fails that step with a message naming it — never a guess by
// name — and a reference to a dataset an EARLIER step created is rewritten to
// that step's replay output (lib/transformReplay.ts).
//
// Lazy on purpose: only reached from Data-menu commands, the dataset-math
// workshop, the merge action and the pipeline runner — all post-click.

import { datasetAlgebra } from "./api/datasetAlgebra";

import { lit } from "./macro";
import { mergeDatasets } from "./merge";
import { analysisData } from "./rowstate";
import { computeResample, resampleLabel, resampleParamsOf, type ResampleParams } from "./transformResample";
import {
  actionable,
  analyzeAlgebra,
  analyzeJoin,
  analyzeMerge,
  analyzeStack,
  analyzeTranspose,
  analyzeUnstack,
  needsConfirm,
  stampWarnings,
  warningsText,
  type TransformWarning,
} from "./transformWarnings";
import type { DataStruct, Dataset } from "./types";
import {
  joinWorksheets,
  stackWorksheet,
  transposeWorksheet,
  unstackWorksheet,
  type AggregateMode,
  type JoinMode,
} from "./worksheetTransforms";
import { askConfirm } from "../store/confirmDialog";
import { toast } from "../store/toasts";
import { nextDatasetId, type AppState } from "../store/useApp";

/** The store accessor. Typed on the `AppState` interface, not
 *  `typeof useApp.getState`: `useApp.ts` lazily imports this module, and the
 *  latter would make the store's own type circular. */
type StoreGet = () => AppState;

export interface DatasetRef {
  id: string;
  name: string;
}

export type TransformParams =
  | { op: "transpose" }
  | { op: "stack"; channels: number[] }
  | { op: "unstack"; key: number; category: number; value: number; aggregate: AggregateMode }
  | { op: "join"; leftKey: number; rightKey: number; mode: JoinMode; with: DatasetRef }
  | { op: "merge"; with: DatasetRef[] }
  | { op: "algebra"; operation: string; interp: string; with: DatasetRef }
  | { op: "split"; col: number; tolerance: number | null }
  | ResampleParams;

/** What the review step sees before anything is committed. */
export interface TransformPreview {
  title: string;
  /** "Result: 12 rows × 3 columns" and similar. */
  summary: string;
  warnings: TransformWarning[];
}

/** Returns true to commit. Interactive callers pass `reviewTransform`;
 *  replay passes nothing (warnings are still stamped and logged). */
export type ReviewFn = (preview: TransformPreview) => Promise<boolean>;

export const ALGEBRA_SYMBOL: Record<string, string> = {
  "A+B": "+", "A-B": "−", "A*B": "×", "A/B": "/", "(A-B)/(A+B)": "asym",
};

const stem = (name: string): string => name.replace(/\.[^.]+$/, "");

/** The dataset's ANALYSIS rows (exclusion ∪ filter pruned) — the reshape
 *  commands have always derived from these (architecture-guards #11). Merge
 *  and algebra have always used `.data`; both are kept exactly as they were,
 *  so recording changed no output. */
const rowsOf = (ds: Dataset): DataStruct => analysisData(ds) ?? ds.data;

function refsOf(p: TransformParams): DatasetRef[] {
  if (p.op === "join" || p.op === "algebra") return [p.with];
  if (p.op === "merge") return p.with;
  if (p.op === "resample") return p.with ? [p.with] : [];
  return [];
}

/** Pipeline label + script line for a transform step. */
export function transformStepText(p: TransformParams, primaryName: string): { label: string; code: string } {
  const refs = refsOf(p).map((r) => r.name);
  const { op, ...rest } = p;
  const args: Record<string, unknown> = { ...rest };
  if ("with" in args) args.with = Array.isArray(args.with) ? refs : refs[0];
  let label: string;
  switch (p.op) {
    case "join": label = `Join ${primaryName} with ${refs[0]} (${p.mode})`; break;
    case "merge": label = `Append ${refs.join(", ")} to ${primaryName}`; break;
    case "algebra": label = `Dataset math ${primaryName} ${p.operation} ${refs[0]}`; break;
    case "split": label = `Split ${primaryName} by column value`; break;
    case "resample": label = resampleLabel(p, primaryName); break;
    default: label = `${op[0].toUpperCase()}${op.slice(1)} ${primaryName}`;
  }
  return { label, code: `qz.transform(${lit(op)}, "<active>", ${lit(args)})` };
}

interface Computed {
  data: DataStruct;
  name: string;
  preview: TransformPreview;
}

function preview(title: string, data: DataStruct, warnings: TransformWarning[]): TransformPreview {
  const rows = data.time.length;
  const cols = data.labels.length;
  return { title, summary: `Result: ${rows} row${rows === 1 ? "" : "s"} × ${cols} column${cols === 1 ? "" : "s"} (plus X).`, warnings };
}

async function compute(p: TransformParams, primary: Dataset, others: Dataset[]): Promise<Computed> {
  const src = rowsOf(primary);
  switch (p.op) {
    case "transpose": {
      const data = transposeWorksheet(src);
      return { data, name: `${primary.name} (transposed)`, preview: preview("Transpose", data, analyzeTranspose(src)) };
    }
    case "stack": {
      const data = stackWorksheet(src, p.channels);
      return { data, name: `${primary.name} (stacked)`, preview: preview("Stack columns", data, analyzeStack(src, p.channels)) };
    }
    case "unstack": {
      const data = unstackWorksheet(src, p.key, p.category, p.value, p.aggregate);
      const w = analyzeUnstack(src, p.key, p.category, p.value, p.aggregate);
      return { data, name: `${primary.name} (unstacked)`, preview: preview("Unstack", data, w) };
    }
    case "join": {
      const right = others[0];
      const rsrc = rowsOf(right);
      const data = joinWorksheets(src, rsrc, p.leftKey, p.rightKey, p.mode);
      const w = analyzeJoin(src, rsrc, p.leftKey, p.rightKey, p.mode, primary.name, right.name);
      return { data, name: `${primary.name} + ${right.name} (joined)`, preview: preview(`Join (${p.mode})`, data, w) };
    }
    case "merge": {
      const all = [primary, ...others];
      const names = all.map((d) => d.name);
      const data = mergeDatasets(all.map((d) => d.data), names);
      const w = analyzeMerge(all.map((d) => d.data), names);
      return { data, name: `merged (${all.length})`, preview: preview(`Append ${all.length} datasets`, data, w) };
    }
    case "algebra": {
      const b = others[0];
      const data = await datasetAlgebra({
        dataset_a: primary.data,
        dataset_b: b.data,
        operation: p.operation,
        interp_method: p.interp,
      });
      const sym = ALGEBRA_SYMBOL[p.operation] ?? p.operation;
      const w = analyzeAlgebra(primary.data, b.data, p.operation, primary.name, b.name);
      const stamped = { ...data, metadata: { ...data.metadata, algebra_operands: [primary.name, b.name] } };
      return { data: stamped, name: `${stem(primary.name)} ${sym} ${stem(b.name)}`, preview: preview("Dataset math", data, w) };
    }
    case "resample": {
      // One compute for the workshop's live preview and this commit/replay.
      const m = others[0];
      const r = await computeResample(p, { name: primary.name, data: src }, m ? { name: m.name, data: m.data } : null);
      return { data: r.data, name: r.name, preview: preview("Resample", r.data, r.warnings) };
    }
    default:
      throw new Error(`"${p.op}" is not a single-output transform`);
  }
}

/** Resolve the recorded second inputs (bounded concurrency, like the old
 *  merge path), in order, failing by NAME on the first one that is gone. */
async function resolveRefs(s: StoreGet, refs: readonly DatasetRef[]): Promise<Dataset[]> {
  const missing = refs.find((r) => !s().datasets.some((d) => d.id === r.id));
  if (missing) throw new Error(`the recorded input "${missing.name}" is not in this workspace`);
  const got = await s().resolveDatasets(refs.map((r) => r.id));
  return refs.map((r) => {
    const ds = got.find((d) => d.id === r.id);
    if (!ds) throw new Error(`the recorded input "${r.name}" could not be loaded`);
    return ds;
  });
}

/** Interactive review: silent when there is nothing to say; a unit mismatch
 *  gets a danger-styled confirm whose button names what is being overridden. */
export function reviewTransform(pv: TransformPreview): Promise<boolean> {
  if (!actionable(pv.warnings).length) return Promise.resolve(true);
  const units = needsConfirm(pv.warnings);
  return askConfirm(
    units ? `${pv.title}: units differ` : `${pv.title}: review before creating`,
    warningsText(pv.summary, pv.warnings),
    units ? "Create despite unit mismatch" : "Create",
    units,
  );
}

/** One dataset a transform created. `key` tells replay which output is which
 *  when there are several: a split child's group label ("5 K"), "" otherwise. */
export interface TransformOutput {
  id: string;
  key: string;
}

export interface TransformOutcome {
  /** The output later steps continue on (a split's first child). */
  id: string;
  name: string;
  warnings: TransformWarning[];
  outputs: TransformOutput[];
}

/** The provenance a recorded `transform` step carries beside its op params
 *  (lib/transformReplay.ts reads it back):
 *   - `input`: the primary input as recorded;
 *   - `inputIsTarget`: whether that input was the ACTIVE dataset — i.e. the
 *     pipeline's target — when recorded. Only then does replay apply the step
 *     to the run's target; otherwise `input` is an explicit reference (Dataset
 *     Math with A not active, Merge selected whose first pick is not active),
 *     resolved or refused on replay, never silently swapped for the target;
 *   - `outputs`: the datasets it created, so a later step's reference to one
 *     of them is rewritten to the replay's own output. */
export function recordedProvenance(
  input: { id: string; name: string },
  inputIsTarget: boolean,
  outputs: readonly TransformOutput[],
): Record<string, unknown> {
  return { input: { id: input.id, name: input.name }, inputIsTarget, outputs: outputs.map((o) => ({ ...o })) };
}

/** Run one transform with `primaryId` as its primary input. Returns null when
 *  the review declined; throws on bad input (callers surface the message). */
export async function runTransform(
  s: StoreGet,
  p: TransformParams,
  primaryId: string,
  review?: ReviewFn,
): Promise<TransformOutcome | null> {
  if (p.op === "split") {
    if (!s().datasets.some((d) => d.id === primaryId)) throw new Error("the input dataset is unavailable");
    const ids = await s().splitDatasetByColumn(primaryId, p.col, p.tolerance ?? undefined);
    // The store action already said why (a notification): fewer than two
    // groups, or more than the group cap. Point at it rather than guess.
    if (!ids.length) throw new Error("the split was refused — see the notification for why");
    const children = ids.map((cid) => s().datasets.find((d) => d.id === cid));
    const w = children[0]?.data.metadata?.transform_warnings;
    return {
      id: ids[0],
      name: children[0]?.name ?? ids[0],
      warnings: Array.isArray(w) ? w.map((text) => ({ code: "missing-split-key" as const, text: String(text) })) : [],
      outputs: ids.map((cid, k) => ({ id: cid, key: String(children[k]?.data.metadata?.split_group ?? "") })),
    };
  }
  const primary = await s().resolveDataset(primaryId);
  if (!primary) throw new Error("the input dataset is unavailable");
  const others = await resolveRefs(s, refsOf(p));
  const c = await compute(p, primary, others);
  if (review && !(await review(c.preview))) {
    s().setStatus(`${c.preview.title} cancelled — nothing was created`);
    return null;
  }
  // Read BEFORE addDataset, which makes the output active.
  const inputIsTarget = s().activeId === primary.id;
  const id = nextDatasetId();
  s().addDataset({ id, name: c.name, data: stampWarnings(c.data, p.op, c.preview.warnings) });
  const { label, code } = transformStepText(p, primary.name);
  const outputs = [{ id, key: "" }];
  s().recordMacro(label, code, {
    kind: "transform",
    params: { ...p, ...recordedProvenance(primary, inputIsTarget, outputs) },
  });
  s().setStatus(`created ${c.name}${recordedNote(c.preview.warnings)}`);
  return { id, name: c.name, warnings: c.preview.warnings, outputs };
}

/** " — N warnings recorded in its metadata" (every stamped warning, info
 *  included — the metadata holds them all), or "" when there are none. */
function recordedNote(warnings: readonly TransformWarning[]): string {
  const n = warnings.length;
  return n ? ` — ${n} warning${n === 1 ? "" : "s"} recorded in its metadata` : "";
}

const OPS = new Set(["transpose", "stack", "unstack", "join", "merge", "algebra", "split", "resample"]);

/** Validate a recorded `transform` step's params (a .dwk / template is user-
 *  editable JSON) into `TransformParams`, or throw naming what is wrong. */
export function transformParamsOf(raw: Record<string, unknown>): TransformParams {
  const op = String(raw.op ?? "");
  if (!OPS.has(op)) throw new Error(`unknown transform "${op}"`);
  const num = (k: string): number => {
    const v = raw[k];
    if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(`transform "${op}" needs an integer "${k}"`);
    return v;
  };
  const ref = (v: unknown): DatasetRef => {
    const o = (v ?? {}) as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id) throw new Error(`transform "${op}" has no recorded second input`);
    return { id: o.id, name: typeof o.name === "string" ? o.name : o.id };
  };
  switch (op) {
    case "transpose": return { op };
    case "stack": {
      const ch = raw.channels;
      if (!Array.isArray(ch) || !ch.length || !ch.every((c) => Number.isInteger(c))) {
        throw new Error('transform "stack" needs integer "channels"');
      }
      return { op, channels: ch as number[] };
    }
    case "unstack": {
      const agg = String(raw.aggregate ?? "mean");
      if (!["mean", "first", "last"].includes(agg)) throw new Error(`unknown aggregate "${agg}"`);
      return { op, key: num("key"), category: num("category"), value: num("value"), aggregate: agg as AggregateMode };
    }
    case "join": {
      const mode = String(raw.mode ?? "inner");
      if (!["inner", "left", "right", "full"].includes(mode)) throw new Error(`unknown join mode "${mode}"`);
      return { op, leftKey: num("leftKey"), rightKey: num("rightKey"), mode: mode as JoinMode, with: ref(raw.with) };
    }
    case "merge": {
      if (!Array.isArray(raw.with) || !raw.with.length) throw new Error('transform "merge" has no recorded inputs');
      return { op, with: raw.with.map(ref) };
    }
    case "algebra":
      return { op, operation: String(raw.operation ?? ""), interp: String(raw.interp ?? "pchip"), with: ref(raw.with) };
    case "resample":
      return resampleParamsOf(raw);
    default: {
      const tol = raw.tolerance;
      return { op: "split", col: num("col"), tolerance: typeof tol === "number" && Number.isFinite(tol) ? tol : null };
    }
  }
}

/** Import-time append (`importFilesAppended`): the same by-position merge and
 *  review as "Merge selected", for files that are not datasets yet (so not
 *  recordable by id — that path records its own `import` step). Null when the
 *  review is declined. */
export async function reviewedAppend(datas: DataStruct[], names: string[]): Promise<DataStruct | null> {
  const data = mergeDatasets(datas, names);
  const warnings = analyzeMerge(datas, names);
  const pv = preview(`Append ${datas.length} files`, data, warnings);
  pv.summary += " Cancel imports them as separate datasets instead.";
  return (await reviewTransform(pv)) ? stampWarnings(data, "merge", warnings) : null;
}

/** "Merge selected" (Data menu / Library): append the selection in order,
 *  reviewing unit/label mismatches first. The first pick is the primary. */
export async function runMergeSelected(s: StoreGet): Promise<void> {
  const st = s();
  const pickIds = st.selectedIds.filter((id) => st.datasets.some((d) => d.id === id));
  if (pickIds.length < 2) {
    st.setStatus("select ≥2 datasets to merge");
    return;
  }
  try {
    // #38 deferred edge: resolve every still-pending pick first (bounded
    // concurrency) rather than silently merging previews.
    const picks = await s().resolveDatasets(pickIds);
    if (picks.length < 2) {
      s().setStatus("select ≥2 datasets to merge");
      return;
    }
    const [first, ...rest] = picks;
    const out = await runTransform(s, { op: "merge", with: rest.map((d) => ({ id: d.id, name: d.name })) }, first.id, reviewTransform);
    if (!out) return;
    const rows = s().datasets.find((d) => d.id === out.id)?.data.time.length ?? 0;
    s().setStatus(`merged ${picks.length} datasets → ${rows} rows${recordedNote(out.warnings)}`);
    toast(`merged ${picks.length} datasets`, "ok");
  } catch (e) {
    const msg = `could not merge the selected datasets: ${e instanceof Error ? e.message : "unknown error"} — nothing was added`;
    s().setStatus(msg);
    toast(msg, "danger");
  }
}
