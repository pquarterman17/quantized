// Curve Fit templates (Origin's "Save as template" for NLFit): a NAMED set of
// fit settings — model, weighting, the start/bounds/hold table and the X range
// — that can be applied to another dataset's Curve Fit panel. Pure.
//
// Storage: a fit template IS an analysis template (lib/template.ts) whose one
// step is a "fit" step, with the panel settings under `params.fitTemplate`.
// That reuses the existing persistence end to end: the localStorage library,
// and the project file (.dwk), which already carries the template library
// (lib/templatesProject.ts) with its own sanitizing merge — so a fit template
// travels with the project like every other recipe. The step's own
// `model`/`weight`/`range` keep it a runnable pipeline fit step too.
//
// Applying is ALWAYS an explicit user action (the panel's Apply button);
// nothing here, and nothing that loads a project, applies a template.
//
// Versioned and sanitized: `fitTemplateOf` accepts only `version: 1` and
// type-checks every field of the untrusted bag (it may come from a file),
// bounding string lengths and the row count; anything malformed is "not a fit
// template" (null), never a partial apply.

import type { FitParamRow } from "./fitParams";
import { toTemplate, type AnalysisTemplate } from "./template";
import { makeStep } from "./pipeline";
import type { WeightMode } from "./types";

export const FIT_TEMPLATE_VERSION = 1;
const MAX_ROWS = 64;
const MAX_TEXT = 64;
const WEIGHTS: readonly WeightMode[] = ["none", "yerr", "poisson", "manual", "direct"];

export interface FitTemplateSettings {
  version: typeof FIT_TEMPLATE_VERSION;
  model: string;
  weight: WeightMode;
  /** The manual error / direct weight column's LABEL (indices differ
   *  between worksheets). */
  manualLabel?: string;
  /** Origin's "Scale errors with √(reduced χ²)" turned OFF; absent = on. */
  scaleErrors?: false;
  /** The start/min/max/hold table, as typed (blank = model default / unbounded). */
  rows: FitParamRow[];
  /** The X range the fit was restricted to; absent = the full range. */
  range?: { lo: number; hi: number };
}

const text = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_TEXT;

function rowOf(v: unknown): FitParamRow | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!text(o.name) || !o.name || !text(o.start) || !text(o.min) || !text(o.max) || typeof o.fixed !== "boolean") return null;
  return { name: o.name, start: o.start, min: o.min, max: o.max, fixed: o.fixed };
}

/** Validate an untrusted settings bag; null when it is not a v1 fit template. */
export function sanitizeFitTemplate(v: unknown): FitTemplateSettings | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.version !== FIT_TEMPLATE_VERSION || !text(o.model) || !o.model.trim()) return null;
  if (!WEIGHTS.includes(o.weight as WeightMode)) return null;
  if (!Array.isArray(o.rows) || o.rows.length > MAX_ROWS) return null;
  const rows = o.rows.map(rowOf);
  if (rows.some((r) => r === null)) return null;
  const out: FitTemplateSettings = { version: 1, model: o.model, weight: o.weight as WeightMode, rows: rows as FitParamRow[] };
  if (o.scaleErrors !== undefined) {
    if (o.scaleErrors !== false) return null;
    out.scaleErrors = false;
  }
  if (o.manualLabel !== undefined) {
    if (!text(o.manualLabel)) return null;
    out.manualLabel = o.manualLabel;
  }
  if (o.range !== undefined) {
    const r = o.range as Record<string, unknown> | null;
    if (!r || typeof r.lo !== "number" || typeof r.hi !== "number" || !Number.isFinite(r.lo) || !Number.isFinite(r.hi) || r.lo > r.hi) return null;
    out.range = { lo: r.lo, hi: r.hi };
  }
  return out;
}

/** The fit settings a stored analysis template carries, or null when it is
 *  not (exactly) a fit template. */
export function fitTemplateOf(t: AnalysisTemplate): FitTemplateSettings | null {
  if (t.steps.length !== 1 || t.steps[0]!.kind !== "fit") return null;
  return sanitizeFitTemplate(t.steps[0]!.params.fitTemplate);
}

/** The analysis-template record for `settings` under `name`. */
export function toFitTemplate(name: string, settings: FitTemplateSettings): AnalysisTemplate {
  const s = sanitizeFitTemplate(settings);
  if (!s) throw new Error("these fit settings cannot be saved as a template");
  const params: Record<string, unknown> = { model: s.model, fitTemplate: s };
  if (s.weight === "yerr" || s.weight === "poisson") {
    params.weight = { mode: s.weight, ...(s.scaleErrors === false ? { scaleErrors: false } : {}) };
  }
  if (s.range) params.range = [s.range.lo, s.range.hi];
  const step = makeStep("fit", `Fit ${s.model}`, `qz.fit(${JSON.stringify(s.model)})`, params);
  return toTemplate(name.trim(), [step], s.rows.map((r) => r.name), {
    description: `Curve Fit template: ${s.model}`,
  });
}
