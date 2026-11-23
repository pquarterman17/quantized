// The column picks a Reductions FFT tool or the Kaplan-Meier curve ran on (OPEN_ITEMS row 12). Those tools
// pick columns by position, so reopening one must prove each recorded column is
// still where it was before any setting is restored. Fail closed: a missing or
// moved pick (or a record that does not read back completely) opens the tool
// WITHOUT the settings, with a notice, and Replace is off. Lazy (opener only).

import type { ReopenPlan, ReopenSeed } from "../lib/committedOutputReopen";
import { kaplanMeierSeed } from "../lib/kaplanMeierReopenSeed";
import { pawleySeed } from "../lib/pawleyReopenSeed";
import { fftThicknessSeed, recordedPickProblem, reflectivityFftSeed } from "../lib/reductionsReopenSeed";
import type { Dataset } from "../lib/types";

type OkPlan = Extract<ReopenPlan, { ok: true }>;

const READERS: Readonly<Record<string, (seed: ReopenSeed) => unknown>> = {
  "fft-thickness": fftThicknessSeed,
  "reflectivity-fft": reflectivityFftSeed,
  "km-curve": kaplanMeierSeed,
  "pawley": pawleySeed,
};

/** The plan, with its seed dropped (and why) when the recorded column pick or settings cannot be trusted. */
export function guardRecordedPicks(plan: OkPlan, source: Dataset | undefined): OkPlan {
  const reader = READERS[plan.tool];
  if (!reader || !plan.seed || !source) return plan;
  const problem = source.pending
    ? `“${source.name}” is still loading, so its columns cannot be checked against the record. Load it, then reopen.`
    : recordedPickProblem(source.data.labels, plan.extra, source.name, String(source.data.metadata?.["x_column_name"] ?? "x"));
  const unreadable = reader(plan.seed) === null;
  if (!problem && !unreadable) return plan;
  const reason = problem ?? "Its recorded settings are incomplete, so they are not restored.";
  return {
    ...plan, seed: null, extra: null,
    notice: [plan.notice, `${plan.toolLabel} opens without this result's settings. ${reason}`].filter(Boolean).join(" "),
    replaceBlocked: reason,
  };
}
