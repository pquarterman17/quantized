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
import { blanksToNaN } from "./blankCells";
import { mergeDatasets } from "./merge";
import type { AppendMatch } from "./mergeByName";
import { runMetaStep, type MetaStepParams } from "./metadataRun";
import { analysisData } from "./rowstate";
import { findSignalDuplicate, signalSourceGuard } from "./signalOutputGuard";
import {
  computeSignalTransform,
  signalRecipeInputData,
  signalTransformStepText,
  type SignalBindOptions,
  type SignalTransformParams,
} from "./signalTransform";
import { computeAverage, type AverageParams } from "./transformAverage";
import { cleanLabel, computeClean, type CleanParams } from "./transformClean";
import { computeResample, type ResampleParams } from "./transformResample";
import { reviewTransform } from "./transformReview";
import { ALGEBRA_SYMBOL, isInPlaceOp, refsOf, transformStepText } from "./transformStepText";
import { computeSigop, sigopLabel, type SigopParams } from "./transformSigop";
import { computeSpectrogram, spectrogramLabel, type SpectrogramParams } from "./transformSpectrogram";
import { computeSims, type SimsParams } from "./transformSims";
import { computeSimsAlign, type SimsAlignParams } from "./transformSimsAlign";
import { computeSimsCompare, type SimsCompareParams } from "./transformSimsCompare";
import {
  analyzeAlgebra,
  analyzeJoin,
  analyzeStack,
  analyzeTranspose,
  analyzeUnstack,
  stampWarnings,
  type TransformWarning,
} from "./transformWarnings";
import type { DataStruct, Dataset } from "./types";
import { joinWorksheets, stackWorksheet, transposeWorksheet, unstackWorksheet, type AggregateMode, type JoinMode } from "./worksheetTransforms";
import type { JoinKey, JoinKeyMode } from "./worksheetJoin";
import { nextDatasetId, type AppState } from "../store/useApp";

export { transformParamsOf } from "./transformParams";
export { ALGEBRA_SYMBOL, isInPlaceOp, refsOf, transformStepText };

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
  | { op: "unstack"; key: number; category: JoinKey; value: number; aggregate: AggregateMode }
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
  | SigopParams
  | SpectrogramParams
  | SimsParams
  | SimsCompareParams
  | SimsAlignParams
  | AverageParams
  | CleanParams
  | SignalTransformParams
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
  /** With `previewCapped`: the row count of the FULL result, so the summary
   *  states the real size rather than the truncated table's. */
  resultRows?: number;
}

/** Returns true to commit. Interactive callers pass `reviewTransform`;
 *  replay passes nothing (warnings are still stamped and logged). */
export type ReviewFn = (preview: TransformPreview) => Promise<boolean>;

const stem = (name: string): string => name.replace(/\.[^.]+$/, "");

/** The dataset's ANALYSIS rows (exclusion ∪ filter pruned) — the reshape
 *  commands have always derived from these (architecture-guards #11). Merge
 *  and algebra have always used `.data`; both are kept exactly as they were,
 *  so recording changed no output. Exported for `lib/transformPreviewCompute.ts`,
 *  whose bounded live preview must read the SAME rows the full compute does. */
export const rowsOf = (ds: Dataset): DataStruct => analysisData(ds) ?? ds.data;

/** One transform's result, before anything is committed. */
export interface TransformComputed {
  data: DataStruct;
  name: string;
  preview: TransformPreview;
  /** Optional linked-output fields carried into the created Dataset. */
  datasetPatch?: Partial<Dataset>;
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
export async function computeTransform(
  p: TransformParams,
  primary: Dataset,
  others: Dataset[],
  signal?: AbortSignal,
  options?: SignalBindOptions,
): Promise<TransformComputed> {
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
      // A non-finite result (a divide by zero, log/sqrt of an out-of-domain
      // value) arrives as JSON null; stored as NaN so the `.dwk` reopens --
      // the same fix `transformSims.ts`/`transformResample.ts` apply
      // (lib/blankCells.ts).
      const data = blanksToNaN(await datasetAlgebra({
        dataset_a: primary.data,
        dataset_b: b.data,
        operation: p.operation,
        interp_method: p.interp,
      }));
      const sym = ALGEBRA_SYMBOL[p.operation] ?? p.operation;
      const w = analyzeAlgebra(primary.data, b.data, p.operation, primary.name, b.name);
      const stamped = { ...data, metadata: { ...data.metadata, algebra_operands: [primary.name, b.name] } };
      return { data: stamped, name: `${stem(primary.name)} ${sym} ${stem(b.name)}`, preview: preview("Dataset math", data, w, [[primary.name, primary.data], [b.name, b.data]]) };
    }
    case "resample": {
      // One compute for the workshop's live preview and this commit/replay.
      const m = others[0];
      const r = await computeResample(p, { name: primary.name, data: src }, m ? { name: m.name, data: m.data } : null, { signal });
      return { data: r.data, name: r.name, preview: preview("Resample", r.data, r.warnings, [[primary.name, src]]) };
    }
    case "sigop": {
      const r = await computeSigop(p, { name: primary.name, data: src }, { signal });
      return { data: r.data, name: r.name, preview: preview(sigopLabel(p, primary.name), r.data, r.warnings, [[primary.name, src]]) };
    }
    case "spectrogram": {
      const r = await computeSpectrogram(p, { name: primary.name, data: src }, { signal });
      return { data: r.data, name: r.name, preview: preview(spectrogramLabel(primary.name), r.data, [], [[primary.name, src]]) };
    }
    case "dedupe": case "fillmissing": case "standardize": {
      const r = computeClean(p, { name: primary.name, data: src });
      return { data: r.data, name: r.name, preview: preview(cleanLabel(p, primary.name), r.data, r.warnings, [[primary.name, src]]) };
    }
    case "sims": {
      const r = await computeSims(p, { id: primary.id, name: primary.name, data: src });
      return { data: r.data, name: r.name, preview: preview("SIMS processing", r.data, r.warnings, [[primary.name, src]]) };
    }
    case "simscompare": {
      // Every profile's ANALYSIS rows, as the single-profile `sims` op reads.
      const all = [primary, ...others].map((d) => ({ id: d.id, name: d.name, data: rowsOf(d) }));
      const r = await computeSimsCompare(p, all);
      return { data: r.data, name: r.name, preview: preview("SIMS comparison", r.data, r.warnings, all.map((d) => [d.name, d.data])) };
    }
    case "simsalign": {
      // Same inputs as the comparison: each profile's ANALYSIS rows, primary first.
      const all = [primary, ...others].map((d) => ({ id: d.id, name: d.name, data: rowsOf(d) }));
      const r = await computeSimsAlign(p, all, { signal });
      return { data: r.data, name: r.name, preview: preview("SIMS alignment", r.data, r.warnings, all.map((d) => [d.name, d.data])) };
    }
    case "average": {
      // Each curve's ANALYSIS rows; SEM is bound as the mean's error (datasetPatch).
      const all = [primary, ...others].map((d) => ({ name: d.name, data: rowsOf(d) }));
      const r = await computeAverage(p, all, { signal });
      return { data: r.data, name: r.name, preview: preview("Average curves", r.data, r.warnings, all.map((d) => [d.name, d.data])), datasetPatch: r.datasetPatch };
    }
    case "signal": {
      // Signal Processing reads the full worksheet unless its recipe says
      // `inputRows: "analysis-view"` (the "Use excluded/filtered rows" option
      // is off). The recipe is the record, so replay and recompute agree.
      const secondary = others[0];
      const r = await computeSignalTransform(p, primary, signal, options, secondary);
      return {
        data: r.data,
        name: r.name,
        preview: preview(signalTransformStepText(p).label, r.data, [], [
          [primary.name, signalRecipeInputData(p.recipe, primary)],
          ...(secondary ? [[secondary.name, signalRecipeInputData(p.recipe, secondary)] as [string, DataStruct]] : []),
        ]),
        datasetPatch: r.datasetPatch,
      };
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

export { reviewTransform };

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
  /** An interactive commit found the identical output already added: nothing was created or recorded. */
  existing?: boolean;
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
  signal?: AbortSignal,
  options?: SignalBindOptions,
  /** Interactive Signal Processing only: an identical, current output is not made twice. */
  skipDuplicate = false,
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
  signal?.throwIfAborted();
  const primary = await s().resolveDataset(primaryId);
  if (!primary) throw new Error("the input dataset is unavailable");
  const refs = refsOf(p);
  const others = await resolveRefs(s, refs);
  signal?.throwIfAborted();
  // An analysis-view recipe also reads row state: a mid-run exclusion/filter edit refuses (lane IR).
  const readsView = p.op === "signal" && p.recipe.inputRows === "analysis-view";
  const assertSignalSourceUnchanged = signalSourceGuard(s, p, [primary, ...others], readsView);
  const c = await computeTransform(p, primary, others, signal, options);
  // A transport that cannot abort may still answer after Cancel: add nothing.
  signal?.throwIfAborted();
  assertSignalSourceUnchanged();
  if (review && !(await review(c.preview))) {
    s().setStatus(`${c.preview.title} cancelled — nothing was created`);
    return null;
  }
  // Closed / stopped while the review was open: the answer must not create.
  signal?.throwIfAborted();
  assertSignalSourceUnchanged();
  const twin = skipDuplicate && p.op === "signal" ? findSignalDuplicate(s, p, primary, c.datasetPatch, c.data) : undefined;
  if (twin) {
    s().setActive(twin.id);
    s().setStatus(`this ${c.preview.title} output is already added as “${twin.name}”; nothing was duplicated`);
    return { id: twin.id, name: twin.name, warnings: [], outputs: [{ id: twin.id, key: "" }], existing: true };
  }
  // Read BEFORE addDataset, which makes the output active.
  const inputIsTarget = s().activeId === primary.id;
  const id = nextDatasetId();
  s().addDataset({
    id,
    name: c.name,
    ...c.datasetPatch,
    data: stampWarnings(c.data, p.op, c.preview.warnings),
  });
  const { label, code } = transformStepText(p, primary.name);
  const outputs = [{ id, key: "" }];
  s().recordMacro(label, code, {
    kind: "transform",
    params: { ...p, ...recordedProvenance(primary, inputIsTarget, outputs) },
  });
  s().setStatus(`created ${c.name}${recordedNote(c.preview.warnings)}`);
  // A linked signal output is a durable analysis result wherever it was made —
  // the workbench, Pipeline Studio or macro replay — so register it here.
  if (p.op === "signal") {
    await import("../store/analysisResultActions").then(
      (m) => m.registerSignalResult(primary.id, id),
      () => s().setStatus(`created ${c.name}, but its analysis result could not be recorded`),
    );
  }
  return { id, name: c.name, warnings: c.preview.warnings, outputs };
}

/** " — N warnings recorded in its metadata" (every stamped warning, info
 *  included — the metadata holds them all), or "" when there are none. */
function recordedNote(warnings: readonly TransformWarning[]): string {
  const n = warnings.length;
  return n ? ` — ${n} warning${n === 1 ? "" : "s"} recorded in its metadata` : "";
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
