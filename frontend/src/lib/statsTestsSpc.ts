// Statistical-tests workshop — SPC control charts and process capability
// (GAP_AUDIT_9 J14): catalog entries, settings and the pure request builder.
// Delegated to by statsTests.ts so that file stays small.
//
// Rows keep their worksheet ORDER (a control chart is a time series) and drop
// any row where a needed column is not finite, so each surviving row is still
// one observation. Subgroups come from a subgroup column (rows sharing a value,
// in order of first appearance) or from a fixed size (consecutive rows; a row
// count that does not divide evenly is refused, never trimmed).
//
// Provisional, owner to confirm: there is NO default specification limit (the
// capability test refuses without one); Western Electric rules are all off by
// default and each is an option; rule 4 defaults to a run of 8; charts use the
// published constants for subgroup sizes 2..25 only.

import type { StatsTestRequest } from "./api/statsTests";
import type { SpcChartKind } from "./api/statsTestsSpc";
import { columnDisplayName } from "./statschooser";
import type { DataStruct } from "./types";
import type { BuildOutcome, TestDef, TestParams, TestSelection } from "./statsTests";

export type SpcRuleId = "we1" | "we2" | "we3" | "we4";

export type SpcParams = {
  chart: SpcChartKind;
  /** X-bar charts / capability with subgroups: a subgroup column, or a fixed size. */
  subgroupMode: "column" | "size";
  subgroupSize: number;
  /** Capability only: estimate within sigma from subgroups (else moving range). */
  useSubgroups: boolean;
  sigmaMethod: "range" | "sd";
  /** P / NP / U: sample sizes from a column, or one constant. */
  sizeMode: "column" | "constant";
  sampleSize: number;
  rules: Record<SpcRuleId, boolean>;
  runLength: number;
  /** Specification limits: `null` = not set (no default). */
  lsl: number | null;
  usl: number | null;
  target: number | null;
};

export const DEFAULT_SPC: SpcParams = {
  chart: "imr", subgroupMode: "size", subgroupSize: 5, useSubgroups: false, sigmaMethod: "range",
  sizeMode: "column", sampleSize: 100, rules: { we1: false, we2: false, we3: false, we4: false },
  runLength: 8, lsl: null, usl: null, target: null,
};

export const SPC_CHARTS: readonly { id: SpcChartKind; label: string }[] = [
  { id: "imr", label: "Individuals and moving range (I-MR)" },
  { id: "xbar-r", label: "X-bar and R (subgroups)" },
  { id: "xbar-s", label: "X-bar and S (subgroups)" },
  { id: "p", label: "P chart (proportion defective)" },
  { id: "np", label: "NP chart (number defective, constant n)" },
  { id: "c", label: "C chart (defects per unit)" },
  { id: "u", label: "U chart (defects per varying unit)" },
];

export const SPC_RULES: readonly { id: SpcRuleId; label: string }[] = [
  { id: "we1", label: "1 point beyond 3σ" },
  { id: "we2", label: "2 of 3 beyond 2σ (same side)" },
  { id: "we3", label: "4 of 5 beyond 1σ (same side)" },
  { id: "we4", label: "run on one side of the centre" },
];

export const SPC_TESTS: readonly TestDef[] = [
  { id: "control-chart", family: "Quality (SPC)", label: "Control chart", input: "spc", blurb: "Is the process stable? X-bar/R, X-bar/S, I-MR, P, NP, C or U chart with ±3σ limits and run rules." },
  { id: "capability", family: "Quality (SPC)", label: "Process capability (Cp, Cpk, Pp, Ppk)", input: "spc", blurb: "How well does the process fit between your specification limits? Enter LSL and/or USL." },
];

export const SPC_IDS: ReadonlySet<string> = new Set(SPC_TESTS.map((t) => t.id));

const SUBGROUP_CHARTS: ReadonlySet<SpcChartKind> = new Set(["xbar-r", "xbar-s"]);
const col = (data: DataStruct, i: number): number[] => (i < 0 ? data.time : data.values.map((r) => r[i]));
const fail = (error: string): BuildOutcome => ({ ok: false, error });

/** Whether the chart / test reads a subgroup structure. */
export function spcUsesSubgroups(id: string, p: SpcParams): boolean {
  return id === "capability" ? p.useSubgroups : SUBGROUP_CHARTS.has(p.chart);
}

/** Whether the chart reads a count + (column) size pair. */
export function spcUsesSizeColumn(id: string, p: SpcParams): boolean {
  return id === "control-chart" && (p.chart === "p" || p.chart === "np" || p.chart === "u") && p.sizeMode === "column";
}

/** Worksheet columns the SPC tests read, in builder order. */
export function spcColumns(id: string, sel: TestSelection, p: SpcParams): number[] {
  const out = [sel.x];
  if (spcUsesSubgroups(id, p) && p.subgroupMode === "column") out.push(sel.byCol);
  if (spcUsesSizeColumn(id, p)) out.push(sel.y);
  return out;
}

function distinct(cols: number[]): boolean {
  return new Set(cols).size === cols.length;
}

/** Rows (in order) where every column is finite; column-major. */
function rowsOf(data: DataStruct, cols: number[]): number[][] {
  const src = cols.map((c) => col(data, c));
  const n = Math.min(...src.map((s) => s.length));
  const out: number[][] = cols.map(() => []);
  for (let i = 0; i < n; i++) {
    if (!src.every((s) => Number.isFinite(s[i]))) continue;
    src.forEach((s, k) => out[k].push(s[i]));
  }
  return out;
}

function groupRows(values: number[], codes: number[] | null, size: number): number[][] | string {
  if (codes) {
    const groups = new Map<number, number[]>();
    values.forEach((v, i) => {
      const g = groups.get(codes[i]);
      if (g) g.push(v); else groups.set(codes[i], [v]);
    });
    return [...groups.values()];
  }
  if (!Number.isInteger(size) || size < 2) return "Subgroup size must be a whole number of at least 2.";
  if (values.length % size !== 0) {
    return `${values.length} usable rows do not divide into subgroups of ${size}; remove or add rows (nothing is trimmed for you).`;
  }
  return Array.from({ length: values.length / size }, (_, i) => values.slice(i * size, (i + 1) * size));
}

/** Build the request for an SPC test, or say plainly what is missing. */
export function buildSpcRequest(id: string, data: DataStruct | null, sel: TestSelection, tp: TestParams): BuildOutcome {
  if (!data) return fail("Select a dataset to analyze.");
  const p = tp.spc;
  const name = (c: number) => columnDisplayName(data, c);
  const cols = spcColumns(id, sel, p);
  if (!distinct(cols)) return fail("Pick different columns for the data, the subgroup and the sample size.");
  const labels = cols.map(name);
  const rows = rowsOf(data, cols);
  const x = rows[0];
  if (x.length === 0) return fail(`${name(sel.x)} has no finite values.`);
  const subgroups = spcUsesSubgroups(id, p)
    ? groupRows(x, p.subgroupMode === "column" ? rows[1] : null, p.subgroupSize)
    : null;
  if (typeof subgroups === "string") return fail(subgroups);

  if (id === "capability") {
    if (p.lsl == null && p.usl == null) return fail("Enter at least one specification limit (LSL and/or USL); there is no default.");
    const body = {
      values: x, lsl: p.lsl, usl: p.usl, target: p.target, alpha: tp.alpha, sigma_method: p.sigmaMethod,
      ...(subgroups ? { subgroups } : {}),
    };
    return { ok: true, request: { id: "capability", body } as StatsTestRequest, labels };
  }
  const rules = (Object.keys(p.rules) as SpcRuleId[]).filter((r) => p.rules[r]);
  const common = { chart: p.chart, rules, run_length: p.runLength };
  if (p.chart === "xbar-r" || p.chart === "xbar-s") {
    return { ok: true, request: { id: "control-chart", body: { ...common, subgroups } } as StatsTestRequest, labels };
  }
  if (p.chart === "imr") return { ok: true, request: { id: "control-chart", body: { ...common, values: x } } as StatsTestRequest, labels };
  if (p.chart === "c") return { ok: true, request: { id: "control-chart", body: { ...common, counts: x } } as StatsTestRequest, labels };
  const sizes = p.sizeMode === "column" ? rows[1] : x.map(() => p.sampleSize);
  return { ok: true, request: { id: "control-chart", body: { ...common, counts: x, sizes } } as StatsTestRequest, labels };
}

const fmt = (v: number | null): string => (v == null ? "not set" : String(v));

/** The SPC settings a result / input review shows (label, value). */
export function spcSettings(id: string, tp: TestParams): [string, string][] {
  const p = tp.spc;
  const out: [string, string][] = [];
  if (id === "control-chart") {
    out.push(["Chart", SPC_CHARTS.find((c) => c.id === p.chart)?.label ?? p.chart]);
    const on = SPC_RULES.filter((r) => p.rules[r.id]).map((r) => (r.id === "we4" ? `${p.runLength} in a row on one side` : r.label));
    out.push(["Run rules", on.length ? on.join("; ") : "none"]);
  } else {
    out.push(["LSL", fmt(p.lsl)], ["USL", fmt(p.usl)], ["Target", fmt(p.target)]);
    out.push(["Within sigma", p.useSubgroups ? (p.sigmaMethod === "sd" ? "S-bar / c4 (subgroups)" : "R-bar / d2 (subgroups)") : "MR-bar / d2 (moving range)"]);
  }
  if (spcUsesSubgroups(id, p)) out.push(["Subgroups", p.subgroupMode === "column" ? "by subgroup column" : `fixed size ${p.subgroupSize}`]);
  if (id === "control-chart" && (p.chart === "p" || p.chart === "np" || p.chart === "u")) {
    out.push(["Sample size", p.sizeMode === "column" ? "from a column" : String(p.sampleSize)]);
  }
  return out;
}

const RULE_KEYS: SpcRuleId[] = ["we1", "we2", "we3", "we4"];
const CHART_IDS = SPC_CHARTS.map((c) => c.id as string);
const nullNum = (v: unknown): boolean => v === null || (typeof v === "number" && Number.isFinite(v));

/** Restore `spc` from a saved record: absent -> defaults; present but invalid -> null. */
export function restoreSpc(raw: unknown): SpcParams | null {
  if (raw === undefined) return DEFAULT_SPC;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const rules = r.rules as Record<string, unknown> | null;
  const ok =
    CHART_IDS.includes(String(r.chart)) && ["column", "size"].includes(String(r.subgroupMode)) &&
    ["column", "constant"].includes(String(r.sizeMode)) && ["range", "sd"].includes(String(r.sigmaMethod)) &&
    typeof r.useSubgroups === "boolean" &&
    [r.subgroupSize, r.sampleSize, r.runLength].every((v) => typeof v === "number" && Number.isFinite(v)) &&
    [r.lsl, r.usl, r.target].every(nullNum) &&
    typeof rules === "object" && rules !== null && RULE_KEYS.every((k) => typeof rules[k] === "boolean");
  return ok ? (r as unknown as SpcParams) : null;
}
