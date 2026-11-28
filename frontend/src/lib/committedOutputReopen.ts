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
import { sameFingerprint } from "./textFingerprint";

/** Producers that reopen in their tool, with the tool's name. The producer id
 *  doubles as the tool id of the editing session. */
export const REOPEN_TOOLS: Readonly<Record<string, string>> = {
  "surface-fit": "Surface fit",
  "optical-gap": "Optical gap",
  "ellipse-fit": "Ellipse fit",
  "curve-measure": "Curve measurements",
  "baseline-subtract": "Baseline",
  "tabulate": "Tabulate",
  // Multi-source outputs (lane RO2): the tool reopens on ALL recorded sources.
  "peak-batch": "Peak batch",
  "peak-batch-integrate": "Batch integrate",
  // Aligned copies (producer version 2 records the plotted channels): one source per output.
  "peak-align": "Align to peak",
  "spin-asymmetry": "Spin asymmetry",
  // Lane RO3: the Magnetometry tabs and the fit band (settings recorded from producer version 2).
  "mag-normalization": "Units",
  "mag-demag": "Internal field",
  "curie-weiss": "Curie–Weiss",
  "fit-band": "Curve fit",
  // OPEN_ITEMS row 12: the Reductions FFT tools (settings + column pick recorded from producer version 2).
  "fft-thickness": "Film thickness (FFT)",
  "reflectivity-fft": "Reflectivity FFT",
  "km-curve": "Statistical tests",
  // The committed row-wise t-test worksheet (settings and column picks recorded from its first producer version).
  "row-t-tests": "Statistical tests",
  // Row 12 continued: Pawley refinement (the single run and the batch model worksheets share the producer).
  "pawley": "Pawley refinement",
  // Row 12 (reopen gaps): a batch baseline output reopens in the single-dataset Baseline tool (see REOPEN_AS).
  "baseline-batch": "Baseline",
  // Row 12 (reopen gaps): the Data ▸ Frequency count prompt, refilled with the recorded settings (producer version 2).
  "frequency-count": "Frequency count",
  // Row 12 (reopen gaps): the Spectrogram body of Signal Processing (settings + signal column recorded from version 2).
  "signal-spectrogram": "Signal Processing (Spectrogram)",
  // Row 12 (reopen-seven): the Magnetometry Background tab and the Hysteresis tool's background subtraction (producer version 2 records the plotted channels).
  "mag-background": "Magnetometry (Background)",
  "hysteresis-background": "Hysteresis",
  // Row 12 (reopen-seven): the Resample dialog and the Average N tab of Dataset math, refilled from the recorded transform parameters.
  // Row 12 (reopen-seven): the plot's FFT gadget, re-armed with the recorded region and channel (producer version 2).
  "gadget-fft": "Gadget FFT",
  "resample": "Resample",
  "average-curves": "Average curves",
  // The worksheet-making Math extras jobs (producer version 2 records the mode, its options and the picked columns).
  "math-extras": "Math extras",
};

/** Producers whose tool is another producer's tool: the editing session and
 *  the commit run under the target id (a Baseline batch output reopens in
 *  Baseline, whose Replace turns that one output into a single-run result). */
const REOPEN_AS: Readonly<Record<string, string>> = { "baseline-batch": "baseline-subtract" };

/** Whether a commit by `committing` may replace a result made by `made`: the same producer, or the tool a producer reopens in. */
export const mayReplaceProducer = (made: string, committing: string): boolean => made === committing || REOPEN_AS[made] === committing;

/** Reopenable producers whose output comes from several source worksheets. */
const MULTI_SOURCE_TOOLS: ReadonlySet<string> = new Set(["peak-batch", "peak-batch-integrate", "spin-asymmetry", "average-curves", "curve-measure", "math-extras"]);

/** Producers that reopen only from this producer version on: their settings
 *  were not recorded completely before it, so an older result says so and does
 *  not reopen (it never guesses the missing settings). */
const REOPEN_FROM_VERSION: Readonly<Record<string, number>> = {
  "mag-normalization": 2, "mag-demag": 2, "curie-weiss": 2, "fit-band": 2, "fft-thickness": 2, "reflectivity-fft": 2, "km-curve": 2, "pawley": 2, "frequency-count": 2, "signal-spectrogram": 2, "mag-background": 2, "hysteresis-background": 2, "gadget-fft": 2, "peak-align": 2, "math-extras": 2,
};

export type ReopenSeed = Record<string, AnalysisResultValue>;

export type ReopenPlan =
  | { ok: false; label: string; reason: string }
  | {
    ok: true;
    label: string;
    tool: string;
    toolLabel: string;
    /** The producer of the result being reopened (differs from `tool` when one tool serves two producers). */
    resultProducer: string;
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
  const attached: string[] = WORKSHEET_EDITS.filter((field) => output[field] !== undefined);
  // A linked worksheet the TOOL made (Curie–Weiss) carries its own link; any other link is an edit.
  const link = output.derivedFrom;
  if (link && !(link.datasetId === result.sources[0]?.datasetId && link.pipeline === result.producer.id)) attached.push("derivedFrom");
  if (attached.length) {
    return `“${output.name}” carries worksheet edits (${attached.join(", ")}) made for its old data; replacing it would drop or misapply them, so the commit adds a new output.`;
  }
  if (!sameFingerprint(recorded, analysisDataFingerprint(output))) {
    return `“${output.name}” was edited after it was added; replacing it would discard those edits, so the commit adds a new output.`;
  }
  return null;
}

/** Worksheet state a user attaches to an output that is shaped by its data
 *  (column indexes, rows, fits): a replace could not carry it over honestly. */
const WORKSHEET_EDITS = [
  "formulas", "channelRoles", "columnDesignations", "columnProps", "hiddenCols", "frozenCols", "cellRules", "excludedRows",
  "filter", "fitSpec", "peakTable", "reflFits", "linkedCurves", "corrections", "bgRef", "raw",
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
    return refuse(`${result.producer.label} outputs cannot reopen in their tool yet; run the tool again to replace it.`);
  }
  if (result.producer.version < (REOPEN_FROM_VERSION[result.producer.id] ?? 1)) {
    return refuse(`This ${toolLabel} result was saved before its settings were recorded, so it cannot be reopened; run the tool again to replace it.`);
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
  const base = { ok: true as const, label, tool: REOPEN_AS[result.producer.id] ?? result.producer.id, toolLabel, resultProducer: result.producer.id, sourceIds, outputId, outputName: output?.name ?? null };
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
  } else if (!sameFingerprint(recordedComputedOn(result), analysisDataFingerprint(primary))) {
    notices.push(`“${primary.name}” changed after this result was computed. The recorded settings are restored; check the column choices and run ${toolLabel} again on the current data before committing.`);
  }
  if (sources.length > 1) {
    const recorded = recordedAlsoFrom(result);
    for (const source of sources.slice(1)) {
      if (source.pending) {
        notices.push(`“${source.name}” is still loading, so it cannot be checked against this result yet. Load it, then run ${toolLabel} again before committing.`);
      } else if (!recorded?.has(source.id)) {
        notices.push(`“${source.name}” cannot be checked against this result (it was added before its sources were recorded), so run ${toolLabel} again on the current data before committing.`);
      } else if (!sameFingerprint(recorded.get(source.id), analysisDataFingerprint(source))) {
        notices.push(`“${source.name}” changed after this result was computed; run ${toolLabel} again on the current data before committing.`);
      }
    }
  }
  return notices.length ? notices.join(" ") : null;
}
