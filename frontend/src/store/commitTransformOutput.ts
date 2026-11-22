// Resample and Average curves commit through the shared result contract (lane
// RL2). They are recorded `transform` steps (lib/transformRun.ts), whose
// `runTransform` writes the output with a raw `addDataset`; this is the same
// compute -> review -> commit -> record sequence for these two ops, with the
// write routed through `commitComputedOutput` instead:
//
// - ONE UNDO STEP with the output's Library result;
// - NO DUPLICATE: the same inputs, settings and result find the output already
//   added (`existing`): nothing is created or recorded (the review, if any,
//   still opens first, because the result is only known after the compute);
// - OUT OF DATE when ANY input worksheet changes (every input is a source of the
//   envelope, so the recalc graph marks the output per the project's mode).
//
// Interactive callers only (the Resample and Dataset Math workshops). Pipeline
// replay keeps `runTransform`: a replay onto the same file twice is two runs.

import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import { computeTransform, recordedProvenance, transformStepText, type ReviewFn, type TransformOutcome } from "../lib/transformRun";
import type { AverageParams } from "../lib/transformAverage";
import type { ResampleParams } from "../lib/transformResample";
import { stampWarnings } from "../lib/transformWarnings";
import type { Dataset } from "../lib/types";
import { commitComputedOutput } from "./commitComputedOutput";
import type { useApp } from "./useApp";

type StoreGet = typeof useApp.getState;

export type TransformCommitOutcome = TransformOutcome & {
  /** The same computation was already added: nothing new was created or recorded. */
  existing?: boolean;
};

export async function commitTransformOutput(
  s: StoreGet,
  p: ResampleParams | AverageParams,
  primaryId: string,
  review?: ReviewFn,
  signal?: AbortSignal,
): Promise<TransformCommitOutcome | null> {
  signal?.throwIfAborted();
  const primary = await s().resolveDataset(primaryId);
  if (!primary) throw new Error("the input dataset is unavailable");
  const refs = p.op === "average" ? p.with : p.with ? [p.with] : [];
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
    producer: p.op === "average"
      ? { id: "average-curves", label: "Average curves", version: 1 }
      : { id: "resample", label: "Resample", version: 1 },
    sources,
    settings: { params: p },
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
