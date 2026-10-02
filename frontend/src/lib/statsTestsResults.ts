// Statistical-tests workshop — turns a test's raw result into display tables
// plus ONE plain-language sentence ("p = 0.03: the distributions of a and b
// differ at the 5% level"), and serializes both for Copy (TSV) and Export
// (CSV). Pure; the sibling of statsTests.ts (request building).
//
// Tables hold RAW numbers (the view formats them, the exports keep full
// precision). `labels` is what statsTests.buildTestRequest returned for the
// same request, so rows name the user's columns, not "group 1" or "x2".

import type { AnovaTableRow, MultiRegressionResult, StatsTestResult } from "./api/statsTests";
import { csvTextCell } from "./csvCell";

export type Cell = string | number | null;

export interface ResultTable {
  title?: string;
  columns: string[];
  rows: Cell[][];
}

export interface TestOutput {
  sentence: string;
  tables: ResultTable[];
}

/** "p = 0.031", "p < 0.0001", or "p = —" when the test produced none. */
export function fmtP(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "p = —";
  if (p < 1e-4) return "p < 0.0001";
  return `p = ${Number(p.toPrecision(2))}`;
}

/** Three significant figures for numbers inside a sentence. */
const num = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? "—" : String(Number(v.toPrecision(3)));

const level = (alpha: number): string => `${Number((alpha * 100).toPrecision(3))}%`;

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** "a", "a and b", "a, b and c". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "p = X: <yes> at the 5% level." or "p = X: no evidence <no> at the 5% level." */
function verdict(p: number | null, alpha: number, yes: string, no: string): string {
  const sig = p != null && p < alpha;
  return `${fmtP(p)}: ${sig ? yes : `no evidence ${no}`} at the ${level(alpha)} level.`;
}

const statTable = (rows: [string, Cell][]): ResultTable => ({ columns: ["statistic", "value"], rows });

const ANOVA_COLUMNS = ["source", "SS", "df", "MS", "F", "p"];

function anovaRows(table: AnovaTableRow[], rename: (s: string) => string = (s) => s): Cell[][] {
  return table.map((r) => [rename(r.source), r.SS, r.df, r.MS, r.F, r.p]);
}

function coefficientTable(m: MultiRegressionResult, terms: string[]): ResultTable {
  return {
    title: "Coefficients",
    columns: ["term", "coefficient", "SE", "t", "p", "CI low", "CI high"],
    rows: m.coeffs.map((c, i) => [terms[i] ?? `x${i}`, c, m.se[i], m.tStats[i], m.pValues[i], m.ciLow[i], m.ciHigh[i]]),
  };
}

function fitTable(m: MultiRegressionResult): ResultTable {
  return {
    title: "Model fit",
    ...statTable([
      ["R²", m.R2],
      ["adjusted R²", m.R2adj],
      ["F", m.fStat],
      ["p (F)", m.fPvalue],
      ["RMSE", m.RMSE],
      ["N", m.N],
      ["residual df", m.df],
    ]),
  };
}

/** Tables + one-sentence interpretation for a test result. */
export function describeResult(result: StatsTestResult, labels: string[], alpha: number): TestOutput {
  const [a = "the column", b = "the second column"] = labels;
  switch (result.id) {
    case "anderson": {
      const r = result.data;
      const i5 = r.significance_levels_pct.indexOf(5);
      const crit = r.critical_values[i5 >= 0 ? i5 : 0];
      const sentence = r.reject_at_5pct
        ? `A² = ${num(r.A2)} exceeds the 5% critical value ${num(crit)}: ${a} is not normally distributed.`
        : `A² = ${num(r.A2)} is below the 5% critical value ${num(crit)}: no evidence ${a} departs from normal.`;
      return {
        sentence,
        tables: [
          statTable([["A²", r.A2], ["N", r.N], ["reject normality at 5%", r.reject_at_5pct ? "yes" : "no"]]),
          {
            title: "Critical values",
            columns: ["significance level (%)", "critical value"],
            rows: r.significance_levels_pct.map((s, i) => [s, r.critical_values[i]]),
          },
        ],
      };
    }
    case "ks-normal": {
      const r = result.data;
      return {
        sentence: verdict(r.p, alpha, `${a} departs from a normal distribution`, `${a} departs from a normal distribution`),
        tables: [
          statTable([
            ["D", r.D],
            ["p", r.p],
            ["mean", r.loc],
            ["SD", r.scale],
            ["N", r.N],
            ["mean/SD estimated from data", r.params_estimated ? "yes (p is approximate)" : "no"],
          ]),
        ],
      };
    }
    case "ks-two-sample": {
      const r = result.data;
      const what = `the distributions of ${a} and ${b} differ`;
      return {
        sentence: verdict(r.p, alpha, what, what),
        tables: [statTable([["D", r.D], ["p", r.p], [`n (${a})`, r.n1], [`n (${b})`, r.n2], ["alternative", r.alternative]])],
      };
    }
    case "sign-test": {
      const r = result.data;
      const what = `${a} and ${b} differ systematically`;
      return {
        sentence: verdict(r.p, alpha, what, what),
        tables: [
          statTable([
            [`${a} > ${b}`, r.n_pos],
            [`${a} < ${b}`, r.n_neg],
            ["nonzero pairs", r.n],
            ["p", r.p],
            ["alternative", r.alternative],
          ]),
        ],
      };
    }
    case "dunnett": {
      const r = result.data;
      const control = labels[r.control] ?? "the control";
      const hits = r.comparisons.filter((c) => c.significant).map((c) => labels[c.group] ?? `group ${c.group + 1}`);
      const sentence =
        hits.length === 0
          ? `No group differs from the control ${control} at the ${level(alpha)} level.`
          : `${hits.length} of ${r.comparisons.length} groups differ from the control ${control} at the ${level(alpha)} level: ${listOf(hits)}.`;
      return {
        sentence,
        tables: [
          {
            columns: ["group", "diff vs control", "statistic", "p", "CI low", "CI high", "significant"],
            rows: r.comparisons.map((c) => [
              labels[c.group] ?? `group ${c.group + 1}`,
              c.diff,
              c.statistic,
              c.p,
              c.ciLow,
              c.ciHigh,
              c.significant ? "yes" : "no",
            ]),
          },
        ],
      };
    }
    case "friedman": {
      const r = result.data;
      return {
        sentence: verdict(
          r.p,
          alpha,
          `at least one of the ${r.n_treatments} conditions differs across ${r.n_blocks} blocks`,
          `the ${r.n_treatments} conditions differ across ${r.n_blocks} blocks`,
        ),
        tables: [statTable([["χ²", r.chi2], ["df", r.df], ["p", r.p], ["conditions", r.n_treatments], ["blocks", r.n_blocks]])],
      };
    }
    case "anova-rm": {
      const r = result.data;
      const cond = r.table.find((row) => row.source === "Conditions");
      const gg = r.sphericity.p_greenhouse_geisser;
      const p = gg ?? cond?.p ?? null;
      const what = `the means of ${listOf(labels)} differ`;
      const base = verdict(p, alpha, what, what);
      return {
        sentence: gg != null ? `Greenhouse-Geisser ${base}` : base,
        tables: [
          { title: "ANOVA", columns: ANOVA_COLUMNS, rows: anovaRows(r.table) },
          {
            title: "Sphericity corrections",
            ...statTable([
              ["Greenhouse-Geisser ε", r.sphericity.greenhouse_geisser],
              ["Greenhouse-Geisser p", gg],
              ["Huynh-Feldt ε", r.sphericity.huynh_feldt],
              ["Huynh-Feldt p", r.sphericity.p_huynh_feldt],
              ["partial η²", r.partial_eta_sq],
            ]),
          },
        ],
      };
    }
    case "anova2-unbalanced": {
      const r = result.data;
      const [resp = "the response", fa = "A", fb = "B"] = labels;
      const rename = (s: string) => (s === "A" ? fa : s === "B" ? fb : s === "AxB" ? `${fa} × ${fb}` : s);
      const terms = r.table.filter((row) => ["A", "B", "AxB"].includes(row.source));
      const sig = terms.filter((t) => t.p != null && t.p < alpha);
      const non = terms.filter((t) => !(t.p != null && t.p < alpha)).map((t) => rename(t.source));
      let sentence: string;
      if (sig.length === 0) sentence = `At the ${level(alpha)} level neither ${fa}, ${fb} nor their interaction affects ${resp}.`;
      else {
        const hit = listOf(sig.map((t) => `${rename(t.source)} (${fmtP(t.p)})`));
        const miss = non.length === 0 ? "" : `; ${listOf(non)} ${non.length === 1 ? "does" : "do"} not`;
        sentence = `At the ${level(alpha)} level ${hit} ${sig.length === terms.length ? "all affect" : "affect"} ${resp}${miss}.`;
      }
      return {
        sentence,
        tables: [{ title: `Type ${r.ss_type} SS`, columns: ANOVA_COLUMNS, rows: anovaRows(r.table, rename) }],
      };
    }
    case "regression-multi": {
      const m = result.data;
      const [resp = "the response", ...preds] = labels;
      const terms = ["(intercept)", ...preds];
      const sigTerms = preds.filter((_, i) => {
        const p = m.pValues[i + 1];
        return p != null && p < alpha;
      });
      const overall = m.fPvalue != null && m.fPvalue < alpha;
      const tail = overall
        ? `the predictors explain ${resp} at the ${level(alpha)} level; ${sigTerms.length ? `significant terms: ${listOf(sigTerms)}` : "no single term is significant"}.`
        : `no evidence the predictors explain ${resp} at the ${level(alpha)} level.`;
      return {
        sentence: `R² = ${num(m.R2)}, overall ${fmtP(m.fPvalue)}: ${tail}`,
        tables: [coefficientTable(m, terms), fitTable(m)],
      };
    }
    case "stepwise": {
      const r = result.data;
      const [, ...preds] = labels;
      const kept = r.selected.map((i) => preds[i] ?? `x${i + 1}`);
      const how = `${r.direction[0].toUpperCase()}${r.direction.slice(1)} ${r.criterion.toUpperCase()} selection`;
      const sentence =
        kept.length === 0
          ? `${how} keeps none of the ${r.n_candidates} predictors.`
          : `${how} keeps ${kept.length} of ${r.n_candidates} predictors: ${listOf(kept)} (R² = ${num(r.model.R2)}).`;
      return {
        sentence,
        tables: [
          coefficientTable(r.model, ["(intercept)", ...kept]),
          fitTable(r.model),
          {
            title: "Steps",
            columns: ["step", "predictor", r.criterion.toUpperCase()],
            rows: r.history.map((h) => [h.action, h.index == null ? "—" : (preds[h.index] ?? `x${h.index + 1}`), h.criterion]),
          },
        ],
      };
    }
    case "partial-correlation": {
      const r = result.data;
      let best: [number, number, number] | null = null;
      for (let i = 0; i < r.r.length; i++) {
        for (let j = i + 1; j < r.r.length; j++) {
          const v = r.r[i][j];
          if (v != null && (best == null || Math.abs(v) > Math.abs(best[2]))) best = [i, j, v];
        }
      }
      const others = `${r.controlled} other column${r.controlled === 1 ? "" : "s"}`;
      const sentence = best
        ? `Strongest partial correlation: ${labels[best[0]]} and ${labels[best[1]]}, r = ${num(best[2])}, holding the ${others} fixed (N = ${r.N}).`
        : `No partial correlation could be computed (N = ${r.N}).`;
      return {
        sentence,
        tables: [{ title: "Partial r", columns: ["", ...labels], rows: r.r.map((row, i) => [labels[i] ?? "", ...row]) }],
      };
    }
    case "power": {
      const r = result.data;
      const test = `${r.tails === 1 ? "one" : "two"}-sided ${r.kind} t-test`;
      const unit = r.kind === "two-sample" ? " per group" : r.kind === "paired" ? " pairs" : "";
      const at = `to detect d = ${num(r.effect_size)} at the ${level(r.alpha)} level`;
      if ("power" in r) {
        return {
          sentence: `With n = ${r.n}${unit}, a ${test} has ${pct(r.power)} power ${at}.`,
          tables: [statTable([["power", r.power], ["n", r.n], ["effect size d", r.effect_size], ["alpha", r.alpha], ["tails", r.tails]])],
        };
      }
      return {
        sentence: `A ${test} needs n = ${r.n}${unit} for ${pct(r.target_power)} power ${at} (achieves ${pct(r.achieved_power)}).`,
        tables: [
          statTable([
            ["n", r.n],
            ["achieved power", r.achieved_power],
            ["target power", r.target_power],
            ["effect size d", r.effect_size],
            ["alpha", r.alpha],
            ["tails", r.tails],
          ]),
        ],
      };
    }
  }
}

function serialize(out: TestOutput, sep: string, cell: (v: Cell) => string): string {
  const lines = [cell(out.sentence)];
  for (const t of out.tables) {
    lines.push("");
    if (t.title) lines.push(cell(t.title));
    lines.push(t.columns.map(cell).join(sep));
    for (const row of t.rows) lines.push(row.map(cell).join(sep));
  }
  return lines.join("\n");
}

const plain = (v: Cell): string => (v == null ? "" : String(v));

/** The sentence and every table as tab-separated text (for the clipboard). */
export function outputToTSV(out: TestOutput): string {
  return serialize(out, "\t", plain);
}

/** The sentence and every table as RFC-4180 CSV (for Export). */
export function outputToCSV(out: TestOutput): string {
  // Text cells may carry file-derived labels: formula-neutralized (OWASP).
  return serialize(out, ",", (v) => (typeof v === "string" ? csvTextCell(v) : plain(v)));
}
