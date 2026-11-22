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
};

const MULTI_SOURCE = "A batch table comes from several worksheets and cannot reopen in its tool yet; run the batch again to replace it.";

/** Committed producers that do NOT reopen, with the reason the action shows. */
const NOT_REOPENABLE: Readonly<Record<string, string>> = {
  "peak-batch": MULTI_SOURCE,
  "peak-batch-integrate": MULTI_SOURCE,
  "spin-asymmetry": "Spin asymmetry comes from two worksheets (R++ and R--) and cannot reopen in its tool yet; run it again to add a new output.",
  "mag-normalization": "The sample profile and output units are not recorded as reopenable settings; open the Units tab on the source and apply again.",
  "mag-demag": "The geometry choice is not recorded as reopenable settings; open the Internal field tab on the source and apply again.",
  "curie-weiss": "The fit inputs live in the Magnetometry tab's controls and are not recorded as reopenable settings; open the Curie-Weiss tab on the source and fit again.",
  "fit-band": "A fit band follows the live Curve Fit, which this result does not record; open Curve Fit on the source and plot the band again.",
};

export type ReopenSeed = Record<string, AnalysisResultValue>;

export type ReopenPlan =
  | { ok: false; label: string; reason: string }
  | {
    ok: true;
    label: string;
    tool: string;
    toolLabel: string;
    /** The recorded source, or null when it no longer exists. */
    sourceId: string | null;
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
  if (result.sources.length !== 1) return refuse(MULTI_SOURCE);
  const settings = asRecord(result.parameters?.["settings"]);
  if (!settings) return refuse("This result does not record its settings; run the tool again to replace it.");
  const sourceId = result.sources[0]!.datasetId;
  const source = datasets.find((dataset) => dataset.id === sourceId);
  const outputId = result.outputs[0]?.datasetId ?? null;
  const output = datasets.find((dataset) => dataset.id === outputId);
  const base = { ok: true as const, label, tool: result.producer.id, toolLabel, outputId, outputName: output?.name ?? null };
  if (!source) {
    return {
      ...base, sourceId: null, seed: null, extra: null,
      notice: `The recorded source worksheet (${sourceId}) no longer exists, so ${toolLabel} opens without this result's settings. Restore the source (Undo) to edit this result.`,
      replaceBlocked: "The source worksheet is missing.",
    };
  }
  const computedOn = recordedComputedOn(result);
  const notice = source.pending
    ? `“${source.name}” is still loading, so it cannot be checked against this result yet. Load it, then run ${toolLabel} again before committing.`
    : computedOn !== analysisDataFingerprint(source)
    ? `“${source.name}” changed after this result was computed. The recorded settings are restored; check the column choices and run ${toolLabel} again on the current data before committing.`
    : null;
  const extra = asRecord(asRecord(result.parameters?.[REOPEN_PARAM])?.["extra"]);
  return { ...base, sourceId, seed: settings, extra, notice, replaceBlocked: replaceBlockedReason(result, output) };
}
