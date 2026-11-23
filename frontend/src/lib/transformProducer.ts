// The result-contract producer (id, label, version) for each committed
// interactive transform (store/commitTransformOutput.ts). Ids of the two ops
// committed before the result audit are kept so existing results still reopen.
import type { AnalysisResultProducer } from "./analysisResult";

const LABELS: Record<string, string> = {
  resample: "Resample", average: "Average curves", transpose: "Transpose", stack: "Stack columns",
  unstack: "Unstack", join: "Join", merge: "Append datasets", algebra: "Dataset math",
  sigop: "Signal filter", sims: "SIMS processing", simscompare: "SIMS comparison",
  dedupe: "Remove duplicate rows", fillmissing: "Fill missing values", standardize: "Standardize columns",
};

export function transformProducer(op: string): AnalysisResultProducer {
  return {
    id: op === "average" ? "average-curves" : op === "resample" ? "resample" : `transform-${op}`,
    label: LABELS[op] ?? op, version: 1,
  };
}
