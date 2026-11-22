// Committed analysis outputs in the recalc graph (lane RL, shared result
// lifecycle). A "committed output" is a worksheet an analysis tool wrote ONCE
// from a source (Surface fit's fitted surface, Optical gap's Tauc data, Ellipse
// fit's curve), published with an AnalysisResult envelope that carries a
// `parameters.commitKey` (store/analysisOutputCommit.ts). Unlike a Signal
// Processing output it has no replayable recipe (`derivedFrom`/`analysisRecipe`),
// so the recalc engine can never recompute it in place.
//
// What the graph does with one, following the project's recalc mode exactly as
// for a linked derived worksheet: a change to its source (or to anything the
// source re-derives from) marks the output stale in "auto" and "manual" mode;
// "off" tracks nothing. A recalc pass LEAVES it stale (store/recalcDatasets.ts)
// — only running the tool again replaces it — and the existing save/load
// freshness stamp (lib/analysisResultFreshness.ts, lib/analysisResultStaleLoad.ts)
// carries the state across reopen because the envelope lists the output.
//
// Eager (store/recalcEngine.ts imports it), so it stays tiny and type-only.

import type { AnalysisResult } from "./analysisResult";

/** The envelope parameter that marks (and keys) a committed output. */
export const COMMIT_KEY_PARAM = "commitKey";

export function isCommittedOutputResult(result: AnalysisResult): boolean {
  return typeof result.parameters?.[COMMIT_KEY_PARAM] === "string" && result.outputs.length > 0;
}

/** Output worksheet ids of committed results whose source is in `changed`. */
export function committedOutputsOf(results: readonly AnalysisResult[], changed: readonly string[]): string[] {
  if (results.length === 0) return [];
  const hit = new Set(changed);
  const out: string[] = [];
  for (const result of results) {
    if (!isCommittedOutputResult(result) || !result.sources.some((ref) => hit.has(ref.datasetId))) continue;
    for (const ref of result.outputs) if (!out.includes(ref.datasetId)) out.push(ref.datasetId);
  }
  return out;
}

/** Every committed output worksheet id (what a recalc pass must not "clear"). */
export function committedOutputIds(results: readonly AnalysisResult[]): Set<string> {
  const ids = new Set<string>();
  for (const result of results) {
    if (isCommittedOutputResult(result)) for (const ref of result.outputs) ids.add(ref.datasetId);
  }
  return ids;
}
