// Design of experiments (GAP_AUDIT_9 J16) as saved snapshot results (owner
// decision 2026-11-25). Two kinds, kept apart:
//
//   doe-design   what was generated: the setup form (with the seed the server
//                used), the design summary, factors, alias structure, model
//                terms and the run table. Generation still adds the design
//                worksheet exactly as before; this result describes it and is
//                current while its DESIGN columns are unchanged (filling in the
//                response does not touch it; lib/toolResultKinds).
//   doe-effects  the analysis of a filled two-level design: contrast effects
//                with Lenth's PSE, ME and SME (calc/doe_effects.py; Lenth 1989),
//                current while the design worksheet's analysis view is.
//
// Fit Model on a design ("Analyze design") saves a Fit Model result as before.
// Pure; imported by the lazy DOE workshop only.

import type { DoeEffectsResponse } from "./api/doe";
import { ANALYSIS_RESULT_VERSION, type AnalysisResult, type AnalysisResultTable } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import { toResultValue } from "./committedOutput";
import { designTitle, plainTerm, type DoeMeta } from "./doe";
import { fmtNum } from "./format";
import { INPUTS_PARAM, recordedInputs } from "./resultInputsRecord";
import {
  DOE_DESIGN_RESULT, DOE_EFFECTS_RESULT, doeDesignFingerprint, type DoeDesignRecipe, type DoeEffectsRecipe,
} from "./toolResultKinds";
import type { DataStruct, Dataset } from "./types";
import { boundedTables } from "./variabilityAnalysisResult";

/** Bumped when the generator or the effects method changes (provisional, owner to confirm). */
export const DOE_ALGORITHM_VERSION = 1;

export const DOE_TABLES = {
  summary: "Design summary", factors: "Factors", aliases: "Alias structure", terms: "Model terms", runs: "Design runs",
  effects: "Effects", lenth: "Lenth summary",
} as const;

const nul = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Every column but the response, in sheet order: what the design result describes. */
export function designColumnsOf(data: DataStruct, meta: DoeMeta): string[] {
  return data.labels.filter((label) => label !== meta.response_label);
}

function cell(data: DataStruct, row: number, col: number): string | number | null {
  const v = data.values[row]?.[col];
  const levels = (data.cat_levels as Record<number, readonly string[]> | undefined)?.[col];
  if (levels) return typeof v === "number" && Number.isInteger(v) ? levels[v] ?? null : null;
  return nul(v);
}

export function doeDesignResultTables(data: DataStruct, meta: DoeMeta): AnalysisResultTable[] {
  const summary: [string, string | number | null][] = [
    ["Design", designTitle(meta)], ["Runs", meta.runs], ["Factors", meta.factors.length], ["Model", meta.model],
    ["Run order", meta.randomized ? "randomized" : "standard"], ["Seed", nul(meta.seed)],
    ["Center points", meta.center_points], ["Resolution", nul(meta.resolution)], ["Alpha", nul(meta.alpha)],
    ["Defining relation", meta.defining_relation || null], ["Blocks", meta.blocks && meta.blocks > 1 ? meta.blocks : null],
    ["Error df", nul(meta.error_df)], ["D-efficiency (%)", nul(meta.d_efficiency ?? null)],
  ];
  const cols = designColumnsOf(data, meta).map((label) => data.labels.indexOf(label));
  const tables: AnalysisResultTable[] = [
    { title: DOE_TABLES.summary, columns: ["property", "value"],
      // One kind per column: text values, numbers as their display text.
      rows: summary.filter(([, v]) => v !== null).map(([k, v]) => [k, typeof v === "number" ? fmtNum(v) : v]) },
    { title: DOE_TABLES.factors, columns: ["letter", "name", "low", "high", "unit", "levels"],
      rows: meta.factors.map((f) => [f.letter, f.name, f.levels?.length ? null : nul(f.low), f.levels?.length ? null : nul(f.high), f.unit || null, f.levels?.length ? f.levels.join(", ") : null]) },
    ...(meta.aliases.some((set) => set.length > 1) ? [{ title: DOE_TABLES.aliases, columns: ["aliased effects"],
      rows: meta.aliases.map((set) => [set.join(" = ")]) }] : []),
    { title: DOE_TABLES.terms, columns: ["term"], rows: [
      ...meta.terms.map((t) => [plainTerm(t.join("*"))]),
      ...(meta.block_label ? [[`${meta.block_label} (fixed)`]] : []),
    ] },
    { title: DOE_TABLES.runs, columns: ["run", ...cols.map((c) => data.labels[c]!)],
      rows: data.time.map((t, row) => [nul(t), ...cols.map((c) => cell(data, row, c))]) },
  ];
  return tables;
}

export function doeDesignAnalysisResult(
  id: string, source: Dataset, recipe: DoeDesignRecipe, meta: DoeMeta, createdAt = new Date().toISOString(),
): AnalysisResult {
  const bounded = boundedTables(doeDesignResultTables(source.data, meta));
  const channels = recipe.designColumns.map((label) => source.data.labels.indexOf(label)).filter((i) => i >= 0)
    .map((index) => ({ index, label: source.data.labels[index]!, unit: source.data.units[index] ?? "" }));
  return {
    version: ANALYSIS_RESULT_VERSION, id,
    name: `${designTitle(meta)} design · ${source.name}`,
    producer: { id: DOE_DESIGN_RESULT, label: "Design of experiments", version: 1 },
    sources: [{ datasetId: source.id, role: "input" }], outputs: [],
    selection: { datasetId: source.id, channels },
    sourceFingerprint: doeDesignFingerprint(recipe.designColumns, source),
    scalarValues: {
      Test: "Design generation", Interpretation: `${designTitle(meta)}: ${meta.runs} runs, ${meta.factors.length} factors (${meta.model} model).`,
      Design: designTitle(meta), Runs: meta.runs, Response: meta.response_label,
    },
    parameters: {
      recipe: { setup: toResultValue(recipe.setup), designColumns: recipe.designColumns },
      algorithm: { id: `doe-${meta.kind}`, version: DOE_ALGORITHM_VERSION },
      [INPUTS_PARAM]: recordedInputs([source], { xKey: undefined }),
    },
    tables: bounded.tables, warnings: [...meta.notes, ...bounded.warnings], createdAt,
  };
}

export function doeEffectsResultTables(out: DoeEffectsResponse): AnalysisResultTable[] {
  return [
    { title: DOE_TABLES.effects, columns: ["term", "effect", "|effect|", "half-normal quantile", "t ratio (Lenth)", "active"],
      rows: out.effects.map((e) => [plainTerm(e.term), nul(e.effect), nul(e.abs_effect), nul(e.half_normal_q), nul(e.t_ratio),
        e.significant === null ? null : e.significant ? "yes" : "no"]) },
    { title: DOE_TABLES.lenth, columns: ["statistic", "value"], rows: [
      ["runs", out.n_runs], ["PSE", nul(out.pse)], ["ME", nul(out.me)], ["SME", nul(out.sme)],
    ] },
  ];
}

export function doeEffectsAnalysisResult(
  id: string, source: Dataset, recipe: DoeEffectsRecipe, meta: DoeMeta, out: DoeEffectsResponse, createdAt = new Date().toISOString(),
): AnalysisResult {
  const bounded = boundedTables(doeEffectsResultTables(out));
  const labels = [...meta.factors.map((f) => f.coded_label), meta.response_label];
  const channels = labels.map((label) => source.data.labels.indexOf(label)).filter((i) => i >= 0)
    .map((index) => ({ index, label: source.data.labels[index]!, unit: source.data.units[index] ?? "" }));
  const active = out.effects.filter((e) => e.significant).map((e) => plainTerm(e.term));
  return {
    version: ANALYSIS_RESULT_VERSION, id,
    name: `${recipe.responseLabel} design effects · ${source.name}`,
    producer: { id: DOE_EFFECTS_RESULT, label: "Design of experiments", version: 1 },
    sources: [{ datasetId: source.id, role: "input" }], outputs: [],
    selection: { datasetId: source.id, channels },
    sourceFingerprint: analysisDataFingerprint(source),
    scalarValues: {
      Test: "Two-level effects (Lenth)",
      Interpretation: out.pse === null ? "Too few effects for a Lenth estimate."
        : active.length ? `Beyond the simultaneous margin of error: ${active.join(", ")}.` : "No effect is beyond the simultaneous margin of error.",
      Response: recipe.responseLabel, Design: designTitle(meta), Runs: out.n_runs,
    },
    parameters: {
      recipe: { responseLabel: recipe.responseLabel, terms: recipe.terms },
      algorithm: { id: "doe-effects-lenth", version: DOE_ALGORITHM_VERSION },
      // The effects read every run of the worksheet (lib/doe.doeEffectsBody), not the analysis view.
      [INPUTS_PARAM]: recordedInputs([source], { xKey: undefined, views: [source.data] }),
    },
    tables: bounded.tables, warnings: ["In a fraction an effect is the sum of its aliases.", ...bounded.warnings].slice(meta.kind === "fractional_factorial" ? 0 : 1),
    createdAt,
  };
}
