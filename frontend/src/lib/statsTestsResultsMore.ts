// Statistical-tests workshop — display tables and the plain-language conclusion
// for the GAP_AUDIT_9 G6 tests (Welch ANOVA, post hoc, variance, TOST, tolerance
// intervals, proportions). Sibling of statsTestsResults.ts (which delegates
// here); pure. Tables hold raw numbers. Every sentence states the decision at
// the chosen alpha (tolerance intervals: at the chosen coverage / confidence).

import type { StatsTestResult } from "./api/statsTests";
import type { PosthocPair, PosthocResult } from "./api/statsTestsMore";
import type { Cell, ResultTable, TestOutput } from "./statsTestsResults";

export type MoreTestResult = Extract<
  StatsTestResult,
  { id: "welch-anova" | "posthoc" | "variance-test" | "tost-one" | "tost-two" | "tolerance-interval" | "tolerance-interval-np" | "mood-median" | "poisson-rate" | "binomial-test" | "two-proportions" | "fisher-2x2" }
>;

type Num = number | null | undefined;
const isNum = (v: Num): v is number => v != null && Number.isFinite(v);
const num = (v: Num): string => (isNum(v) ? String(Number(v.toPrecision(3))) : "—");
const level = (alpha: number): string => `${Number((alpha * 100).toPrecision(3))}%`;
const fmtP = (p: Num): string => (!isNum(p) ? "p = —" : p < 1e-4 ? "p < 0.0001" : `p = ${Number(p.toPrecision(2))}`);
const statTable = (rows: [string, Cell][], title?: string): ResultTable => ({ ...(title ? { title } : {}), columns: ["statistic", "value"], rows });
const yn = (b: boolean): string => (b ? "yes" : "no");
const list = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function ordinal(n: number): string {
  const tail = n % 100;
  const suffix = tail >= 11 && tail <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

function posthocTable(pairs: PosthocPair[], labels: string[], key: PosthocResult["key"]): ResultTable {
  const name = (i: number) => labels[i] ?? `group ${i + 1}`;
  const extra = pairs.some((r) => r.se !== undefined);
  const rank = key === "dunn-sidak";
  // Steel-Dwass: each pair is ranked on its own; W is the first group's rank sum, z its standardised value.
  if (key === "steel-dwass") {
    return {
      title: "Pairwise comparisons (pairwise rank sums)",
      columns: ["pair", "W (rank sum of first)", "W − E(W)", "z", "q (√2·|z|)", "p (studentized range)", "significant"],
      rows: pairs.map((r): Cell[] => [`${name(r.i)} − ${name(r.j)}`, r.W ?? null, r.diff, r.statistic ?? null, r.q ?? null, r.p, yn(r.significant)]),
    };
  }
  // Dunn-Šidák compares mean RANKS (z statistic, no df, no mean-difference CI or Cohen's d).
  if (rank) {
    return {
      title: "Pairwise comparisons (mean-rank differences)",
      columns: ["pair", "mean-rank difference", "SE", "z", "p (Šidák-adjusted)", "significant"],
      rows: pairs.map((r): Cell[] => [`${name(r.i)} − ${name(r.j)}`, r.diff, r.se ?? null, r.statistic ?? null, r.p, yn(r.significant)]),
    };
  }
  return {
    title: "Pairwise comparisons",
    columns: ["pair", "difference", ...(extra ? ["SE", "t", "df"] : []), "p", "CI low", "CI high", "Cohen's d", "significant"],
    rows: pairs.map((r): Cell[] => [
      `${name(r.i)} − ${name(r.j)}`, r.diff, ...(extra ? [r.se ?? null, r.statistic ?? null, r.df ?? null] : []),
      r.p, r.ciLow, r.ciHigh, r.effect_size, yn(r.significant),
    ]),
  };
}

export function describeMore(result: MoreTestResult, labels: string[], alpha: number): TestOutput {
  const [a = "the column", b = "the second column"] = labels;
  const at = `at the ${level(alpha)} level`;
  switch (result.id) {
    case "welch-anova": {
      const r = result.data;
      const sentence = r.significant
        ? `${fmtP(r.p)}: the group means differ ${at} (Welch F(${num(r.df1)}, ${num(r.df2)}) = ${num(r.F)}; equal variances not assumed).`
        : `${fmtP(r.p)}: no evidence the group means differ ${at} (Welch F(${num(r.df1)}, ${num(r.df2)}) = ${num(r.F)}).`;
      return {
        sentence,
        tables: [
          statTable([["Welch F", r.F], ["df1", r.df1], ["df2", r.df2], ["p", r.p], ["ω² (approximate)", r.omega_sq], ["N", r.N], ["classical F (equal variances)", r.classical_F], ["classical p", r.classical_p]]),
          { title: "Groups", columns: ["group", "n", "mean", "SD"], rows: r.groups.map((g): Cell[] => [labels[g.index] ?? `group ${g.index + 1}`, g.n, g.mean, g.sd]) },
        ],
      };
    }
    case "posthoc": {
      const r = result.data;
      const hits = r.pairs.filter((x) => x.significant).map((x) => `${labels[x.i] ?? x.i + 1} vs ${labels[x.j] ?? x.j + 1}`);
      const head = hits.length === 0
        ? `${r.method}: no pair of groups differs ${at}.`
        : `${r.method}: ${hits.length} of ${r.pairs.length} pairs differ ${at}: ${list(hits)}.`;
      const note = r.adjusted ? "" : ` Fisher LSD does not correct for multiple comparisons${isNum(r.omnibus_p) && r.omnibus_p >= alpha ? "; the overall ANOVA is not significant, so treat any difference as unconfirmed" : "; trust it only because the overall ANOVA is significant"}.`;
      return { sentence: head + note, tables: [posthocTable(r.pairs, labels, r.key), statTable([["method", r.method], [r.key === "dunn-sidak" || r.key === "steel-dwass" ? "overall Kruskal-Wallis p" : "overall ANOVA p", r.omnibus_p], ["alpha", r.alpha]], "Settings")] };
    }
    case "variance-test": {
      const r = result.data;
      const what = "the group variances differ";
      const sig = r.significant;
      const sentence = `${fmtP(r.p)}: ${sig ? what : `no evidence ${what}`} ${at} (${r.method}, ${r.statistic_name} = ${num(r.statistic)}).`;
      const rows: [string, Cell][] = [[r.statistic_name, r.statistic], ["df1", r.df1], ["df2", r.df2 ?? null], ["p", r.p]];
      if (r.ratio !== undefined) rows.push([`variance ratio (${a} / ${b})`, r.ratio], ["ratio CI low", r.ratio_ci_low ?? null], ["ratio CI high", r.ratio_ci_high ?? null]);
      return {
        sentence,
        tables: [statTable(rows), { title: "Groups", columns: ["group", "n", "variance"], rows: r.groups.map((g): Cell[] => [labels[g.index] ?? `group ${g.index + 1}`, g.n, g.variance]) }],
      };
    }
    case "tost-one":
    case "tost-two": {
      const r = result.data;
      const subject = result.id === "tost-one" ? `the mean of ${a} is within ${num(r.high)} of ${num(r.mu0 ?? 0)}` : `${a} and ${b} are equivalent (difference within ±${num(r.high)})`;
      const ci = `${num(r.ci_level * 100)}% CI [${num(r.ci_low)}, ${num(r.ci_high)}]`;
      const sentence = r.equivalent
        ? `${fmtP(r.p)}: equivalent ${at}; ${subject} (${ci} lies inside [${num(r.low)}, ${num(r.high)}]).`
        : `${fmtP(r.p)}: equivalence NOT shown ${at} (${ci} is not inside [${num(r.low)}, ${num(r.high)}]). This does not prove a difference; the data may be too variable or too few.`;
      return {
        sentence,
        tables: [statTable([
          ["difference", r.diff], ["SE", r.se], ["df", r.df], ["lower bound", r.low], ["upper bound", r.high],
          ["t (vs lower)", r.t_lower], ["p (vs lower)", r.p_lower], ["t (vs upper)", r.t_upper], ["p (vs upper)", r.p_upper],
          ["TOST p (larger of the two)", r.p], [`${num(r.ci_level * 100)}% CI low`, r.ci_low], [`${num(r.ci_level * 100)}% CI high`, r.ci_high],
          ["Cohen's d", r.effect_size], ["design", r.design], ["equivalent", yn(r.equivalent)],
        ])],
      };
    }
    case "tolerance-interval": {
      const r = result.data;
      const share = level(r.coverage), conf = level(r.confidence);
      const span = r.sides === "two" ? `between ${num(r.lower)} and ${num(r.upper)}`
        : r.sides === "upper" ? `below ${num(r.upper)}` : `above ${num(r.lower)}`;
      return {
        sentence: `With ${conf} confidence, at least ${share} of the population lies ${span} (mean ± k·s with k = ${num(r.k)}, n = ${r.n}). Assumes ${a} is normally distributed.`,
        tables: [statTable([
          ["lower limit", r.lower], ["upper limit", r.upper], ["k factor", r.k], ["k (Howe approximation)", r.k_howe],
          ["mean", r.mean], ["SD", r.sd], ["n", r.n], ["coverage", r.coverage], ["confidence", r.confidence], ["sides", r.sides],
        ])],
      };
    }
    case "tolerance-interval-np": {
      const r = result.data;
      const share = level(r.coverage), conf = level(r.confidence);
      const span = r.sides === "two" ? `between ${num(r.lower)} and ${num(r.upper)}`
        : r.sides === "upper" ? `below ${num(r.upper)}` : `above ${num(r.lower)}`;
      const end = r.rank_from_each_end === 1 ? "the sample extreme" : `the ${ordinal(r.rank_from_each_end)} value in from the extreme`;
      return {
        sentence: `With at least ${conf} confidence (achieved ${level(r.achieved_confidence)}), at least ${share} of the population lies ${span}; limits are ${end} of ${a} (n = ${r.n}, no distribution assumed).`,
        tables: [statTable([
          ["lower limit", r.lower], ["upper limit", r.upper], ["order statistic used (from each end)", r.rank_from_each_end],
          ["achieved confidence", r.achieved_confidence], ["confidence using the extremes", r.extremes_confidence],
          ["smallest n for the extremes at this coverage / confidence", r.min_n_extremes],
          ["n", r.n], ["coverage", r.coverage], ["confidence", r.confidence], ["sides", r.sides],
        ])],
      };
    }
    case "mood-median": {
      const r = result.data;
      const what = "the group medians differ";
      const thin = r.min_expected < 5 ? ` Some expected counts are below 5 (smallest ${num(r.min_expected)}); treat the p value with caution.` : "";
      return {
        sentence: `${fmtP(r.p)}: ${r.significant ? what : `no evidence ${what}`} ${at} (${r.method}, χ²(${r.df}) = ${num(r.statistic)}; grand median ${num(r.grand_median)}).${thin}`,
        tables: [
          statTable([["χ²", r.statistic], ["df", r.df], ["p", r.p], ["grand median", r.grand_median], ["smallest expected count", r.min_expected], ["method", r.method]]),
          { title: "Counts about the grand median", columns: ["group", "n", "above", "at or below", "group median"], rows: r.groups.map((g): Cell[] => [labels[g.index] ?? `group ${g.index + 1}`, g.n, g.above, g.below, g.median]) },
        ],
      };
    }
    case "poisson-rate": {
      const r = result.data;
      const ci = `${level(1 - alpha)} CI ${num(r.ci_low)} to ${isNum(r.ci_high) ? num(r.ci_high) : "∞"}`;
      if (r.samples === 1) {
        const what = `the event rate differs from ${num(r.rate0)}`;
        return {
          sentence: `${fmtP(r.p)}: ${r.significant ? what : `no evidence ${what}`} ${at} (${r.x1} events in ${num(r.t1)} = ${num(r.rate1)} per unit; ${ci}; exact Poisson test).`,
          tables: [statTable([["events", r.x1], ["exposure", r.t1], ["observed rate", r.rate1], ["hypothesized rate", r.rate0 ?? null], ["p (exact)", r.p], ["CI low (Garwood)", r.ci_low], ["CI high (Garwood)", r.ci_high], ["alternative", r.alternative]])],
        };
      }
      const what = "the two event rates differ";
      return {
        sentence: `${fmtP(r.p)}: ${r.significant ? what : `no evidence ${what}`} ${at} (rate ratio ${isNum(r.ratio) ? num(r.ratio) : "∞"}; ${ci}; exact conditional test).`,
        tables: [statTable([["events 1", r.x1], ["exposure 1", r.t1], ["rate 1", r.rate1], ["events 2", r.x2 ?? null], ["exposure 2", r.t2 ?? null], ["rate 2", r.rate2 ?? null], ["rate ratio (1 / 2)", r.ratio ?? null], ["hypothesized ratio", r.ratio0 ?? null], ["p (exact)", r.p], ["CI low", r.ci_low], ["CI high", r.ci_high], ["alternative", r.alternative]])],
      };
    }
    case "binomial-test": {
      const r = result.data;
      const what = `the success rate differs from ${num(r.p0)}`;
      return {
        sentence: `${fmtP(r.p)}: ${r.significant ? what : `no evidence ${what}`} ${at} (${r.x} of ${r.n} = ${num(r.phat)}; ${level(1 - alpha)} ${r.ci_method} CI ${num(r.ci_low)} to ${num(r.ci_high)}).`,
        tables: [statTable([
          ["successes", r.x], ["trials", r.n], ["observed proportion", r.phat], ["hypothesized p0", r.p0], ["z", r.statistic], ["p", r.p],
          [`${r.ci_method} CI low`, r.ci_low], [`${r.ci_method} CI high`, r.ci_high], ["Cohen's h", r.effect_size], ["method", r.method], ["alternative", r.alternative],
        ])],
      };
    }
    case "two-proportions": {
      const r = result.data;
      const what = "the two success rates differ";
      return {
        sentence: `${fmtP(r.p)}: ${r.significant ? what : `no evidence ${what}`} ${at} (${num(r.p1)} vs ${num(r.p2)}; difference ${num(r.diff)}, ${level(1 - alpha)} CI ${num(r.ci_low)} to ${num(r.ci_high)}).`,
        tables: [statTable([
          ["proportion 1", r.p1], ["proportion 2", r.p2], ["difference", r.diff], ["z", r.statistic], ["p", r.p],
          ["CI low (Newcombe)", r.ci_low], ["CI high (Newcombe)", r.ci_high], ["risk ratio", r.risk_ratio], ["odds ratio", r.odds_ratio],
          ["Cohen's h", r.effect_size], ["alternative", r.alternative],
        ])],
      };
    }
    case "fisher-2x2": {
      const r = result.data;
      const what = "the two success rates differ";
      return {
        sentence: `${fmtP(r.p)}: ${r.significant ? what : `no evidence ${what}`} ${at} (Fisher exact; odds ratio ${num(r.odds_ratio)}, ${level(1 - alpha)} CI ${num(r.ci_low)} to ${num(r.ci_high)}).`,
        tables: [
          statTable([["p (exact)", r.p], ["odds ratio (conditional MLE)", r.odds_ratio], ["sample odds ratio", r.sample_odds_ratio], ["CI low", r.ci_low], ["CI high", r.ci_high], ["Cohen's h", r.effect_size], ["alternative", r.alternative]]),
          { title: "Table", columns: ["", "success", "failure"], rows: r.table.map((row, i): Cell[] => [`group ${i + 1}`, row[0], row[1]]) },
        ],
      };
    }
  }
}
