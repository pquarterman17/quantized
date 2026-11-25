// Saved analysis-result kinds for Time series, DOE and Profiler (owner
// decision 2026-11-25): the producer ids, the saved recipes and their parsers,
// the duplicate-save questions and the two freshness rules that differ from a
// plain snapshot. Every kind is a SNAPSHOT result on the shared contract
// (lib/analysisResult.ts): it owns its tables, records its source with the
// fingerprint it was computed on, and reopens its tool from `parameters.recipe`.
//
//   time-series-analysis  one Run of one Time series tool (ACF/PACF, stationarity,
//                         decomposition, change points, ARIMA) on one channel.
//   doe-design            a generated design. Its source is the design worksheet,
//                         hashed over the DESIGN columns only, so filling in the
//                         responses keeps it current and editing a factor
//                         setting (or renaming a design column) makes it stale.
//   doe-effects           the two-level effects analysis (contrasts, Lenth PSE)
//                         of a design worksheet, hashed like any analysis view.
//   profiler              a profile of a SAVED Fit Model result: it records that
//                         result's id and a digest of its model, and shares its
//                         source. Deleting the Fit Model result is "source
//                         missing"; a changed or stale one makes it out of date.
//
// Pure, no store: the result registries (freshness, snapshot key, book, freeze)
// read it. Recipes are parsed without the live worksheet, and fail closed.

import type { AnalysisResult } from "./analysisResult";
import type { CommitSettings } from "./committedOutput";
import { dataFingerprint } from "./dataFingerprint";
import type { Dataset } from "./types";

export const TIME_SERIES_RESULT = "time-series-analysis";
export const DOE_DESIGN_RESULT = "doe-design";
export const DOE_EFFECTS_RESULT = "doe-effects";
export const PROFILER_RESULT = "profiler";

export const TOOL_RESULT_PRODUCERS: readonly string[] = [TIME_SERIES_RESULT, DOE_DESIGN_RESULT, DOE_EFFECTS_RESULT, PROFILER_RESULT];

/** The noun a status line or diagnostic uses for each kind. */
export const TOOL_RESULT_NOUN: Readonly<Record<string, string>> = {
  [TIME_SERIES_RESULT]: "time-series analysis",
  [DOE_DESIGN_RESULT]: "design",
  [DOE_EFFECTS_RESULT]: "design effects analysis",
  [PROFILER_RESULT]: "profile",
};

type Flat = Record<string, number | string | boolean | null>;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const recipeOf = (result: AnalysisResult, producer: string): Record<string, unknown> | null =>
  result.producer.id === producer ? record(record(result.parameters)?.recipe) : null;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

function flat(value: unknown): Flat | null {
  const raw = record(value);
  if (!raw) return null;
  const out: Flat = {};
  for (const [key, item] of Object.entries(raw)) {
    if (item !== null && typeof item !== "string" && typeof item !== "boolean" && !finite(item)) return null;
    out[key] = item;
  }
  return out;
}

/** Order-free form of a flat record (the duplicate key compares by value). */
const sorted = (value: Flat): [string, Flat[string]][] =>
  Object.keys(value).sort().map((key) => [key, value[key]!]);

// ---- Time series ------------------------------------------------------------

export type TimeSeriesTool = "correlogram" | "stationarity" | "decompose" | "changepoint" | "arima";
const TS_TOOLS: readonly TimeSeriesTool[] = ["correlogram", "stationarity", "decompose", "changepoint", "arima"];

export interface TimeSeriesRecipe {
  tool: TimeSeriesTool;
  /** The analysed channel (value column index). */
  col: number;
  allowIrregular: boolean;
  /** The tool's own options (the workshop's TsOptions section for `tool`). */
  options: Flat;
}

export function timeSeriesRecipe(result: AnalysisResult, source?: Dataset): TimeSeriesRecipe | null {
  const raw = recipeOf(result, TIME_SERIES_RESULT);
  const options = flat(raw?.options);
  if (!raw || !options || !TS_TOOLS.includes(raw.tool as TimeSeriesTool) || typeof raw.allowIrregular !== "boolean" ||
      !Number.isInteger(raw.col) || (raw.col as number) < 0 ||
      (source && (raw.col as number) >= source.data.labels.length)) return null;
  return { tool: raw.tool as TimeSeriesTool, col: raw.col as number, allowIrregular: raw.allowIrregular, options };
}

export const timeSeriesQuestion = (r: TimeSeriesRecipe): CommitSettings => ({
  tool: r.tool, col: r.col, allowIrregular: r.allowIrregular, options: sorted(r.options),
});

// ---- DOE: design generation -------------------------------------------------

export interface DoeDesignRecipe {
  /** The workshop's setup form as generated (the seed is the one the server used). */
  setup: Record<string, unknown>;
  /** Labels of the design columns (everything but the response), in sheet order. */
  designColumns: string[];
}

export function doeDesignRecipe(result: AnalysisResult): DoeDesignRecipe | null {
  const raw = recipeOf(result, DOE_DESIGN_RESULT);
  const setup = record(raw?.setup);
  if (!raw || !setup || typeof setup.design !== "string" || !Array.isArray(setup.factors) ||
      !strings(raw.designColumns) || raw.designColumns.length === 0) return null;
  return { setup: { ...setup }, designColumns: [...raw.designColumns] };
}

export const doeDesignQuestion = (r: DoeDesignRecipe): CommitSettings => ({
  setup: JSON.stringify(r.setup), designColumns: r.designColumns,
});

/** The design result's fingerprint: the design columns' labels, units and
 *  values (no response, no row state), so filling in a response keeps the
 *  design current. A design column that was renamed or removed hashes to a
 *  value no saved fingerprint has (out of date, never silently current). */
export function doeDesignFingerprint(columns: readonly string[], dataset: Dataset): string {
  const { data } = dataset;
  const idx = columns.map((label) => data.labels.indexOf(label));
  if (idx.some((i) => i < 0)) return "doe~missing-column";
  const sub = { time: data.time, values: data.values.map((row) => idx.map((i) => row[i] ?? Number.NaN)), labels: [...columns], units: idx.map((i) => data.units[i] ?? ""), metadata: {} };
  return `doe~${dataFingerprint(sub)}:${textHash(JSON.stringify([columns, sub.units, data.cat_levels ?? null]))}`;
}

// ---- DOE: effects analysis --------------------------------------------------

export interface DoeEffectsRecipe {
  responseLabel: string;
  /** The design's model terms on the coded columns (the effects request). */
  terms: string[][];
}

export function doeEffectsRecipe(result: AnalysisResult): DoeEffectsRecipe | null {
  const raw = recipeOf(result, DOE_EFFECTS_RESULT);
  if (!raw || typeof raw.responseLabel !== "string" || !raw.responseLabel || !Array.isArray(raw.terms) ||
      raw.terms.length === 0 || !raw.terms.every(strings)) return null;
  return { responseLabel: raw.responseLabel, terms: (raw.terms as string[][]).map((t) => [...t]) };
}

export const doeEffectsQuestion = (r: DoeEffectsRecipe): CommitSettings => ({ responseLabel: r.responseLabel, terms: r.terms });

// ---- Profiler ---------------------------------------------------------------

export interface ProfilerGoal { goal: "maximize" | "minimize" | "target"; lower: number; upper: number; target: number | null }

export interface ProfilerRecipe {
  fitResultId: string;
  /** fitModelDigest of the Fit Model result as profiled. */
  fitDigest: string;
  /** Factor name -> continuous value, nominal level, or null (averaged over levels). */
  settings: Record<string, number | string | null>;
  alpha: number;
  goal: ProfilerGoal | null;
}

function goalOf(value: unknown): ProfilerGoal | null | undefined {
  if (value === null) return null;
  const raw = record(value);
  if (!raw || !["maximize", "minimize", "target"].includes(String(raw.goal)) || !finite(raw.lower) || !finite(raw.upper) ||
      !(raw.target === null || finite(raw.target))) return undefined;
  return { goal: raw.goal as ProfilerGoal["goal"], lower: raw.lower, upper: raw.upper, target: raw.target as number | null };
}

export function profilerRecipe(result: AnalysisResult): ProfilerRecipe | null {
  const raw = recipeOf(result, PROFILER_RESULT);
  const settings = flat(raw?.settings);
  const goal = goalOf(raw?.goal);
  if (!raw || !settings || goal === undefined || typeof raw.fitResultId !== "string" || !raw.fitResultId ||
      typeof raw.fitDigest !== "string" || !raw.fitDigest || !finite(raw.alpha) || !(raw.alpha > 0 && raw.alpha < 1) ||
      Object.values(settings).some((v) => typeof v === "boolean")) return null;
  return { fitResultId: raw.fitResultId, fitDigest: raw.fitDigest, settings: settings as ProfilerRecipe["settings"], alpha: raw.alpha, goal };
}

export const profilerQuestion = (r: ProfilerRecipe): CommitSettings => ({
  fitResultId: r.fitResultId, fitDigest: r.fitDigest, settings: sorted(r.settings), alpha: r.alpha, goal: r.goal,
});

/** What identifies a Fit Model result's numbers: its fitted model, its recipe
 *  and the data fingerprint it was fitted on (not its name or notes). */
export function fitModelDigest(fit: AnalysisResult): string {
  return textHash(JSON.stringify([fit.parameters?.["model"] ?? null, fit.parameters?.["recipe"] ?? null, fit.sourceFingerprint ?? null]));
}

/** The Fit Model result a profile evaluated: "missing" (deleted, or the
 *  profile's reference does not parse), "changed" (its model or data
 *  fingerprint differs, or it is itself out of date) or "same". */
export function profilerFitState(result: AnalysisResult, results: readonly AnalysisResult[]): "missing" | "changed" | "same" {
  const recipe = profilerRecipe(result);
  const fit = recipe && results.find((candidate) => candidate.id === recipe.fitResultId);
  if (!recipe || !fit || fit.producer.id !== "fit-model") return "missing";
  return fit.stale || fitModelDigest(fit) !== recipe.fitDigest ? "changed" : "same";
}

/** Two-lane FNV-1a over a string: 16 hex digits. */
export function textHash(text: string): string {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b ^= b >>> 15;
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}
