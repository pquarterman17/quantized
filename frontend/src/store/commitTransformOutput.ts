// Every interactive single-output transform commits through the shared result
// contract (lane RL2, extended by the result audit, row 25): Resample, Average
// curves, Reshape (transpose / stack / unstack / join / append / clean), Dataset
// math, SIMS and Signal filter / Reduce XY. They are recorded `transform` steps
// (lib/transformRun.ts), whose `runTransform` writes the output with a raw
// `addDataset`; this is the same compute -> review -> commit -> record sequence,
// with the write routed through `commitComputedOutput` instead:
//
// - ONE UNDO STEP with the output's Library result;
// - NO DUPLICATE: the same inputs, settings and result find the output already
//   added (`existing`): nothing is created or recorded, and the status says so
//   (the review, if any, still opens first, because the result is only known
//   after the compute);
// - OUT OF DATE when ANY input worksheet changes (every input is a source of the
//   envelope, so the recalc graph marks the output per the project's mode);
// - the inputs, settings and algorithm version are recorded on the result.
//
// Interactive callers only. Pipeline replay keeps `runTransform`: a replay onto
// the same file twice is two recorded runs. Split and the in-place metadata ops
// make no single output; Signal Processing keeps its own linked result
// (`runTransform`'s `skipDuplicate`, lib/signalOutputGuard.ts).

import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import type { MetaStepParams } from "../lib/metadataRun";
import type { SignalTransformParams } from "../lib/signalTransform";
import { computeTransform, recordedProvenance, refsOf, transformStepText, type ReviewFn, type TransformOutcome, type TransformParams } from "../lib/transformRun";
import { transformProducer } from "../lib/transformProducer";
import { stampWarnings } from "../lib/transformWarnings";
import type { Dataset } from "../lib/types";
import { commitComputedOutput } from "./commitComputedOutput";
import type { useApp } from "./useApp";

type StoreGet = typeof useApp.getState;

/** Transforms that compute along the worksheet's time axis. The others (transpose, stack, unstack, join, merge, clean) have no X. */
export const TIME_AXIS_OPS: ReadonlySet<string> = new Set(["resample", "average", "sigop", "sims", "simscompare", "simsalign", "algebra"]);

/** A transform that makes ONE new worksheet and is not Signal Processing. */
export type CommittableTransform = Exclude<TransformParams, { op: "split" } | MetaStepParams | SignalTransformParams>;

export type TransformCommitOutcome = TransformOutcome;

export async function commitTransformOutput(
  s: StoreGet,
  p: CommittableTransform,
  primaryId: string,
  review?: ReviewFn,
  signal?: AbortSignal,
): Promise<TransformCommitOutcome | null> {
  signal?.throwIfAborted();
  const primary = await s().resolveDataset(primaryId);
  if (!primary) throw new Error("the input dataset is unavailable");
  const refs = refsOf(p);
  const missing = refs.find((r) => !s().datasets.some((d) => d.id === r.id));
  if (missing) throw new Error(`the recorded input "${missing.name}" is not in this workspace`);
  const got = await s().resolveDatasets(refs.map((r) => r.id));
  const others = refs.map((r) => {
    const ds = got.find((d) => d.id === r.id);
    if (!ds) throw new Error(`the recorded input "${r.name}" could not be loaded`);
    return ds;
  });
  const inputs: Dataset[] = [primary, ...others];
  // The inputs as they are NOW: the commit refuses if any changed while this ran.
  const sources = inputs.map((d) => ({ id: d.id, computedOn: analysisDataFingerprint(d) }));
  const c = await computeTransform(p, primary, others, signal);
  signal?.throwIfAborted();
  if (review && !(await review(c.preview))) {
    s().setStatus(`${c.preview.title} cancelled — nothing was created`);
    return null;
  }
  signal?.throwIfAborted();
  const data = stampWarnings(c.data, p.op, c.preview.warnings);
  const inputIsTarget = s().activeId === primary.id;
  const { label, code } = transformStepText(p, primary.name);
  const { errorRoles, derivedFrom, ...patch } = c.datasetPatch ?? {};
  const warned = c.preview.warnings.length;
  const outcome = commitComputedOutput({
    producer: transformProducer(p.op),
    sources,
    settings: { params: p },
    // Resample, Average, Signal ops, SIMS and dataset algebra (B is interpolated onto A's X) read the worksheet's own X (its time axis); the reshape ops have no X (C9).
    ...(TIME_AXIS_OPS.has(p.op) ? { xKey: null } : {}),
    name: c.name,
    data,
    ...(errorRoles ? { errorRoles } : {}),
    ...(derivedFrom ? { derivedFrom } : {}),
    patch,
    status: `created ${c.name}${warned ? ` — ${warned} warning${warned === 1 ? "" : "s"} recorded in its metadata` : ""}`,
  });
  if (outcome.kind === "refused") throw new Error(outcome.reason);
  const outputs = [{ id: outcome.outputId, key: "" }];
  if (outcome.kind === "existing") {
    const name = s().datasets.find((d) => d.id === outcome.outputId)?.name ?? c.name;
    return { id: outcome.outputId, name, warnings: c.preview.warnings, outputs, existing: true };
  }
  s().recordMacro(label, code, {
    kind: "transform",
    params: { ...p, ...recordedProvenance(primary, inputIsTarget, outputs) },
  });
  return { id: outcome.outputId, name: c.name, warnings: c.preview.warnings, outputs };
}
