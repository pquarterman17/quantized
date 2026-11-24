// Statistical-tests workshop — display tables and the plain-language conclusion
// for the GAP_AUDIT_9 G8 tests (censored life distribution, Fit Life by X).
// Sibling of statsTestsResults.ts (which delegates here); pure. Tables hold raw
// numbers. The probability plot / Kaplan-Meier picture is `TestOutput.life`,
// drawn live by components/workshops/statstests/LifeView; a saved result keeps
// the tables.

import type { StatsTestResult } from "./api/statsTests";
import type { LifeByXResult, LifeDistributionResult, LifeParameter } from "./api/statsTestsLife";
import type { Cell, ResultTable, TestOutput } from "./statsTestsResults";

export type LifeTestResult = Extract<StatsTestResult, { id: "life-distribution" | "life-by-x" }>;

/** What the workshop draws for a life-distribution output. */
export type LifeDisplay = { kind: "life"; result: LifeDistributionResult };

type Num = number | null | undefined;
const isNum = (v: Num): v is number => v != null && Number.isFinite(v);
const num = (v: Num): string => (isNum(v) ? String(Number(v.toPrecision(3))) : "—");
const NAMES: Record<string, string> = {
  weibull: "Weibull", lognormal: "Lognormal", exponential: "Exponential", loglogistic: "Loglogistic", sev: "Smallest extreme value",
};
const pct = (p: number): string => `B${Number((p * 100).toPrecision(3))}`;
const range = (lo: Num, hi: Num): string => `${num(lo)} to ${num(hi)}`;

function paramRows(rows: LifeParameter[]): Cell[][] {
  return rows.map((p) => [p.name, p.estimate, p.se, p.ci_low, p.ci_high]);
}

function fitRows(r: LifeDistributionResult | LifeByXResult, level: string): ResultTable {
  return {
    title: "Fit statistics",
    columns: ["statistic", "value"],
    rows: [
      ["distribution", NAMES[r.distribution] ?? r.distribution], ["units", r.n], ["failures", r.n_failed],
      ["censored", r.n_censored], ["log-likelihood", r.loglik], ["parameters", r.n_params], ["AICc", r.aicc], ["BIC", r.bic],
      ["confidence level", level], ["interval method", r.ci_method],
    ],
  };
}

function describeDistribution(r: LifeDistributionResult, alpha: number): TestOutput {
  const level = `${Number(((1 - alpha) * 100).toPrecision(3))}%`;
  const ci = (name: string) => r.parameters.find((p) => p.name.startsWith(name));
  const shape = ci("beta") ?? ci("sigma");
  const scale = ci("eta") ?? ci("theta") ?? ci("median") ?? ci("mu");
  const b = r.quantiles[0];
  const parts = [
    scale ? `${scale.name.split(" ")[0]} = ${num(scale.estimate)} (${level} CI ${range(scale.ci_low, scale.ci_high)})` : "",
    shape && r.distribution !== "exponential" ? `${shape.name.split(" ")[0]} = ${num(shape.estimate)} (${range(shape.ci_low, shape.ci_high)})` : "",
    b ? `${pct(b.p)} life = ${num(b.time)} (${range(b.ci_low, b.ci_high)})` : "",
  ].filter(Boolean);
  const sentence = `${NAMES[r.distribution]} fit to ${r.n} units (${r.n_failed} failed, ${r.n_censored} censored): ${parts.join("; ")}. ` +
    `Wald intervals, approximate for small samples; check the probability plot before trusting the extrapolation.`;
  const tables: ResultTable[] = [
    { title: "Parameter estimates", columns: ["parameter", "estimate", "SE", `${level} CI low`, `${level} CI high`], rows: paramRows(r.parameters) },
    fitRows(r, level),
  ];
  if (r.comparison.length > 0) {
    tables.push({
      title: "Model comparison",
      columns: ["distribution", "log-likelihood", "parameters", "AICc", "BIC", "ΔAICc", "ΔBIC", "note"],
      rows: r.comparison.map((c): Cell[] => [NAMES[c.distribution] ?? c.distribution, c.loglik, c.n_params, c.aicc, c.bic, c.delta_aicc ?? null, c.delta_bic ?? null, c.note ?? ""]),
    });
  }
  tables.push({
    title: "Quantiles (B-lives)",
    columns: ["life", "time", `${level} CI low`, `${level} CI high`],
    rows: r.quantiles.map((q): Cell[] => [pct(q.p), q.time, q.ci_low, q.ci_high]),
  });
  if (r.probabilities.length > 0) {
    tables.push({
      title: "Failure probability at time",
      columns: ["time", "P(failed by t)", `${level} CI low`, `${level} CI high`, "reliability"],
      rows: r.probabilities.map((p): Cell[] => [p.time, p.probability, p.ci_low, p.ci_high, p.reliability]),
    });
  }
  const km = r.kaplan_meier;
  tables.push({
    title: "Kaplan-Meier",
    columns: ["time", "at risk", "failures", "survival", "SE (Greenwood)", `${level} CI low`, `${level} CI high`],
    rows: km.times.map((t, i): Cell[] => [t, km.at_risk[i], km.events[i], km.survival[i], km.std_error[i], km.ci_low[i], km.ci_high[i]]),
  });
  return { sentence, tables, life: { kind: "life", result: r } };
}

function describeByX(r: LifeByXResult, alpha: number): TestOutput {
  const level = `${Number(((1 - alpha) * 100).toPrecision(3))}%`;
  const slope = r.parameters[1];
  const lead = r.transform.startsWith("arrhenius")
    ? `Activation energy Ea = ${num(slope.estimate)} eV (${level} CI ${range(slope.ci_low, slope.ci_high)})`
    : `Slope on ${r.transform === "power" ? "ln x" : "x"} = ${num(slope.estimate)} (${level} CI ${range(slope.ci_low, slope.ci_high)})`;
  const use = r.use_quantiles[0];
  const tail = use ? `; at the use condition ${num(r.use_x)} the ${pct(use.p)} life is ${num(use.time)} (${range(use.ci_low, use.ci_high)})` : "; enter a use condition to extrapolate life";
  const tables: ResultTable[] = [
    { title: "Coefficients", columns: ["parameter", "estimate", "SE", `${level} CI low`, `${level} CI high`], rows: paramRows(r.parameters) },
    fitRows(r, level),
    { title: "Stress levels", columns: ["x", "transformed x", "units", "failures"], rows: r.levels.map((l): Cell[] => [l.x, l.x_transformed, l.n, l.n_failed]) },
  ];
  if (use) {
    tables.push({
      title: "Life at the use condition",
      columns: ["life", "time", `${level} CI low`, `${level} CI high`],
      rows: r.use_quantiles.map((q): Cell[] => [pct(q.p), q.time, q.ci_low, q.ci_high]),
    });
    tables.push({
      title: "Acceleration factors (use vs tested stress)",
      columns: ["stress x", "factor", `${level} CI low`, `${level} CI high`],
      rows: r.acceleration.map((a): Cell[] => [a.x, a.factor, a.ci_low, a.ci_high]),
    });
  }
  const sentence = `${NAMES[r.distribution]} life-stress regression on ${r.n} units (${r.n_failed} failed, ${r.n_censored} censored): ${lead}${tail}. ` +
    "Extrapolating to use conditions assumes the same failure mechanism holds below the tested stress.";
  return { sentence, tables };
}

export function describeLife(result: LifeTestResult, alpha: number): TestOutput {
  return result.id === "life-distribution" ? describeDistribution(result.data, alpha) : describeByX(result.data, alpha);
}
