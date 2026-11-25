// Design of experiments (GAP_AUDIT_9 J16): the pure half of the workshop.
// A generated design worksheet carries `metadata.doe` (calc/doe_sheet.py): the
// factors, the coded/actual column labels, the response label and the model
// terms. This reads it back and builds the two things the workshop hands on:
// Fit Model's recipe ("Analyze design") and the effects request. Columns are
// found by LABEL, so a renamed or deleted design column fails closed (null)
// instead of silently fitting the wrong one.

import type { DoeEffectsBody, DoeDesignType } from "./api/doe";
import type { FitModelRecipe } from "./fitModelRecipe";
import type { DataStruct } from "./types";

export interface DoeFactorMeta {
  name: string;
  letter: string;
  low: number;
  high: number;
  unit: string;
  coded_label: string;
  actual_label: string;
  /** d_optimal: level names of a categorical factor (empty/absent = continuous). */
  levels?: string[];
}

export interface DoeMeta {
  kind: DoeDesignType;
  model: "main" | "interaction" | "quadratic";
  factors: DoeFactorMeta[];
  response_label: string;
  terms: string[][];
  terms_coded: string[][];
  runs: number;
  randomized: boolean;
  seed: number | null;
  center_points: number;
  resolution: number | null;
  generators: string[];
  defining_relation: string;
  aliases: string[][];
  alpha: number | null;
  error_df: number;
  notes: string[];
  /** Blocking (absent in designs saved before blocks existed). */
  block_label?: string | null;
  blocks?: number;
  block_generators?: string[];
  confounded?: string[];
  /** D-optimal designs: D-efficiency in percent. */
  d_efficiency?: number | null;
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");
const isTerms = (v: unknown): v is string[][] => Array.isArray(v) && v.every(isStrings);

/** The design record of a worksheet, or null when it is not a generated design. */
export function doeMeta(data: DataStruct | null | undefined): DoeMeta | null {
  const raw = data?.metadata?.["doe"];
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const factors = m["factors"];
  if (!Array.isArray(factors) || factors.length === 0 || typeof m["response_label"] !== "string") return null;
  if (!isTerms(m["terms"]) || !isTerms(m["terms_coded"]) || !isTerms(m["aliases"])) return null;
  if (!["main", "interaction", "quadratic"].includes(String(m["model"]))) return null;
  for (const f of factors) {
    const o = f as Record<string, unknown>;
    if (typeof o?.["name"] !== "string" || typeof o["coded_label"] !== "string") return null;
  }
  return m as unknown as DoeMeta;
}

export const isTwoLevel = (meta: DoeMeta): boolean => meta.model !== "quadratic" && meta.kind !== "d_optimal";

const labelIndex = (data: DataStruct, label: string): number => data.labels.indexOf(label);

/** Fit Model's recipe for the design: the response and the design's model terms
 *  on the CODED columns (continuous; a categorical factor is its own nominal
 *  column), plus Block as a fixed effect when the design is blocked. Null when
 *  a design column is gone. */
export function doeFitRecipe(data: DataStruct): FitModelRecipe | null {
  const meta = doeMeta(data);
  if (!meta) return null;
  const responseCol = labelIndex(data, meta.response_label);
  if (responseCol < 0) return null;
  const terms: number[][] = [];
  const kinds: Record<string, "continuous" | "nominal"> = {};
  const categorical = new Set(meta.factors.filter((f) => f.levels?.length).map((f) => labelIndex(data, f.coded_label)));
  for (const t of meta.terms_coded) {
    const cols = t.map((l) => labelIndex(data, l));
    if (cols.some((c) => c < 0) || cols.length === 0) return null;
    terms.push(cols);
    for (const c of cols) kinds[String(c)] = categorical.has(c) ? "nominal" : "continuous";
  }
  if (meta.block_label) {
    const b = labelIndex(data, meta.block_label);
    if (b < 0) return null;
    terms.push([b]);
    kinds[String(b)] = "nominal";
  }
  return { responseCol, terms, kinds, center: true };
}

/** Number of runs that already have a response. */
export function filledResponses(data: DataStruct): number {
  const col = labelIndex(data, doeMeta(data)?.response_label ?? "");
  if (col < 0) return 0;
  return data.values.reduce((n, row) => n + (Number.isFinite(row[col]) ? 1 : 0), 0);
}

/** The effects request for a two-level design (coded columns, response). */
export function doeEffectsBody(data: DataStruct): DoeEffectsBody | null {
  const meta = doeMeta(data);
  if (!meta || !isTwoLevel(meta)) return null;
  const respCol = labelIndex(data, meta.response_label);
  if (respCol < 0) return null;
  const num = (c: number) => data.values.map((r) => (Number.isFinite(r[c]) ? (r[c] as number) : null));
  const factor_columns: Record<string, (number | null)[]> = {};
  for (const f of meta.factors) {
    const c = labelIndex(data, f.coded_label);
    if (c < 0) return null;
    factor_columns[f.coded_label] = num(c);
  }
  return { factor_columns, response: num(respCol), terms: meta.terms_coded };
}

/** "Temp (coded)*Time (coded)" -> "Temp*Time" for display. */
export const plainTerm = (term: string): string => term.replace(/ \(coded\)/g, "");

export function designTitle(meta: DoeMeta): string {
  const base = baseTitle(meta);
  return meta.blocks && meta.blocks > 1 ? `${base} in ${meta.blocks} blocks` : base;
}

function baseTitle(meta: DoeMeta): string {
  const k = meta.factors.length;
  switch (meta.kind) {
    case "full_factorial": return `2^${k} full factorial`;
    case "fractional_factorial": return `2^(${k}-${meta.generators.length}) fractional factorial`;
    case "plackett_burman": return "Plackett-Burman screening";
    case "d_optimal": return `D-optimal ${meta.runs}-run`;
    case "ccd": return "Central composite";
    default: return "Box-Behnken";
  }
}
