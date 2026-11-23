// The pure, label-side half of the recordable transforms, split out of
// lib/transformRun.ts (which was 491 of 500 lines): which datasets a recorded
// step REFERENCES (`refsOf`), whether it runs in place (`isInPlaceOp`), and the
// pipeline label + script line it records (`transformStepText`). No compute,
// no store, no network, so the step-form editor, the commit path and replay
// share it. transformRun.ts re-exports all three under their old names.

import { lit } from "./macro";
import { averageLabel } from "./transformAverage";
import { cleanLabel } from "./transformClean";
import { IN_PLACE_OPS, metaStepText, type MetaStepParams } from "./metadataRun";
import { resampleLabel } from "./transformResample";
import { sigopLabel } from "./transformSigop";
import { simsLabel } from "./transformSims";
import { simsAlignLabel } from "./transformSimsAlign";
import { simsCompareLabel } from "./transformSimsCompare";
import { signalTransformStepText } from "./signalTransform";
import type { DatasetRef, TransformParams } from "./transformRun";

export const ALGEBRA_SYMBOL: Record<string, string> = {
  "A+B": "+", "A-B": "−", "A*B": "×", "A/B": "/", "(A-B)/(A+B)": "asym",
};

export function refsOf(p: TransformParams): DatasetRef[] {
  if (p.op === "join" || p.op === "algebra") return [p.with];
  if (p.op === "merge" || p.op === "simscompare" || p.op === "simsalign" || p.op === "average") return p.with;
  if (p.op === "resample") return p.with ? [p.with] : [];
  if (p.op === "signal" && p.recipe.kind === "spectral" && p.recipe.secondarySource) {
    return [{ id: p.recipe.secondarySource.datasetId, name: p.recipe.secondarySource.datasetName }];
  }
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
    case "sigop": label = sigopLabel(p, primaryName); break;
    case "sims": label = simsLabel(p, primaryName); break;
    case "simscompare": label = simsCompareLabel(p, primaryName); break;
    case "simsalign": label = simsAlignLabel(p, primaryName); break;
    case "average": label = averageLabel(p, primaryName); break;
    case "dedupe": case "fillmissing": case "standardize": label = cleanLabel(p, primaryName); break;
    case "signal": return signalTransformStepText(p);
    default: label = `${op[0].toUpperCase()}${op.slice(1)} ${primaryName}`;
  }
  return { label, code: `qz.transform(${lit(op)}, "<active>", ${lit(args)})` };
}
