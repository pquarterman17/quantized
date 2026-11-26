// The statistic half of the Conditional Format form: one rule that depends on
// the whole column (duplicates, outliers, top / bottom N or N%), read from three
// flat fields of the shared ParamDialog. Kept out of ./cellRulesDialog.ts so
// that file stays about the value rules and the scale. Fails closed like it:
// a number that cannot mean the chosen rule applies nothing and says why.

import type { ParamField, ParamValues } from "../../../lib/params";
import { RULE_TONES, RULE_TONE_LABELS, type RuleTone, type StatRule } from "../../../lib/worksheetRulesModel";

const NONE = "(none)";
const TONES = RULE_TONES.map((t) => RULE_TONE_LABELS[t]);

/** The choices, each stating exactly what it matches. */
const KINDS = {
  duplicate: "duplicate values",
  outlier: "outliers (beyond Q1/Q3 by k × IQR)",
  top: "top N values",
  bottom: "bottom N values",
  topPct: "top N percent",
  bottomPct: "bottom N percent",
} as const;
type Choice = keyof typeof KINDS;
const LABELS = [NONE, ...Object.values(KINDS)];
const choiceOf = (label: unknown): Choice | null => (Object.keys(KINDS) as Choice[]).find((c) => KINDS[c] === label) ?? null;

function choiceFor(r: StatRule): Choice {
  if (r.kind === "duplicate") return "duplicate";
  if (r.kind === "outlier") return "outlier";
  return r.end === "top" ? (r.percent ? "topPct" : "top") : r.percent ? "bottomPct" : "bottom";
}

/** The three form fields, seeded from the column's current statistic rule. */
export function statFields(current?: StatRule): ParamField[] {
  const n = current?.kind === "outlier" ? current.k : current?.kind === "rank" ? current.n : current ? 0 : 1.5;
  return [
    { key: "stat", label: "Also highlight", type: "select", options: LABELS, default: current ? KINDS[choiceFor(current)] : NONE },
    { key: "statN", label: "N (top / bottom) or k (outliers: 1.5 is Tukey's fence)", type: "number", default: n || 1.5 },
    { key: "statTone", label: "Highlight color", type: "select", options: TONES, default: RULE_TONE_LABELS[current?.tone ?? "accent"] },
  ];
}

/** The rule the form means (`rule` undefined for none), or a refusal sentence. */
export function statFromParams(p: ParamValues): { rule?: StatRule } | { error: string } {
  const choice = choiceOf(p.stat);
  if (!choice) return {};
  const tone: RuleTone = RULE_TONES[Math.max(0, TONES.indexOf(String(p.statTone)))];
  if (choice === "duplicate") return { rule: { kind: "duplicate", tone } };
  const n = Number(p.statN);
  if (choice === "outlier") {
    return Number.isFinite(n) && n > 0 && n <= 100
      ? { rule: { kind: "outlier", k: n, tone } }
      : { error: "The outlier rule was not applied: k must be a number above 0 (1.5 is the usual fence)." };
  }
  const percent = choice === "topPct" || choice === "bottomPct";
  const end = choice === "top" || choice === "topPct" ? "top" : "bottom";
  if (!Number.isFinite(n) || n <= 0 || (percent && n > 100) || (!percent && Math.round(n) < 1)) {
    return { error: `The ${end} rule was not applied: N must be ${percent ? "a percentage above 0 up to 100" : "a whole number of at least 1"}.` };
  }
  return { rule: { kind: "rank", end, n: percent ? n : Math.round(n), ...(percent ? { percent } : {}), tone } };
}
