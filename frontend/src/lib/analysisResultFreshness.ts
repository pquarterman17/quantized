// Durable "out of date" state for analysis results (PR #554 review).
//
// `staleDatasets` is session state: the recalc engine marks outputs stale when
// a source changes, and hydration starts every load from an empty list. A
// result whose output was stale when saved would therefore reopen as
// "Current" while holding values computed from the old source. Instead each
// saved envelope records a fingerprint of its sources' data AS OF ITS
// OUTPUT'S LAST COMPUTATION, plus `stale: true` while the output is known
// stale; on load the parser re-derives the stale outputs from both. Checking
// the fingerprint against the loaded data also catches a source that changed
// after the save (a merged or hand-edited file). Files without the fields
// (saved before this) read as current, exactly as they did.
//
// Pure: the parser runs this inside lib/workspaceParse.worker.ts too.

import type { AnalysisResult } from "./analysisResult";
import { peakTableMatchesData } from "./peakTableFreshness";
import { analysisData } from "./rowstate";
import type { DataStruct, Dataset } from "./types";

const fingerprints = new WeakMap<DataStruct, string>();
const scratch = new Float64Array(1);
const words = new Uint32Array(scratch.buffer);

/** A 64-bit content hash of a worksheet's numbers (X and every cell, with
 *  shape). Non-finite values and -0 are canonicalised because the .dwk JSON
 *  round trip does not preserve them, and a save/reopen must hash the same.
 *  Cached per `data` object, which every edit replaces. */
export function dataFingerprint(data: DataStruct): string {
  const cached = fingerprints.get(data);
  if (cached) return cached;
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  const mix = (value: unknown): void => {
    scratch[0] = typeof value === "number" && Number.isFinite(value) ? value + 0 : NaN;
    for (const word of words) {
      a = Math.imul(a ^ word, 0x01000193);
      b = Math.imul(b ^ word, 0x5bd1e995);
      b ^= b >>> 15;
    }
  };
  mix(data.time.length);
  for (const x of data.time) mix(x);
  mix(data.values.length);
  for (const row of data.values) {
    mix(row.length);
    for (const cell of row) mix(cell);
  }
  const out = `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
  fingerprints.set(data, out);
  return out;
}

/** Statistical tools run on the analysis view, not raw worksheet arrays.
 * Include exclusions and filters by hashing that exact derived view. */
export function analysisDataFingerprint(dataset: Dataset): string {
  const view = analysisData(dataset) ?? dataset.data;
  const semantics = JSON.stringify({
    labels: view.labels,
    units: view.units,
    catLevels: view.cat_levels ?? null,
    levelOrder: view.level_order ?? null,
    xName: view.metadata?.["x_column_name"] ?? null,
    channelTypes: dataset.channelTypes ?? null,
  });
  let schema = 0x811c9dc5;
  for (let index = 0; index < semantics.length; index++) {
    schema = Math.imul(schema ^ semantics.charCodeAt(index), 0x01000193);
  }
  return `${dataFingerprint(view)}:${(schema >>> 0).toString(16).padStart(8, "0")}`;
}
/** The result's sources' fingerprint, or null when it can't be judged (a
 *  source or output missing, or a lazily loaded book still pending, whose
 *  data is only a preview). */
function sourcesFingerprint(result: AnalysisResult, byId: ReadonlyMap<string, Dataset>): string | null {
  const refs = [...result.sources, ...result.outputs].map((ref) => byId.get(ref.datasetId));
  if (result.sources.length === 0 || refs.some((dataset) => !dataset || dataset.pending)) return null;
  return result.sources.map((ref) => dataFingerprint(byId.get(ref.datasetId)!.data)).join(":");
}

function snapshotSourcesFingerprint(result: AnalysisResult, byId: ReadonlyMap<string, Dataset>): string | null {
  if (result.sources.length === 0) return null;
  const sources = result.sources.map((ref) => byId.get(ref.datasetId));
  if (sources.some((dataset) => !dataset || dataset.pending)) return null;
  return sources.map((dataset) => analysisDataFingerprint(dataset!)).join(":");
}

/** Save side: stamp each envelope with the freshness the reopened file needs.
 *  A current result records its sources' fingerprint now; a stale one keeps
 *  the fingerprint from its output's last computation and says `stale`. */
export function stampAnalysisResults(
  results: readonly AnalysisResult[],
  datasets: readonly Dataset[],
  staleDatasets: readonly string[],
  staleFits: readonly string[] = [],
): AnalysisResult[] {
  const byId = new Map(datasets.map((dataset) => [dataset.id, dataset]));
  return results.map(({ stale: wasStale, ...result }) => {
    // Inline tables are source-only snapshots: there is no linked
    // output for the recalc graph to mark. Never refresh their fingerprint
    // merely because the project is being saved; that would silently bless
    // old numbers after the source changed. Only running the test again
    // creates a new current result.
    if (result.producer.id === "statistical-test" || result.producer.id === "distribution-analysis") {
      const fingerprint = snapshotSourcesFingerprint(result, byId);
      const changed = !!(result.sourceFingerprint && fingerprint && result.sourceFingerprint !== fingerprint);
      if (changed) return { ...result, stale: true as const };
      if (fingerprint && result.sourceFingerprint === fingerprint) return result;
      if (wasStale) return { ...result, stale: true as const };
      return fingerprint ? { ...result, sourceFingerprint: fingerprint } : result;
    }
    // A peak result has no linked output and its Dataset.peakTable carries the
    // fit-time fingerprint. Do not stamp a second, generic fingerprint that
    // no load-side path can use and that suggests this source-only result is
    // governed by the linked-output recalc graph.
    if (result.settingsRef?.field === "peakTable") {
      const { sourceFingerprint: _unused, ...peakResult } = result;
      const source = byId.get(result.settingsRef.datasetId);
      return source?.peakTable && !peakTableMatchesData(source.peakTable, source)
        ? { ...peakResult, stale: true }
        : peakResult;
    }
    if (result.settingsRef?.field === "fitSpec") {
      if (staleFits.includes(result.settingsRef.datasetId)) {
        return { ...result, stale: true };
      }
    }
    if (result.outputs.some((ref) => staleDatasets.includes(ref.datasetId))) return { ...result, stale: true };
    const fingerprint = sourcesFingerprint(result, byId);
    return fingerprint ? { ...result, sourceFingerprint: fingerprint } : result;
  });
}
