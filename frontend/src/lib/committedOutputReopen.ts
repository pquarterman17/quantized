// "Open in <tool>" for a committed analysis output (lane RO, the result
// lifecycle's edit/rerun half). Pure: which tool a committed result reopens
// in, whether it can, and what the tool is told. The store side (open the
// tool, keep the editing session) is store/toolReopen.ts +
// store/toolReopenOpen.ts; the replace commit is store/analysisOutputReplace.ts.
//
// FAIL CLOSED: a result reopens on its RECORDED source with its RECORDED
// settings, never on whatever worksheet happens to be active. A missing source
// opens the tool with a notice and no settings; a source whose analysis view
// changed since the computation opens seeded but says so (re-run before
// committing); an output worksheet edited since it was added cannot be
// replaced (that would discard the edits), only added as new.

import type { AnalysisResult, AnalysisResultValue } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import { COMMIT_KEY_PARAM, REOPEN_PARAM, isCommittedOutputResult } from "./committedOutputGraph";
import type { Dataset } from "./types";

/** Producers that reopen in their tool, with the tool's name. The producer id
 *  doubles as the tool id of the editing session. */
export const REOPEN_TOOLS: Readonly<Record<string, string>> = {
  "surface-fit": "Surface fit",
  "optical-gap": "Optical gap",
  "ellipse-fit": "Ellipse fit",
  "baseline-subtract": "Baseline",
  "tabulate": "Tabulate",
  // Multi-source outputs (lane RO2): the tool reopens on ALL recorded sources.
  "peak-batch": "Peak batch",
  "peak-batch-integrate": "Batch integrate",
  "spin-asymmetry": "Spin asymmetry",
};

/** Reopenable producers whose output comes from several source worksheets. */
const MULTI_SOURCE_TOOLS: ReadonlySet<string> = new Set(["peak-batch", "peak-batch-integrate", "spin-asymmetry"]);

/** Committed producers that do NOT reopen, with the reason the action shows. */
const NOT_REOPENABLE: Readonly<Record<string, string>> = {
  "mag-normalization": "The sample profile and output units are not recorded as reopenable settings; open the Units tab on the source and apply again.",
  "mag-demag": "The geometry choice is not recorded as reopenable settings; open the Internal field tab on the source and apply again.",
  "curie-weiss": "The fit inputs live in the Magnetometry tab's controls and are not recorded as reopenable settings; open the Curie-Weiss tab on the source and fit again.",
  // Lane RO2 decision: the band is a statement about ONE fit, and the result
  // records only the model, the fitted values, the level and the width digest.
  // The covariance, the free-parameter count, the observation variance or
  // weights and the fit range, all of which the band needs, are not recorded,
  // and Curve Fit has no editing session to seed. Reopening on the recorded
  // values would draw a band for whatever fit is live, so it stays disabled.
  "fit-band": "A fit band is computed from a fit's covariance, free-parameter count, weights and fit range, and this result records only the model, the fitted values and the band level, so it cannot be restored; open Curve Fit on the source, fit again and plot the band again.",
};

export type ReopenSeed = Record<string, AnalysisResultValue>;

export type ReopenPlan =
  | { ok: false; label: string; reason: string }
  | {
    ok: true;
    label: string;
    tool: string;
    toolLabel: string;
    /** The recorded (primary) source, or null when it, or any further source, no longer exists. */
    sourceId: string | null;
    /** Every recorded source, primary first (several for a batch table or a spin asymmetry). */
    sourceIds: readonly string[];
    /** The recorded settings (null: not applied, see `notice`). */
    seed: ReopenSeed | null;
    /** Unkeyed tool state recorded beside the settings (e.g. start values). */
    extra: ReopenSeed | null;
    /** Why the tool opens differently from the recorded computation. */
    notice: string | null;
    outputId: string | null;
    outputName: string | null;
    /** Why the commit cannot replace the old output (null: it can). */
    replaceBlocked: string | null;
  };

const asRecord = (value: AnalysisResultValue | undefined): ReopenSeed | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null;

/** The analysis-view fingerprint the output was computed on: recorded beside
 *  the settings since lane RO, else read back from the commit key. */
export function recordedComputedOn(result: AnalysisResult): string | null {
  const recorded = asRecord(result.parameters?.[REOPEN_PARAM])?.["computedOn"];
  if (typeof recorded === "string") return recorded;
  const key = result.parameters?.[COMMIT_KEY_PARAM];
  try {
    const parsed: unknown = typeof key === "string" ? JSON.parse(key) : null;
    return Array.isArray(parsed) && typeof parsed[2] === "string" ? parsed[2] : null;
  } catch {
    return null;
  }
}

/** Why `output` cannot be replaced in place by a new commit (null: it can). */
export function replaceBlockedReason(result: AnalysisResult, output: Dataset | undefined): string | null {
  if (!output) return "The output worksheet was deleted, so the commit adds a new one.";
  if (output.pending) return "Load the output worksheet before replacing it.";
  const recorded = asRecord(result.parameters?.[REOPEN_PARAM])?.["output"];
  if (typeof recorded !== "string") {
    return "This result was added before its output could be checked for edits, so it is kept; the commit adds a new output.";
  }
  const attached = WORKSHEET_EDITS.filter((field) => output[field] !== undefined);
  if (attached.length) {
    return `“${output.name}” carries worksheet edits (${attached.join(", ")}) made for its old data; replacing it would drop or misapply them, so the commit adds a new output.`;
  }
  if (recorded !== analysisDataFingerprint(output)) {
    return `“${output.name}” was edited after it was added; replacing it would discard those edits, so the commit adds a new output.`;
  }
  return null;
}

/** Worksheet state a user attaches to an output that is shaped by its data
 *  (column indexes, rows, fits): a replace could not carry it over honestly. */
const WORKSHEET_EDITS = [
  "formulas", "channelRoles", "columnDesignations", "columnProps", "hiddenCols", "frozenCols", "excludedRows",
  "filter", "fitSpec", "peakTable", "reflFits", "linkedCurves", "corrections", "bgRef", "raw", "derivedFrom",
] as const satisfies readonly (keyof Dataset)[];

export function reopenLabel(result: AnalysisResult): string {
  const tool = REOPEN_TOOLS[result.producer.id];
  return tool ? `Open in ${tool}` : `Open in ${result.producer.label}`;
}

export function planReopen(result: AnalysisResult, datasets: readonly Dataset[]): ReopenPlan {
  const label = reopenLabel(result);
  const refuse = (reason: string): ReopenPlan => ({ ok: false, label, reason });
  if (!isCommittedOutputResult(result)) return refuse("Only a committed analysis output reopens in its tool.");
  const toolLabel = REOPEN_TOOLS[result.producer.id];
  if (!toolLabel) {
    return refuse(NOT_REOPENABLE[result.producer.id] ?? `${result.producer.label} outputs cannot reopen in their tool yet; run the tool again to replace it.`);
  }
  const multi = MULTI_SOURCE_TOOLS.has(result.producer.id);
  if (result.sources.length === 0 || (!multi && result.sources.length !== 1)) {
    return refuse(`${toolLabel} reopens an output of one source worksheet only, and this result has ${result.sources.length}; run the tool again to replace it.`);
  }
  const settings = asRecord(result.parameters?.["settings"]);
  if (!settings) return refuse("This result does not record its settings; run the tool again to replace it.");
  const sourceIds = result.sources.map((item) => item.datasetId);
  const sourceId = sourceIds[0]!;
  const sources = sourceIds.map((id) => datasets.find((dataset) => dataset.id === id));
  const outputId = result.outputs[0]?.datasetId ?? null;
  const output = datasets.find((dataset) => dataset.id === outputId);
  const base = { ok: true as const, label, tool: result.producer.id, toolLabel, sourceIds, outputId, outputName: output?.name ?? null };
  const missing = sourceIds.filter((_, i) => !sources[i]);
  if (missing.length) {
    return {
      ...base, sourceId: null, seed: null, extra: null,
      notice: multi
        ? `${missing.length} of the ${sourceIds.length} recorded source worksheets (${missing.join(", ")}) no longer exist, so ${toolLabel} opens without this result's settings. Restore them (Undo) to edit this result.`
        : `The recorded source worksheet (${sourceId}) no longer exists, so ${toolLabel} opens without this result's settings. Restore the source (Undo) to edit this result.`,
      replaceBlocked: multi ? "A source worksheet is missing." : "The source worksheet is missing.",
    };
  }
  const notice = sourceNotice(result, toolLabel, sources as readonly Dataset[]);
  const extra = asRecord(asRecord(result.parameters?.[REOPEN_PARAM])?.["extra"]);
  return { ...base, sourceId, seed: settings, extra, notice, replaceBlocked: replaceBlockedReason(result, output) };
}

/** The further sources' analysis-view fingerprints as computed, recorded
 *  beside the settings (lane RO2); null when the result predates the record. */
function recordedAlsoFrom(result: AnalysisResult): Map<string, string> | null {
  const list = asRecord(result.parameters?.[REOPEN_PARAM])?.["alsoFrom"];
  if (!Array.isArray(list)) return null;
  const out = new Map<string, string>();
  for (const item of list) {
    const entry = asRecord(item);
    if (typeof entry?.["id"] === "string" && typeof entry["computedOn"] === "string") out.set(entry["id"], entry["computedOn"]);
  }
  return out;
}

/** Why the tool opens differently from the recorded computation: a source still
 *  loading, or changed since (the primary one first, then each further one).
 *  A further source that cannot be checked is said so, never assumed current. */
function sourceNotice(result: AnalysisResult, toolLabel: string, sources: readonly Dataset[]): string | null {
  const notices: string[] = [];
  const primary = sources[0]!;
  if (primary.pending) {
    notices.push(`“${primary.name}” is still loading, so it cannot be checked against this result yet. Load it, then run ${toolLabel} again before committing.`);
  } else if (recordedComputedOn(result) !== analysisDataFingerprint(primary)) {
    notices.push(`“${primary.name}” changed after this result was computed. The recorded settings are restored; check the column choices and run ${toolLabel} again on the current data before committing.`);
  }
  if (sources.length > 1) {
    const recorded = recordedAlsoFrom(result);
    for (const source of sources.slice(1)) {
      if (source.pending) {
        notices.push(`“${source.name}” is still loading, so it cannot be checked against this result yet. Load it, then run ${toolLabel} again before committing.`);
      } else if (!recorded?.has(source.id)) {
        notices.push(`“${source.name}” cannot be checked against this result (it was added before its sources were recorded), so run ${toolLabel} again on the current data before committing.`);
      } else if (recorded.get(source.id) !== analysisDataFingerprint(source)) {
        notices.push(`“${source.name}” changed after this result was computed; run ${toolLabel} again on the current data before committing.`);
      }
    }
  }
  return notices.length ? notices.join(" ") : null;
}
