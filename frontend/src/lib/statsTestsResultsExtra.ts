// Statistical-tests workshop — display tables and the one-sentence reading for
// the classification / GLM / goodness-of-fit / p-adjustment tests. Sibling of
// statsTestsResults.ts (which delegates here); pure. Tables hold raw numbers.

import type { StatsTestResult } from "./api/statsTests";
import type { GlmResult } from "./api/statsTestsExtra";
import type { Cell, ResultTable, TestOutput } from "./statsTestsResults";

export type ExtraTestResult = Extract<
  StatsTestResult,
  { id: "roc" | "glm-logistic" | "glm-poisson" | "chi-square-gof" | "adjust-p" }
>;

type Num = number | null | undefined;

const isNum = (v: Num): v is number => v != null && Number.isFinite(v);
const num = (v: Num): string => (isNum(v) ? String(Number(v.toPrecision(3))) : "—");
const level = (alpha: number): string => `${Number((alpha * 100).toPrecision(3))}%`;
const fmtP = (p: Num): string => (!isNum(p) ? "p = —" : p < 1e-4 ? "p < 0.0001" : `p = ${Number(p.toPrecision(2))}`);
const listOf = (items: string[]): string =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const statTable = (rows: [string, Cell][], title?: string): ResultTable => ({
  ...(title ? { title } : {}),
  columns: ["statistic", "value"],
  rows,
});
/** exp(v), or null when it is not a finite number (a huge coefficient overflows). */
const expOrNull = (v: Num): number | null => {
  if (!isNum(v)) return null;
  const e = Math.exp(v);
  return Number.isFinite(e) ? e : null;
};

function describeRoc(r: Extract<ExtraTestResult, { id: "roc" }>["data"], labels: string[]): TestOutput {
  const [outcome = "the outcome", score = "the score"] = labels;
  const { roc, youden } = r;
  const sens = youden.tpr;
  const spec = isNum(youden.fpr) ? 1 - youden.fpr : null;
  const head = `AUC = ${num(roc.auc)}: ${score} separates ${outcome} = 1 (${roc.nPositive} rows) from ${outcome} = 0 (${roc.nNegative} rows).`;
  const inverted = isNum(roc.auc) && roc.auc < 0.5 ? ` AUC is below 0.5, so a LOWER ${score} predicts ${outcome} = 1; reverse the score to read it the usual way.` : "";
  const cut = isNum(youden.youdenJ) && youden.youdenJ > 0 && isNum(youden.optimalThreshold)
    ? ` Youden-optimal cutoff: ${score} >= ${num(youden.optimalThreshold)} (sensitivity ${num(sens)}, specificity ${num(spec)}, J = ${num(youden.youdenJ)}).`
    : ` No cutoff separates the outcomes better than chance.`;
  return {
    sentence: `${head}${inverted}${cut}`,
    tables: [
      statTable([
        ["AUC", roc.auc],
        ["N (complete rows)", roc.N],
        ["positives (1)", roc.nPositive],
        ["negatives (0)", roc.nNegative],
        ["Youden cutoff (score >= this is positive)", youden.optimalThreshold],
        ["Youden J (sensitivity + specificity - 1)", youden.youdenJ],
        ["sensitivity (TPR) at cutoff", sens],
        ["specificity (1 - FPR) at cutoff", spec],
      ]),
      {
        title: "ROC curve",
        columns: ["threshold (score >=)", "FPR", "TPR"],
        rows: roc.thresholds.map((t, i): Cell[] => [t, roc.fpr[i], roc.tpr[i]]),
      },
    ],
  };
}

function describeGlm(r: GlmResult, labels: string[], alpha: number, logistic: boolean): TestOutput {
  const [resp = "the response", ...preds] = labels;
  const terms = ["(intercept)", ...preds];
  const ratio = logistic ? "odds ratio" : "rate ratio";
  const hits = preds.filter((_, i) => isNum(r.pValues[i + 1]) && (r.pValues[i + 1] as number) < alpha);
  const tail = hits.length > 0
    ? `significant predictors at the ${level(alpha)} level: ${listOf(hits)}.`
    : `no predictor is significant at the ${level(alpha)} level.`;
  return {
    sentence: `${logistic ? "Logistic" : "Poisson"} regression of ${resp} on ${r.N} rows (pseudo-R² = ${num(r.pseudoR2)}, AIC = ${num(r.AIC)}): ${tail}`,
    tables: [
      {
        title: "Coefficients",
        columns: ["term", "coefficient", "SE", "z", "p", "CI low", "CI high"],
        rows: r.coeffs.map((c, i) => [terms[i] ?? `x${i}`, c, r.se[i], r.zStats[i], r.pValues[i], r.ciLow[i], r.ciHigh[i]]),
      },
      {
        title: `${ratio[0].toUpperCase()}${ratio.slice(1)}s (exp of coefficient)`,
        columns: ["term", ratio, "CI low", "CI high"],
        rows: terms.slice(1).map((t, i): Cell[] => [t, expOrNull(r.coeffs[i + 1]), expOrNull(r.ciLow[i + 1]), expOrNull(r.ciHigh[i + 1])]),
      },
      statTable([["pseudo-R²", r.pseudoR2], ["AIC", r.AIC], ["deviance", r.deviance], ["N", r.N]], "Model fit"),
    ],
  };
}

const METHOD_NAME: Record<string, string> = { holm: "Holm", bonferroni: "Bonferroni", bh: "Benjamini-Hochberg (FDR)" };

/** Tables + one-sentence reading for the tests in this module. */
export function describeExtra(result: ExtraTestResult, labels: string[], alpha: number): TestOutput {
  switch (result.id) {
    case "roc":
      return describeRoc(result.data, labels);
    case "glm-logistic":
      return describeGlm(result.data, labels, alpha, true);
    case "glm-poisson":
      return describeGlm(result.data, labels, alpha, false);
    case "chi-square-gof": {
      const r = result.data;
      const [obs = "the counts"] = labels;
      const dist = labels.length > 1 ? `the expected counts in ${labels[1]}` : "a uniform distribution";
      const sig = isNum(r.p_value) && r.p_value < alpha;
      const what = `${obs} depart from ${dist}`;
      return {
        sentence: `${fmtP(r.p_value)}: ${sig ? what : `no evidence ${what}`} at the ${level(alpha)} level.`,
        tables: [statTable([["χ²", r.chi2], ["df", r.dof], ["p", r.p_value], ["categories", r.N], ["expected", labels.length > 1 ? labels[1] : "uniform"]])],
      };
    }
    case "adjust-p": {
      const r = result.data;
      const name = METHOD_NAME[r.method] ?? r.method;
      const before = r.p_values.filter((p) => p < alpha).length;
      const after = r.adjusted.filter((p) => isNum(p) && p < alpha).length;
      return {
        sentence: `${name} adjustment of ${r.m} p-values: ${after} remain below ${level(alpha)} after adjustment (${before} before).`,
        tables: [{
          columns: ["#", "p", "adjusted p", `significant at ${level(alpha)}`],
          rows: r.p_values.map((p, i): Cell[] => [i + 1, p, r.adjusted[i], isNum(r.adjusted[i]) && (r.adjusted[i] as number) < alpha ? "yes" : "no"]),
        }],
      };
    }
  }
}
