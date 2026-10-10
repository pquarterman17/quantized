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

/** A statistical-test result needs no worksheet only when its saved question
 *  is a power analysis. Every other test was run on a source worksheet, so a
 *  result that has lost (or never carried) its source reference is
 *  source-missing — never "current" by default. */
export function statisticalResultSourceless(result: AnalysisResult): boolean {
  return result.parameters?.["testId"] === "power";
}

export type StatisticalSnapshotState = "current" | "out-of-date" | "pending" | "source-missing";

/** The single freshness authority for statistical-test snapshots, shared by
 *  the result panel's status/gates and the report handoff. A result is current
 *  only when every source is present and fully loaded, the envelope carries a
 *  fingerprint, it was not saved stale, and that fingerprint matches the exact
 *  analysis view now. A lazily loaded source is only a preview, so it can't be
 *  judged: `pending`, not current. */
export function statisticalSnapshotState(
  result: AnalysisResult,
  datasets: readonly Dataset[],
): StatisticalSnapshotState {
  if (statisticalResultSourceless(result) && result.sources.length === 0) {
    return result.stale ? "out-of-date" : "current";
  }
  if (result.sources.length === 0) return "source-missing";
  const sources = result.sources.map((ref) => datasets.find((dataset) => dataset.id === ref.datasetId));
  if (sources.some((dataset) => !dataset)) return "source-missing";
  if (sources.some((dataset) => dataset!.pending)) return "pending";
  if (result.stale || !result.sourceFingerprint) return "out-of-date";
  const now = sources.map((dataset) => analysisDataFingerprint(dataset!)).join(":");
  return now === result.sourceFingerprint ? "current" : "out-of-date";
}

export const STATISTICAL_SNAPSHOT_STATUS: Readonly<Record<StatisticalSnapshotState, string>> = {
  "current": "Current", "out-of-date": "Out of date", "pending": "Pending", "source-missing": "Source missing",
};

/** Diagnostics for a non-current snapshot. A present-but-deleted source is
 *  already reported generically by its reference, so it adds nothing here. */
export function statisticalSnapshotDiagnostics(result: AnalysisResult, state: StatisticalSnapshotState): string[] {
  if (state === "pending") {
    return ["The source worksheet is not fully loaded. Load the full worksheet to check whether these values are current."];
  }
  if (state === "source-missing") {
    return result.sources.length ? [] : ["This statistical result no longer references its source worksheet, so its values can't be checked."];
  }
  if (state !== "out-of-date") return [];
  return [result.sourceFingerprint
    ? "The source data changed after this statistical test. Run the test again before using these values."
    : "This statistical result has no saved source fingerprint, so it can't be checked against the data. Run the test again before using these values."];
}

function statisticalSourcesFingerprint(result: AnalysisResult, byId: ReadonlyMap<string, Dataset>): string | null {
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
    // Statistical tables are source-only snapshots: there is no linked
    // output for the recalc graph to mark. Never refresh their fingerprint
    // merely because the project is being saved; that would silently bless
    // old numbers after the source changed. Only running the test again
    // creates a new current result.
    if (result.producer.id === "statistical-test") {
      // Once stale, always stale: only a new run creates a current result.
      if (wasStale) return { ...result, stale: true as const };
      // No fingerprint means the numbers were never tied to a data state;
      // stamping today's would bless them against whatever the data is now.
      if (!result.sourceFingerprint) {
        return statisticalResultSourceless(result) && result.sources.length === 0
          ? result : { ...result, stale: true as const };
      }
      const fingerprint = statisticalSourcesFingerprint(result, byId);
      return fingerprint && fingerprint !== result.sourceFingerprint ? { ...result, stale: true as const } : result;
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
