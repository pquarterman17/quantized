// An identical re-run of an analysis batch saves nothing new (result audit,
// row 34 / criterion 11). "Identical" = same producer, same source fingerprint
// (so the same data), sources, parameters (tool, settings, selection) and
// status table; the name carries a timestamp and is not compared. A result
// that is itself marked stale (its data changed during its run) or a candidate
// with no fingerprint or marked stale never matches: it fails open to "save a
// new one", never hides a different result.
import type { AnalysisResult } from "./analysisResult";
import { parametersWithoutInputs } from "./resultInputsRecord";

export function findIdenticalBatchResult(existing: readonly AnalysisResult[], candidate: AnalysisResult): AnalysisResult | undefined {
  if (candidate.stale || !candidate.sourceFingerprint) return undefined;
  const key = (r: AnalysisResult) => JSON.stringify([r.sources, parametersWithoutInputs(r.parameters), r.tables, r.warnings]);
  const wanted = key(candidate);
  return existing.find((r) =>
    !r.stale && r.producer.id === candidate.producer.id && r.sourceFingerprint === candidate.sourceFingerprint && key(r) === wanted);
}
