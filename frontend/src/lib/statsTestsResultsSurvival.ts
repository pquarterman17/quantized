// Statistical-tests workshop — display tables and the one-sentence reading for
// the survival tests (Kaplan-Meier, log-rank, Cox). Sibling of
// statsTestsResults.ts (which delegates here); pure. Tables hold raw numbers.
// The backend intervals are fixed at 95% and significance is read at the 5%
// level, so these readings take no alpha.

import type { StatsTestResult } from "./api/statsTests";
import type { KaplanMeierCurve } from "./api/statsTestsSurvival";
import type { Cell, ResultTable, TestOutput } from "./statsTestsResults";

export type SurvivalTestResult = Extract<StatsTestResult, { id: "kaplan-meier" | "logrank" | "cox-ph" }>;

type Num = number | null | undefined;

const ALPHA = 0.05;
const isNum = (v: Num): v is number => v != null && Number.isFinite(v);
const num = (v: Num): string => (isNum(v) ? String(Number(v.toPrecision(3))) : "—");
const fmtP = (p: Num): string => (!isNum(p) ? "p = —" : p < 1e-4 ? "p < 0.0001" : `p = ${Number(p.toPrecision(2))}`);
const listOf = (items: string[]): string =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const statTable = (rows: [string, Cell][], title?: string): ResultTable => ({
  ...(title ? { title } : {}),
  columns: ["statistic", "value"],
  rows,
});
/** A time that may never be reached (the backend sends null for infinity). */
const reached = (v: Num): Cell => (isNum(v) ? v : "not reached");
const reachedText = (v: Num): string => (isNum(v) ? num(v) : "not reached");
const expOrNull = (v: Num): number | null => {
  if (!isNum(v)) return null;
  const e = Math.exp(v);
  return Number.isFinite(e) ? e : null;
};
const sum = (xs: Num[]): number => xs.reduce<number>((a, b) => a + (isNum(b) ? b : 0), 0);

function medianText(c: KaplanMeierCurve): string {
  const ci = `95% CI ${reachedText(c.medianCiLow)} to ${reachedText(c.medianCiHigh)}`;
  return isNum(c.medianSurvival)
    ? `${num(c.medianSurvival)} (${ci})`
    : `not reached (survival stays above 50%; ${ci})`;
}

function describeKaplanMeier(r: Extract<SurvivalTestResult, { id: "kaplan-meier" }>["data"], labels: string[]): TestOutput {
  const [timeName = "time"] = labels;
  const single = r.groups.length === 1 && r.groups[0].label === "";
  const sentence = single
    ? `Kaplan-Meier: median survival in ${timeName} units is ${medianText(r.groups[0].curve)}, from ${r.groups[0].curve.N} rows with ${sum(r.groups[0].curve.events)} events.`
    : `Kaplan-Meier median survival by group (${timeName} units): ${r.groups.map((g) => `${g.label} ${medianText(g.curve)}`).join("; ")}.`;
  const summary: ResultTable = {
    title: "Median survival",
    columns: ["group", "N", "events", "median", "95% CI low", "95% CI high"],
    rows: r.groups.map((g): Cell[] => [
      g.label || "all rows", g.curve.N, sum(g.curve.events), reached(g.curve.medianSurvival),
      reached(g.curve.medianCiLow), reached(g.curve.medianCiHigh),
    ]),
  };
  const curves = r.groups.map((g): ResultTable => ({
    title: `Survival curve and at-risk table${g.label ? `: ${g.label}` : ""}`,
    columns: ["time", "at risk", "events", "S(t)", "95% CI low", "95% CI high"],
    rows: g.curve.times.map((t, i): Cell[] => [t, g.curve.atRisk[i], g.curve.events[i], g.curve.survival[i], g.curve.ciLow[i], g.curve.ciHigh[i]]),
  }));
  return { sentence, tables: [summary, ...curves] };
}

function describeLogrank(r: Extract<SurvivalTestResult, { id: "logrank" }>["data"]): TestOutput {
  const sig = isNum(r.pValue) && r.pValue < ALPHA;
  const what = `survival differs between ${listOf(r.labels)}`;
  return {
    sentence: `Log-rank test across ${r.labels.length} groups, χ²(${r.dof}) = ${num(r.statistic)}, ${fmtP(r.pValue)}: ${sig ? what : `no evidence ${what}`} at the 5% level.`,
    tables: [
      statTable([["χ²", r.statistic], ["df", r.dof], ["p", r.pValue]]),
      { title: "Groups", columns: ["group", "N", "events"], rows: r.labels.map((l, i): Cell[] => [l, r.N[i], r.observed[i]]) },
    ],
  };
}

function describeCox(r: Extract<SurvivalTestResult, { id: "cox-ph" }>["data"], labels: string[]): TestOutput {
  const terms = labels.slice(2);
  const hits = terms.filter((_, i) => isNum(r.pValues[i]) && (r.pValues[i] as number) < ALPHA);
  const tail = hits.length > 0
    ? `significant predictors at the 5% level: ${listOf(hits.map((t) => {
      const i = terms.indexOf(t);
      return `${t} (HR ${num(expOrNull(r.coeffs[i]))}, ${fmtP(r.pValues[i])})`;
    }))}. A hazard ratio above 1 means events come sooner.`
    : "no predictor is significant at the 5% level.";
  return {
    sentence: `Cox proportional-hazards model on ${r.N} rows (concordance = ${num(r.concordanceIndex)}): ${tail}`,
    tables: [
      {
        title: "Coefficients",
        columns: ["term", "coefficient", "SE", "z", "p", "95% CI low", "95% CI high"],
        rows: r.coeffs.map((c, i): Cell[] => [terms[i] ?? `x${i}`, c, r.se[i], r.zStats[i], r.pValues[i], r.ciLow[i], r.ciHigh[i]]),
      },
      {
        title: "Hazard ratios (exp of coefficient)",
        columns: ["term", "hazard ratio", "95% CI low", "95% CI high"],
        rows: terms.map((t, i): Cell[] => [t, expOrNull(r.coeffs[i]), expOrNull(r.ciLow[i]), expOrNull(r.ciHigh[i])]),
      },
      statTable([["concordance", r.concordanceIndex], ["log-likelihood", r.logLikelihood], ["partial AIC", r.AIC], ["N", r.N]], "Model fit"),
    ],
  };
}

/** Tables + one-sentence reading for the survival tests. */
export function describeSurvival(result: SurvivalTestResult, labels: string[]): TestOutput {
  switch (result.id) {
    case "kaplan-meier": return describeKaplanMeier(result.data, labels);
    case "logrank": return describeLogrank(result.data);
    case "cox-ph": return describeCox(result.data, labels);
  }
}
