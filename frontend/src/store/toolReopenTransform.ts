// The opener's guard for the transform dialogs that reopen from their recorded
// parameters (Resample, Average curves; OPEN_ITEMS row 12, reopen-seven lane).
// Neither picks a column by position, so there is no column record to prove;
// what must hold is that the parameters read back completely and, for Average,
// that the recorded y column is still shared by every averaged worksheet (the
// dialog would otherwise fall back to "first column of each" without saying).
// Fail closed: the tool opens WITHOUT the settings, with a notice, Replace off.
// Lazy (opener only).

import type { ReopenPlan } from "../lib/committedOutputReopen";
import { averageSeed, resampleSeed } from "../lib/transformReopenSeed";
import type { Dataset } from "../lib/types";

type OkPlan = Extract<ReopenPlan, { ok: true }>;

const numericLabels = (d: Dataset): string[] => {
  const cats = d.data.cat_levels ?? {};
  return d.data.labels.filter((_, i) => !(String(i) in cats));
};

function problemOf(plan: OkPlan, datasets: readonly Dataset[]): string | null {
  if (plan.tool === "resample") return resampleSeed(plan.seed) ? null : "Its recorded grid is incomplete, so it is not restored.";
  const seed = averageSeed(plan.seed, plan.sourceIds);
  if (!seed) return "Its recorded settings are incomplete, so they are not restored.";
  const sources = plan.sourceIds.map((id) => datasets.find((d) => d.id === id));
  const pending = sources.find((d) => d?.pending);
  if (pending) return `“${pending.name}” is still loading, so its columns cannot be checked against the record. Load it, then reopen.`;
  if (seed.channel) {
    const lacking = sources.find((d) => d && !numericLabels(d).includes(seed.channel));
    if (lacking) return `The recorded column “${seed.channel}” is no longer in “${lacking.name}”, so its settings are not restored.`;
  }
  return null;
}

/** The plan, with its seed dropped (and why) when the recorded parameters cannot be trusted. Other tools pass through. */
export function guardRecordedTransform(plan: OkPlan, datasets: readonly Dataset[]): OkPlan {
  if ((plan.tool !== "resample" && plan.tool !== "average-curves") || !plan.seed || !plan.sourceId) return plan;
  const reason = problemOf(plan, datasets);
  if (!reason) return plan;
  return {
    ...plan, seed: null, extra: null,
    notice: [plan.notice, `${plan.toolLabel} opens without this result's settings. ${reason}`].filter(Boolean).join(" "),
    replaceBlocked: reason,
  };
}
