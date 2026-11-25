// Statistical-tests workshop — display tables and the plain-language conclusion
// for the GAP_AUDIT_9 J14 tests (control charts, process capability). Sibling of
// statsTestsResults.ts (which delegates here); pure. Tables hold raw numbers.
// The chart / histogram itself is `TestOutput.spc`, drawn live by the workshop
// (components/workshops/statstests/SpcView); a saved result keeps the tables.

import type { StatsTestResult } from "./api/statsTests";
import type { CapabilityIndices, CapabilityResult, ControlChartResult } from "./api/statsTestsSpc";
import type { Cell, ResultTable, TestOutput } from "./statsTestsResults";

export type SpcTestResult = Extract<StatsTestResult, { id: "control-chart" | "capability" }>;

/** What the workshop draws for an SPC output. */
export type SpcDisplay =
  | { kind: "chart"; result: ControlChartResult }
  | { kind: "capability"; result: CapabilityResult };

type Num = number | null | undefined;
const isNum = (v: Num): v is number => v != null && Number.isFinite(v);
const num = (v: Num): string => (isNum(v) ? String(Number(v.toPrecision(3))) : "—");
const CHART_NAMES: Record<string, string> = {
  "xbar-r": "X-bar and R", "xbar-s": "X-bar and S", imr: "Individuals and moving range", p: "P", np: "NP", c: "C", u: "U",
  ewma: "EWMA", cusum: "CUSUM",
};

/** Human labels for the EWMA / CUSUM parameter keys (UX audit P2-8). Wording is provisional, owner to confirm. */
const PARAM_LABELS: Record<string, string> = {
  lambda: "smoothing weight (λ)", L: "limit width L (σ)", k: "reference value k (σ)", h: "decision interval h (σ)",
  K: "reference value K (data units)", H: "decision interval H (data units)", target: "target", sigma: "sigma",
  target_source: "target source", sigma_source: "sigma source",
};

function chartTables(r: ControlChartResult): ResultTable[] {
  const rows: [string, Cell][] = [
    ["chart", CHART_NAMES[r.chart] ?? r.chart], ["points / subgroups", r.n_subgroups],
    ["subgroup size", r.subgroup_size], ["center (primary chart)", r.grand_mean],
    ["dispersion center", r.dispersion_mean], ["within sigma estimate", r.sigma_within],
  ];
  for (const [k, v] of Object.entries(r.constants ?? {})) if (k !== "n") rows.push([`constant ${k}`, v]);
  for (const [k, v] of Object.entries(r.params ?? {})) rows.push([PARAM_LABELS[k] ?? k, v]);
  const tables: ResultTable[] = [{ title: "Chart summary", columns: ["statistic", "value"], rows }];
  for (const p of r.panels) {
    const beyond = new Set(p.beyond_limits);
    const rules = new Map<number, string[]>();
    for (const v of p.violations) for (const i of v.indices) rules.set(i, [...(rules.get(i) ?? []), v.rule]);
    // EWMA / CUSUM have no run rules, so the "rules" column would always be empty: leave it out.
    const withRules = r.chart !== "ewma" && r.chart !== "cusum";
    tables.push({
      title: `${p.name} chart points`,
      columns: ["point", "value", "center", "LCL", "UCL", "beyond limits", ...(withRules ? ["rules"] : [])],
      rows: p.values.map((value, i): Cell[] => [i + 1, value, p.center, p.lcl[i], p.ucl[i], beyond.has(i) ? "yes" : "no", ...(withRules ? [(rules.get(i) ?? []).join(", ")] : [])]),
    });
  }
  return tables;
}

const tablesOf = chartTables;

/** EWMA / CUSUM reading: signals only (run rules do not apply), plus the CUSUM shift-start estimate. */
function describeMemory(r: ControlChartResult, name: string, hits: string[], tables: ResultTable[]): TestOutput {
  const src = r.params ? ` (target ${r.params.target_source}, sigma ${r.params.sigma_source})` : "";
  let sentence: string;
  if (hits.length === 0) {
    sentence = `${name} chart: no signal over ${r.n_subgroups} observations; no sustained shift from the target is detected${src}.`;
  } else if (r.chart === "cusum" && r.signals?.length) {
    const parts = r.signals.map((s) => `${s.side === "upper" ? "upward" : "downward"} shift signaled at point ${s.first_signal + 1}, probably starting at point ${s.estimated_shift_start + 1}`);
    sentence = `CUSUM chart: ${parts.join("; ")}${src}. Investigate for an assignable cause.`;
  } else {
    sentence = `${name} chart: signals at ${hits.join("; ")}${src}. Investigate those points for an assignable cause.`;
  }
  return { sentence, tables, spc: { kind: "chart", result: r } };
}

function describeChart(r: ControlChartResult): TestOutput {
  const hits = r.panels.flatMap((p) => {
    const idx = [...new Set([...p.beyond_limits, ...p.flagged])].sort((a, b) => a - b);
    return idx.length ? [`${p.name} chart point${idx.length > 1 ? "s" : ""} ${idx.slice(0, 8).map((i) => i + 1).join(", ")}${idx.length > 8 ? ", …" : ""}`] : [];
  });
  const name = CHART_NAMES[r.chart] ?? r.chart;
  if (r.chart === "ewma" || r.chart === "cusum") return describeMemory(r, name, hits, tablesOf(r));
  const sentence = hits.length === 0
    ? `${name} chart: no points beyond the ±3σ limits or tripping the selected run rules over ${r.n_subgroups} ${r.chart === "imr" ? "observations" : "points"}; the process looks stable on this evidence.`
    : `${name} chart: signals at ${hits.join("; ")}. Investigate those points for an assignable cause before trusting the limits.`;
  return { sentence, tables: chartTables(r), spc: { kind: "chart", result: r } };
}

function ciCell(c: [number, number] | null | undefined): [Cell, Cell] {
  return c ? [c[0], c[1]] : [null, null];
}

function indexRows(w: CapabilityIndices, o: CapabilityIndices, cpm: Num): Cell[][] {
  const row = (label: string, v: Num, ci?: [number, number] | null): Cell[] => (isNum(v) ? [label, v, ...ciCell(ci)] : []);
  return [
    row("Cp (within)", w.cp, w.ci.cp), row("Cpk (within)", w.cpk, w.ci.cpk), row("CPU (within)", w.cpu), row("CPL (within)", w.cpl),
    row("Pp (overall)", o.pp, o.ci.pp), row("Ppk (overall)", o.ppk, o.ci.ppk), row("PPU (overall)", o.ppu), row("PPL (overall)", o.ppl),
    row("Cpm (target)", cpm),
  ].filter((r) => r.length > 0);
}

function describeCapability(r: CapabilityResult, level: string): TestOutput {
  const w = r.within, o = r.overall;
  const ppm = `${num(r.ppm_overall.total)} ppm outside the specification expected from the overall spread (normal fit)`;
  const sentence = `Cpk = ${num(w.cpk)} (within), Ppk = ${num(o.ppk)} (overall); ${ppm}. ` +
    `Within sigma ${num(w.sigma)} by ${r.within_method}; overall sigma ${num(o.sigma)}. Indices assume a normal, stable process (check the control chart first).`;
  const ppmRow = (label: string, s: CapabilityResult["ppm_within"]): Cell[] => [label, s.below, s.above, s.total];
  return {
    sentence,
    tables: [
      { title: "Capability indices", columns: ["index", "estimate", `${level} CI low`, `${level} CI high`], rows: indexRows(w, o, r.cpm) },
      { title: "Expected out of specification (ppm)", columns: ["basis", "below LSL", "above USL", "total"], rows: [ppmRow("within sigma", r.ppm_within), ppmRow("overall sigma", r.ppm_overall)] },
      {
        title: "Settings and data",
        columns: ["statistic", "value"],
        rows: [["n", r.n], ["mean", r.mean], ["LSL", r.lsl], ["USL", r.usl], ["target", r.target], ["within sigma", w.sigma], ["overall sigma", o.sigma], ["within method", r.within_method], ["Shapiro-Wilk p (normality)", r.normality_p], ["confidence intervals", r.ci_note]],
      },
    ],
    spc: { kind: "capability", result: r },
  };
}

export function describeSpc(result: SpcTestResult, alpha: number): TestOutput {
  if (result.id === "control-chart") return describeChart(result.data);
  return describeCapability(result.data, `${Number(((1 - alpha) * 100).toPrecision(3))}%`);
}
