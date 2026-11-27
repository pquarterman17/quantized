// Power & sample size: the form, the request it makes, and the report sentence.
// Pure. The numbers all come from the backend solver; this only words them.

import type { PowerSolveBody, PowerSolveFor, PowerSolveResult, PowerTest } from "../../../lib/api/statsPower";

export interface PowerForm {
  test: PowerTest;
  solve: PowerSolveFor;
  alpha: number | undefined;
  tails: 1 | 2;
  effect: number | undefined;
  p0: number | undefined;
  p1: number | undefined;
  n: number | undefined;
  power: number | undefined;
  ratio: number | undefined;
  groups: number | undefined;
}

export const TESTS: readonly { value: PowerTest; label: string; noun: string }[] = [
  { value: "t-one-sample", label: "One-sample t-test", noun: "one-sample t-test" },
  { value: "t-two-sample", label: "Two-sample t-test", noun: "two-sample t-test" },
  { value: "t-paired", label: "Paired t-test", noun: "paired t-test" },
  { value: "anova", label: "One-way ANOVA", noun: "one-way ANOVA" },
  { value: "prop-one", label: "One proportion", noun: "one-proportion test" },
  { value: "prop-two", label: "Two proportions", noun: "two-proportion test" },
  { value: "variance", label: "One variance (chi-square)", noun: "chi-square test of one variance" },
];

const DEFAULT_EFFECT: Partial<Record<PowerTest, number>> = { anova: 0.25, variance: 2 };

export const defaultForm = (): PowerForm => ({
  test: "t-two-sample", solve: "n", alpha: 0.05, tails: 2, effect: 0.5, p0: 0.5, p1: 0.65, n: 20, power: 0.8, ratio: 1, groups: 3,
});

/** Switching test resets the effect to that test's usual size (d = 0.5, f = 0.25, ratio 2). */
export const withTest = (f: PowerForm, test: PowerTest): PowerForm => ({ ...f, test, effect: DEFAULT_EFFECT[test] ?? 0.5 });

export const isProp = (t: PowerTest): boolean => t.startsWith("prop-");

/** The request for the form, or why it cannot be made yet. */
export function buildBody(f: PowerForm): { body: PowerSolveBody } | { missing: string } {
  const need: [string, number | undefined][] = [["alpha", f.alpha]];
  if (f.solve !== "n") need.push(["n", f.n]);
  if (f.solve !== "power") need.push(["power", f.power]);
  if (isProp(f.test)) need.push(["p0", f.p0]);
  if (f.solve !== "effect") need.push(isProp(f.test) ? ["p1", f.p1] : ["effect", f.effect]);
  if (f.test === "t-two-sample" || f.test === "prop-two") need.push(["ratio", f.ratio]);
  if (f.test === "anova") need.push(["groups", f.groups]);
  const gap = need.find(([, v]) => v === undefined || !Number.isFinite(v));
  if (gap) return { missing: gap[0] };
  const body: PowerSolveBody = { test: f.test, solve: f.solve, alpha: f.alpha!, tails: f.tails };
  if (f.solve !== "n") body.n = f.n!;
  if (f.solve !== "power") body.power = f.power!;
  if (isProp(f.test)) body.p0 = f.p0!;
  if (f.solve !== "effect") {
    if (isProp(f.test)) body.p1 = f.p1!;
    else body.effect = f.effect!;
  }
  if (f.test === "t-two-sample" || f.test === "prop-two") body.ratio = f.ratio!;
  if (f.test === "anova") body.groups = f.groups!;
  return { body };
}

const pct = (v: number): string => `${(100 * v).toFixed(1).replace(/\.0$/, "")}%`;
const num = (v: number): string => String(Number(v.toPrecision(4)));

/** "n = 64 per group (128 in all)" / "n = 34" / "n = 25 pairs". */
export function sizeText(r: PowerSolveResult): string {
  if (r.test === "anova") return `n = ${r.n} per group (${r.n_total} in all, ${r.groups} groups)`;
  if (r.n2 != null) return r.n2 === r.n ? `n = ${r.n} per group (${r.n_total} in all)` : `n1 = ${r.n}, n2 = ${r.n2} (${r.n_total} in all)`;
  return r.test === "t-paired" ? `n = ${r.n} pairs` : `n = ${r.n}`;
}

function effectText(r: PowerSolveResult): string {
  const sym = r.effect_name === "variance ratio" ? "variance ratio" : r.effect_name.replace("Cohen's ", "");
  if (r.p0 != null && r.p1 != null) return `p = ${num(r.p1)} against ${num(r.p0)} (h = ${num(r.effect)})`;
  return `${sym} = ${num(r.effect)}`;
}

/** The one-paragraph answer, with the achieved power at the whole-number sizes. */
export function describe(r: PowerSolveResult): string {
  const noun = `${r.tails === 2 ? "two" : "one"}-sided ${TESTS.find((t) => t.value === r.test)?.noun ?? r.test}`;
  const at = `at the ${pct(r.alpha)} level`;
  if (r.solve === "n") {
    return `A ${noun} needs ${sizeText(r)} for ${pct(r.target_power ?? 0)} power to detect ${effectText(r)} ${at}. Achieved power at ${sizeText(r).split(" (")[0]}: ${pct(r.power)}.`;
  }
  if (r.solve === "power") return `With ${sizeText(r)}, a ${noun} has ${pct(r.power)} power to detect ${effectText(r)} ${at}.`;
  const alt = r.effect_alt != null ? ` (or ${num(r.effect_alt)} the other way)` : r.p1_alt != null ? ` (or p = ${num(r.p1_alt)} the other way)` : "";
  const smallest = r.p0 != null && r.p1 != null ? `p = ${num(r.p1)} against ${num(r.p0)}` : `${effectText(r)}`;
  return `With ${sizeText(r)}, a ${noun} reaches ${pct(r.target_power ?? 0)} power for effects of ${smallest}${alt} ${at}.`;
}

/** Plain-text report for the clipboard. */
export function reportText(r: PowerSolveResult): string {
  const rows: [string, string][] = [
    ["Test", `${r.tails === 2 ? "two" : "one"}-sided ${TESTS.find((t) => t.value === r.test)?.label ?? r.test}`],
    ["Solved for", r.solve === "n" ? "sample size" : r.solve === "power" ? "power" : "detectable effect"],
    ["Alpha", num(r.alpha)],
    ["Sample size", sizeText(r)],
    ["Effect", `${effectText(r)}${r.effect_alt != null ? `; other side ${num(r.effect_alt)}` : ""}`],
    ["Power", pct(r.power)],
  ];
  if (r.target_power != null) rows.push(["Target power", pct(r.target_power)]);
  return [describe(r), "", ...rows.map(([k, v]) => `${k}: ${v}`), ...r.notes].join("\n");
}
