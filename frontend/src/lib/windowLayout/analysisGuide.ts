// The Analysis window's guide (WORKSPACE_LAYOUT_PLAN P4, the 2026-11-22
// "Analysis guide" decision). Pure: the caller passes what it read.
//
// TECHNIQUE. The import records a technique (`metadata.technique`, read by
// lib/techniqueDefaults `techniqueOf`). The user may override it for the guide;
// the override is saved ON THE DATASET as `metadata.technique_override`
// (store/analysisWindowActions.ts writes it), so it round-trips the project
// with the data. It changes what the guide shows (the workflow and which tools
// it suggests) and nothing else: plot defaults, the Analyze menu and the
// classic Workflow page keep reading the recorded technique, so overriding the
// guide never silently changes a plot or enables a tool the menu refuses.
// When nothing is recorded ("generic"), the guide offers SUGGESTIONS from the
// X axis and column units; a suggestion is only applied when the user picks it.
//
// STEPS. Inspect -> Clean -> Plot -> Analyze -> Report, each "not started",
// "done" or "out of date" from evidence on the dataset and the result
// lifecycle; the first step that is not done is the next one.

import type { AnalysisResult } from "../analysisResult";
import { snapshotResultState } from "../analysisResultFreshness";
import { detectMagXKind } from "../magDataKind";
import { isValidTechnique, techniqueOf } from "../techniqueDefaults";
import { TECHNIQUE_WORKFLOWS } from "../techniqueWorkflow";
import type { Dataset, Technique } from "../types";

export const TECHNIQUE_OVERRIDE_KEY = "technique_override";

/** The user's technique override, or null. */
export function techniqueOverrideOf(ds: Dataset | undefined): Technique | null {
  const raw = ds?.data.metadata?.[TECHNIQUE_OVERRIDE_KEY];
  return typeof raw === "string" && isValidTechnique(raw) ? raw : null;
}

export interface EffectiveTechnique {
  technique: Technique;
  /** "override": the user's choice; "import": recorded at import; "none": nothing recorded. */
  source: "override" | "import" | "none";
}

export function effectiveTechnique(ds: Dataset | undefined): EffectiveTechnique {
  const override = techniqueOverrideOf(ds);
  if (override) return { technique: override, source: "override" };
  const recorded = techniqueOf(ds);
  return { technique: recorded, source: recorded === "generic" ? "none" : "import" };
}

/** Every technique the override can choose, with its workflow label. */
export const TECHNIQUE_CHOICES: readonly { technique: Technique; label: string }[] = (Object.keys(TECHNIQUE_WORKFLOWS) as Technique[]).map((technique) => ({
  technique,
  label: TECHNIQUE_WORKFLOWS[technique].label,
}));

export interface TechniqueSuggestion {
  technique: Technique;
  /** The evidence, one short phrase. */
  reason: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const MOMENT_UNIT = /^(emu|e\.m\.u\.|a\s*[·.]?\s*m(²|2|\^2)|am(²|2)|μb|µb|mu_?b)$/i;
const TWO_THETA = /(2\s*[θΘ]|2\s*-?\s*theta|two\s*-?\s*theta)/i;
const Q_AXIS = /^(q|qz|q_z|q\s*z)\b/i;
const INV_LENGTH = /^(1\/Å|1\/a|Å⁻¹|å\^-1|a\^-1|1\/nm|nm⁻¹|nm\^-1)$/i;
const WAVENUMBER = /^(cm-1|cm⁻¹|1\/cm|ev)$/i;
const RESISTANCE = /^(ω|ohm|ohms|Ω|mω|kω|mΩ|kΩ|ω\s*cm|Ω\s*cm|ohm\s*cm)$/i;

/** Guesses from the X axis and the column units, for a dataset whose import
 *  recorded no technique (at most three, strongest first). Never applied
 *  unless the user picks one. */
export function techniqueSuggestions(ds: Dataset | undefined): TechniqueSuggestion[] {
  if (!ds || techniqueOf(ds) !== "generic") return [];
  const meta = ds.data.metadata ?? {};
  const xLabel = str(meta["x_column_long"]) || str(meta["x_column_name"]);
  const xUnit = str(meta["x_column_unit"]);
  const units = ds.data.units.map(str);
  const labels = ds.data.labels.map(str);
  const out: TechniqueSuggestion[] = [];
  const add = (technique: Technique, reason: string) => {
    if (out.length < 3 && !out.some((s) => s.technique === technique)) out.push({ technique, reason });
  };
  const moment = units.some((u) => MOMENT_UNIT.test(u));
  const magX = detectMagXKind(xLabel, xUnit).kind;
  if (moment && magX === "field") add("magnetometry.mvsh", `X is a magnetic field${xUnit ? ` (${xUnit})` : ""} and a column is a magnetic moment`);
  if (moment && magX === "temperature") add("magnetometry.mvst", `X is a temperature${xUnit ? ` (${xUnit})` : ""} and a column is a magnetic moment`);
  if (TWO_THETA.test(xLabel)) add("xrd.powder", "X is named 2θ");
  if (Q_AXIS.test(xLabel) || INV_LENGTH.test(xUnit)) {
    if (labels.some((l) => /^r$|refl/i.test(l))) add("reflectometry", "X is a momentum transfer and a column is a reflectivity");
  }
  if (/depth|sputter/i.test(xLabel) && units.some((u) => /^(counts|c\/s|cps)$/i.test(u))) add("sims", "X is a depth and the columns are counts");
  if (WAVENUMBER.test(xUnit)) add("spectroscopy", `X is in ${xUnit}`);
  if (units.some((u) => RESISTANCE.test(u)) || labels.some((l) => /resist/i.test(l))) add("transport", "a column is a resistance");
  return out;
}

export type StepId = "inspect" | "clean" | "plot" | "analyze" | "report";
export type StepStatus = "not-started" | "done" | "out-of-date";

export interface GuideStep {
  id: StepId;
  label: string;
  status: StepStatus;
  /** One sentence: why the step has this status. */
  detail: string;
  /** The first step that is not done. */
  next: boolean;
}

export const STEP_LABELS: Readonly<Record<StepId, string>> = {
  inspect: "Inspect",
  clean: "Clean",
  plot: "Plot",
  analyze: "Analyze",
  report: "Report",
};

/** Is a saved result's output known to be out of date? Linked outputs: the
 *  recalc engine's stale list (or saved stale). Snapshot results with a source
 *  fingerprint: the shared freshness authority. */
export function resultOutOfDate(result: AnalysisResult, datasets: readonly Dataset[], staleDatasets: readonly string[]): boolean {
  if (result.stale) return true;
  if (result.outputs.some((o) => staleDatasets.includes(o.datasetId))) return true;
  return result.outputs.length === 0 && result.sourceFingerprint !== undefined && snapshotResultState(result, datasets) === "out-of-date";
}

export interface GuideInput {
  dataset: Dataset;
  datasets: readonly Dataset[];
  /** The Data window has shown this dataset this session. */
  inspected: boolean;
  staleDatasets: readonly string[];
  staleFits: readonly string[];
  /** Saved results that read this dataset. */
  results: readonly AnalysisResult[];
  /** Saved editable figures of this dataset. */
  figures: number;
  /** Report sheets of this dataset. */
  reports: number;
}

export function guideSteps(input: GuideInput): GuideStep[] {
  const { dataset: ds } = input;
  const cleaned = !!ds.corrections || (ds.excludedRows?.length ?? 0) > 0 || (ds.filter?.length ?? 0) > 0 || !!ds.derivedFrom || !!ds.analysisRecipe;
  const derivedStale = (!!ds.derivedFrom || !!ds.analysisRecipe) && input.staleDatasets.includes(ds.id);
  const staleResults = input.results.filter((r) => resultOutOfDate(r, input.datasets, input.staleDatasets)).length;
  const fitStale = !!ds.fitSpec && input.staleFits.includes(ds.id);
  const analyzed = input.results.length > 0 || !!ds.fitSpec || !!ds.peakTable;
  const analyzeStale = staleResults > 0 || fitStale;
  const steps: Omit<GuideStep, "next">[] = [
    input.inspected
      ? { id: "inspect", label: STEP_LABELS.inspect, status: "done", detail: "You have looked at the data in the Data window." }
      : { id: "inspect", label: STEP_LABELS.inspect, status: "not-started", detail: "Open the Data window to check the columns and units." },
    derivedStale
      ? { id: "clean", label: STEP_LABELS.clean, status: "out-of-date", detail: "Its source changed since this worksheet was derived; recompute it." }
      : cleaned
        ? { id: "clean", label: STEP_LABELS.clean, status: "done", detail: "Corrections, exclusions, a filter or a processing step are applied." }
        : { id: "clean", label: STEP_LABELS.clean, status: "not-started", detail: "No corrections, exclusions or filters yet; skip this if the data is clean." },
    input.figures > 0
      ? { id: "plot", label: STEP_LABELS.plot, status: "done", detail: `${input.figures} saved figure${input.figures === 1 ? "" : "s"} of this dataset.` }
      : { id: "plot", label: STEP_LABELS.plot, status: "not-started", detail: "No saved figure yet; configure one from the plot." },
    analyzeStale
      ? { id: "analyze", label: STEP_LABELS.analyze, status: "out-of-date", detail: "The data changed after an analysis; run it again before using its values." }
      : analyzed
        ? { id: "analyze", label: STEP_LABELS.analyze, status: "done", detail: `${input.results.length || 1} analysis result${(input.results.length || 1) === 1 ? "" : "s"} for this dataset.` }
        : { id: "analyze", label: STEP_LABELS.analyze, status: "not-started", detail: "No analysis yet; pick a tool below." },
    input.reports > 0
      ? analyzeStale
        ? { id: "report", label: STEP_LABELS.report, status: "out-of-date", detail: "An analysis it reports on is out of date." }
        : { id: "report", label: STEP_LABELS.report, status: "done", detail: `${input.reports} report${input.reports === 1 ? "" : "s"} for this dataset.` }
      : { id: "report", label: STEP_LABELS.report, status: "not-started", detail: "No report yet; build one from an analysis result." },
  ];
  const next = steps.findIndex((s) => s.status !== "done");
  return steps.map((s, i) => ({ ...s, next: i === next }));
}
