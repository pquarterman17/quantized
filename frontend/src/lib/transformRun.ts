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

import { analyzeMerge } from "./appendWarnings";
import { lit } from "./macro";
import { mergeDatasets } from "./merge";
import type { AppendMatch } from "./mergeByName";
import { IN_PLACE_OPS, metaParamsOf, metaStepText, runMetaStep, type MetaStepParams } from "./metadataRun";
import { analysisData } from "./rowstate";
import { computeResample, resampleLabel, resampleParamsOf, type ResampleParams } from "./transformResample";
import { computeSims, simsLabel, simsParamsOf, type SimsParams } from "./transformSims";
import {
  actionable,
  analyzeAlgebra,
  analyzeJoin,
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
import type { JoinKey, JoinKeyMode } from "./worksheetJoin";
import { askConfirm } from "../store/confirmDialog";
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
  // `keyMode` absent = a step recorded before a categorical key joined by its
  // LEVEL TEXT (worksheetJoin.ts module doc) — it replays with the OLD
  // numeric-code semantics instead, never the new one silently.
  | { op: "join"; leftKey: JoinKey; rightKey: JoinKey; mode: JoinMode; keyMode?: JoinKeyMode; with: DatasetRef }
  // `match` absent = by position (every step recorded before P2.5's preview).
  // `sourceFactor`: the name of an added column saying which input each row
  // came from (P2.5 "Metadata → factors"); absent = no such column.
  | { op: "merge"; with: DatasetRef[]; match?: AppendMatch; sourceFactor?: string }
  | { op: "algebra"; operation: string; interp: string; with: DatasetRef }
  | { op: "split"; col: number; tolerance: number | null }
  | ResampleParams
  | SimsParams
  // In place, no output (lib/metadataRun.ts): a metadata factor / cleanup.
  | MetaStepParams;

/** What the review step sees before anything is committed. */
export interface TransformPreview {
  title: string;
  /** "Result: 12 rows × 3 columns" and similar. */
  summary: string;
  warnings: TransformWarning[];
  /** What the transform read: each input's name and rows x columns (the
   *  analysis rows where that is what it reads). */
  inputs: { name: string; rows: number; cols: number }[];
  /** True only from `lib/transformPreviewCompute.ts`'s bounded LIVE preview
   *  (review finding 5), when the real result is bigger than what got
   *  materialized — never from `computeTransform` itself (Create/replay are
   *  always exact). `ReshapePanel.tsx` shows "Preview shows the first N
   *  rows" when this is true. */
  previewCapped?: boolean;
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
 *  so recording changed no output. Exported for `lib/transformPreviewCompute.ts`,
 *  whose bounded live preview must read the SAME rows the full compute does. */
export const rowsOf = (ds: Dataset): DataStruct => analysisData(ds) ?? ds.data;

function refsOf(p: TransformParams): DatasetRef[] {
  if (p.op === "join" || p.op === "algebra") return [p.with];
  if (p.op === "merge") return p.with;
  if (p.op === "resample") return p.with ? [p.with] : [];
  return [];
}

/** Typed narrowing wrapper over `lib/metadataRun.ts`'s `IN_PLACE_OPS`
 *  (finding #7's shared source) — `transformStepText` and `runTransform`
 *  below use this instead of repeating the two op names. */
export function isInPlaceOp(p: TransformParams): p is MetaStepParams {
  return IN_PLACE_OPS.has(p.op);
}

/** Pipeline label + script line for a transform step. Promote/metaclean
 *  delegate to `lib/metadataRun.ts`'s `metaStepText` (finding #8's single
 *  source) instead of duplicating its shape here. */
export function transformStepText(p: TransformParams, primaryName: string): { label: string; code: string } {
  if (isInPlaceOp(p)) return metaStepText(p);
  const refs = refsOf(p).map((r) => r.name);
  const { op, ...rest } = p;
  const args: Record<string, unknown> = { ...rest };
  if ("with" in args) args.with = Array.isArray(args.with) ? refs : refs[0];
  let label: string;
  switch (p.op) {
    case "join": label = `Join ${primaryName} with ${refs[0]} (${p.mode})`; break;
    case "merge": label = `Append ${refs.join(", ")} to ${primaryName}${p.match === "name" ? " by column name" : ""}`; break;
    case "algebra": label = `Dataset math ${primaryName} ${p.operation} ${refs[0]}`; break;
    case "split": label = `Split ${primaryName} by column value`; break;
    case "resample": label = resampleLabel(p, primaryName); break;
    case "sims": label = simsLabel(p, primaryName); break;
    default: label = `${op[0].toUpperCase()}${op.slice(1)} ${primaryName}`;
  }
  return { label, code: `qz.transform(${lit(op)}, "<active>", ${lit(args)})` };
}

/** One transform's result, before anything is committed. */
export interface TransformComputed {
  data: DataStruct;
  name: string;
  preview: TransformPreview;
}

/** Exported for `lib/transformPreviewCompute.ts`'s bounded preview builders —
 *  they report the SAME "Result: N rows × M columns" shape this does, just
 *  over a (possibly capped) `data` and the caller's own choice of what counts
 *  as "input". */
export function preview(
  title: string,
  data: DataStruct,
  warnings: TransformWarning[],
  inputs: [string, DataStruct][],
): TransformPreview {
  const rows = data.time.length;
  const cols = data.labels.length;
  return {
    title,
    summary: `Result: ${rows} row${rows === 1 ? "" : "s"} × ${cols} column${cols === 1 ? "" : "s"} (plus X).`,
    warnings,
    inputs: inputs.map(([name, d]) => ({ name, rows: d.time.length, cols: d.labels.length })),
  };
}

/** THE compute for every single-output transform: the live preview
 *  (components/workshops/transformPreview), the commit below and the pipeline
 *  replay all call it, so what was previewed is what gets created. It reads
 *  the datasets it is handed as they are — the preview passes a still-loading
 *  book's preview rows, and `runTransform` resolves the full data first. */
export async function computeTransform(p: TransformParams, primary: Dataset, others: Dataset[]): Promise<TransformComputed> {
  const src = rowsOf(primary);
  switch (p.op) {
    case "transpose": {
      const data = transposeWorksheet(src);
      return { data, name: `${primary.name} (transposed)`, preview: preview("Transpose", data, analyzeTranspose(src), [[primary.name, src]]) };
    }
    case "stack": {
      const data = stackWorksheet(src, p.channels);
      return { data, name: `${primary.name} (stacked)`, preview: preview("Stack columns", data, analyzeStack(src, p.channels), [[primary.name, src]]) };
    }
    case "unstack": {
      const data = unstackWorksheet(src, p.key, p.category, p.value, p.aggregate);
      const w = analyzeUnstack(src, p.key, p.category, p.value, p.aggregate);
      return { data, name: `${primary.name} (unstacked)`, preview: preview("Unstack", data, w, [[primary.name, src]]) };
    }
    case "join": {
      const right = others[0];
      const rsrc = rowsOf(right);
      // Absent `keyMode` = a step recorded before the text-key feature
      // existed (module doc on the TransformParams union above): replay it
      // with the OLD numeric-code semantics, not today's default.
      const keyMode = p.keyMode ?? "code";
      const data = joinWorksheets(src, rsrc, p.leftKey, p.rightKey, p.mode, keyMode);
      const w = analyzeJoin(src, rsrc, p.leftKey, p.rightKey, p.mode, primary.name, right.name, keyMode);
      return { data, name: `${primary.name} + ${right.name} (joined)`, preview: preview(`Join (${p.mode})`, data, w, [[primary.name, src], [right.name, rsrc]]) };
    }
    case "merge": {
      const all = [primary, ...others];
      const names = all.map((d) => d.name);
      const data = mergeDatasets(all.map((d) => d.data), names, p.match, p.sourceFactor);
      const w = analyzeMerge(all.map((d) => d.data), names, p.match);
      return { data, name: `merged (${all.length})`, preview: preview(`Append ${all.length} datasets`, data, w, all.map((d) => [d.name, d.data])) };
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
      return { data: stamped, name: `${stem(primary.name)} ${sym} ${stem(b.name)}`, preview: preview("Dataset math", data, w, [[primary.name, primary.data], [b.name, b.data]]) };
    }
    case "resample": {
      // One compute for the workshop's live preview and this commit/replay.
      const m = others[0];
      const r = await computeResample(p, { name: primary.name, data: src }, m ? { name: m.name, data: m.data } : null);
      return { data: r.data, name: r.name, preview: preview("Resample", r.data, r.warnings, [[primary.name, src]]) };
    }
    case "sims": {
      const r = await computeSims(p, { id: primary.id, name: primary.name, data: src });
      return { data: r.data, name: r.name, preview: preview("SIMS processing", r.data, r.warnings, [[primary.name, src]]) };
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
  /** The pipeline-log line for an in-place op (no dataset was created). */
  note?: string;
  /** Finding #4: true only for an in-place `metaclean` replay whose rules
   *  were all refused — `executeSteps.ts` logs the step "warn" instead of
   *  "ok" when this is set. */
  refused?: boolean;
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
  if (isInPlaceOp(p)) {
    const { note, refused } = await runMetaStep(s, p, primaryId);
    return {
      id: primaryId,
      name: s().datasets.find((d) => d.id === primaryId)?.name ?? primaryId,
      warnings: [],
      outputs: [],
      note,
      ...(refused ? { refused: true } : {}),
    };
  }
  const primary = await s().resolveDataset(primaryId);
  if (!primary) throw new Error("the input dataset is unavailable");
  const others = await resolveRefs(s, refsOf(p));
  const c = await computeTransform(p, primary, others);
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

const OPS = new Set(["transpose", "stack", "unstack", "join", "merge", "algebra", "split", "resample", "sims", "promote", "metaclean"]);

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
      // A key is a column index, or a text column's name (lib/worksheetJoin).
      const key = (k: string): JoinKey => (typeof raw[k] === "string" && raw[k] ? (raw[k] as string) : num(k));
      // Absent (an older recording) is NOT normalized to a default here —
      // `computeTransform` is the one place that decides what "absent" means
      // (the OLD numeric-code semantics), so a step this function round-trips
      // (read then re-recorded verbatim) cannot accidentally gain a field it
      // never had.
      const km = raw.keyMode;
      const keyMode = km === "text" || km === "code" ? km : undefined;
      return { op, leftKey: key("leftKey"), rightKey: key("rightKey"), mode: mode as JoinMode, ...(keyMode ? { keyMode } : {}), with: ref(raw.with) };
    }
    case "merge": {
      if (!Array.isArray(raw.with) || !raw.with.length) throw new Error('transform "merge" has no recorded inputs');
      const match = String(raw.match ?? "position");
      if (match !== "position" && match !== "name") throw new Error(`unknown append match "${match}"`);
      const sf = typeof raw.sourceFactor === "string" && raw.sourceFactor.trim() ? { sourceFactor: raw.sourceFactor } : {};
      return { op, with: raw.with.map(ref), ...(match === "name" ? { match } : {}), ...sf };
    }
    case "algebra":
      return { op, operation: String(raw.operation ?? ""), interp: String(raw.interp ?? "pchip"), with: ref(raw.with) };
    case "resample":
      return resampleParamsOf(raw);
    case "sims":
      return simsParamsOf(raw);
    case "promote":
    case "metaclean":
      return metaParamsOf(raw);
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
  const pv = preview(`Append ${datas.length} files`, data, warnings, datas.map((d, i) => [names[i], d]));
  pv.summary += " Cancel imports them as separate datasets instead.";
  return (await reviewTransform(pv)) ? stampWarnings(data, "merge", warnings) : null;
}
