// The column picks a Reductions FFT tool, the Kaplan-Meier curve or the row-wise t-tests ran on (OPEN_ITEMS row 12). Those tools
// pick columns by position, so reopening one must prove each recorded column is
// still where it was before any setting is restored. Fail closed: a missing or
// moved pick (or a record that does not read back completely) opens the tool
// WITHOUT the settings, with a notice, and Replace is off. Lazy (opener only).

import type { ReopenPlan, ReopenSeed } from "../lib/committedOutputReopen";
import { frequencyCountSeed } from "../lib/frequencyCountReopenSeed";
import { kaplanMeierSeed } from "../lib/kaplanMeierReopenSeed";
import { spectrogramSeed } from "../lib/spectrogramReopenSeed";
import { rowTSeed } from "../lib/rowTReopenSeed";
import { pawleySeed } from "../lib/pawleyReopenSeed";
import { fftThicknessSeed, recordedPickProblem, reflectivityFftSeed } from "../lib/reductionsReopenSeed";
import type { Dataset } from "../lib/types";

type OkPlan = Extract<ReopenPlan, { ok: true }>;

const READERS: Readonly<Record<string, (seed: ReopenSeed) => unknown>> = {
  "fft-thickness": fftThicknessSeed,
  "reflectivity-fft": reflectivityFftSeed,
  "km-curve": kaplanMeierSeed,
  "row-t-tests": rowTSeed,
  "pawley": pawleySeed,
  "frequency-count": frequencyCountSeed,
  "signal-spectrogram": spectrogramSeed,
};

/** The Baseline binding a batch output ran on, by position AND name; null when it still holds. */
function baselineBindingProblem(plan: OkPlan, source: Dataset): string | null {
  const binding = plan.seed?.["binding"];
  const b = binding && typeof binding === "object" && !Array.isArray(binding) ? binding : null;
  const params = plan.seed?.["params"];
  if (typeof plan.seed?.["method"] !== "string" || !params || typeof params !== "object" || Array.isArray(params)) {
    return "Its method and settings were not recorded completely, so they are not restored.";
  }
  if (!b || typeof b["yKey"] !== "number" || typeof b["yLabel"] !== "string"
    || (b["xKey"] !== null && typeof b["xKey"] !== "number") || (b["xKey"] !== null && typeof b["xLabel"] !== "string")) {
    return "The channels it ran on were not recorded completely, so its settings are not restored.";
  }
  const labels = source.data.labels;
  const yOk = labels[b["yKey"]] === b["yLabel"];
  const xOk = b["xKey"] === null || labels[b["xKey"] as number] === b["xLabel"];
  return yOk && xOk ? null : `The recorded channel “${b["yLabel"]}” is no longer at its place in “${source.name}” (its columns changed), so its settings are not restored.`;
}

/** The plan, with its seed dropped (and why) when the recorded column pick or settings cannot be trusted. */
export function guardRecordedPicks(plan: OkPlan, source: Dataset | undefined): OkPlan {
  const batchBaseline = plan.tool === "baseline-subtract" && plan.resultProducer === "baseline-batch";
  const reader = READERS[plan.tool];
  if ((!reader && !batchBaseline) || !plan.seed || !source) return plan;
  const problem = source.pending
    ? `“${source.name}” is still loading, so its columns cannot be checked against the record. Load it, then reopen.`
    : batchBaseline ? baselineBindingProblem(plan, source)
    : recordedPickProblem(source.data.labels, plan.extra, source.name, String(source.data.metadata?.["x_column_name"] ?? "x"));
  const unreadable = reader ? reader(plan.seed) === null : false;
  if (!problem && !unreadable) return plan;
  const reason = problem ?? "Its recorded settings are incomplete, so they are not restored.";
  return {
    ...plan, seed: null, extra: null,
    // A plan notice that says the settings ARE restored would contradict this one: show only this one then.
    notice: [plan.notice?.includes("settings are restored") ? null : plan.notice, `${plan.toolLabel} opens without this result's settings. ${reason}`].filter(Boolean).join(" "),
    replaceBlocked: reason,
  };
}
