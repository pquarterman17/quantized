// Analysis templates (#2/#3) — a template is a NAMED, SERIALIZED pipeline:
// version tag + the ordered typed steps + declared outputs (the fit parameters
// a batch run extracts into its summary sheet). Text/JSON and diffable (the
// "analysis is code" differentiator); persists like peak recipes
// (localStorage) and exports/imports as a standalone .json file. Pure, bar
// the lib/storageWarning.ts toast on a refused storage write.
//
// A SAVED TRANSFORMATION RECIPE (P2.5 box 4) is the same record with three
// additive-optional fields: a `description`, a `revision` (1 on first save,
// +1 on every re-save under the same name — what a derived output's
// provenance cites beside the name), and `expects` (lib/recipeExpect.ts: the
// input columns, units and metadata the steps read, checked before an apply).
// Absent on every template saved before them, which load unchanged; `version`
// stays 1 because no existing field changed meaning.

import { makeStep, STEP_KINDS, type PipelineStep, type StepKind } from "./pipeline";
import { sanitizeExpectations, type RecipeExpectations } from "./recipeExpect";
import { warnStorageRefused } from "./storageWarning";
import { TEMPLATES_KEY } from "./templateKey";
import type { CalcResult, DataStruct } from "./types";

export interface AnalysisTemplate {
  version: 1;
  name: string;
  /** Ordered typed steps. "import" steps are the input slots — a run binds
   *  each processed file to them (they never re-execute verbatim). */
  steps: PipelineStep[];
  /** Declared outputs for the batch summary sheet (#3): typically the last
   *  fit step's parameter names + goodness-of-fit. */
  outputs: string[];
  /** P2.5 recipe: what it does, in the author's words. */
  description?: string;
  /** P2.5 recipe: 1, 2, … — bumped on every save under the same name. */
  revision?: number;
  /** P2.5 recipe: the input the steps read (lib/recipeExpect.ts). */
  expects?: RecipeExpectations;
}

/** The recipe fields `toTemplate` accepts (module doc). */
export type RecipeFields = Pick<AnalysisTemplate, "description" | "revision" | "expects">;

/** Freeze the current step list as a named template. */
export function toTemplate(
  name: string,
  steps: readonly PipelineStep[],
  outputs: readonly string[],
  recipe: RecipeFields = {},
): AnalysisTemplate {
  return {
    version: 1,
    name,
    // Strip volatile ids — a template is content, not session state.
    steps: steps.map((s) => ({ ...s, id: "" })),
    outputs: [...outputs],
    ...recipeFieldsOf(recipe as Record<string, unknown>),
  };
}

/** The valid recipe fields of `o`; anything malformed is left out. */
function recipeFieldsOf(o: Record<string, unknown>): RecipeFields {
  const expects = sanitizeExpectations(o.expects);
  const rev = o.revision;
  return {
    ...(typeof o.description === "string" && o.description.trim() ? { description: o.description.trim() } : {}),
    ...(typeof rev === "number" && Number.isInteger(rev) && rev > 0 ? { revision: rev } : {}),
    ...(expects ? { expects } : {}),
  };
}

/** Pretty, key-stable JSON so templates diff cleanly in git (#2 acceptance). */
export function serializeTemplate(t: AnalysisTemplate): string {
  return JSON.stringify(t, null, 2) + "\n";
}

function isStep(v: unknown): v is PipelineStep {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.label === "string" &&
    typeof o.code === "string" &&
    STEP_KINDS.includes(String(o.kind)) &&
    typeof o.params === "object" &&
    o.params !== null
  );
}

/** Parse + validate a template document; throws with a clear message. Steps
 *  get fresh ids so a loaded template never collides with live steps. */
export function parseTemplate(text: string): AnalysisTemplate {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error("not a valid template file (bad JSON)");
  }
  if (typeof v !== "object" || v === null) throw new Error("not a template file");
  const o = v as Record<string, unknown>;
  if (o.version !== 1) throw new Error(`unsupported template version: ${String(o.version)}`);
  if (typeof o.name !== "string" || !o.name.trim()) throw new Error("template needs a name");
  if (!Array.isArray(o.steps) || !o.steps.every(isStep)) {
    throw new Error("template has malformed steps");
  }
  const outputs = Array.isArray(o.outputs)
    ? o.outputs.filter((x): x is string => typeof x === "string")
    : [];
  return {
    version: 1,
    name: o.name,
    steps: (o.steps as PipelineStep[]).map((s) => ({
      ...makeStep(s.kind as StepKind, s.label, s.code, { ...s.params }),
      enabled: s.enabled !== false,
    })),
    outputs,
    ...recipeFieldsOf(o),
  };
}

// ── Persistence (localStorage, like peak recipes) ──────────────────────────
// Finding #10: the key lives in lib/templateKey.ts, a tiny eager-safe module
// shared with lib/contextActions.ts (which needs the same key but can't
// import this whole module — see that file's own comment).
const KEY = TEMPLATES_KEY;

/** Window event fired after every write below, so an open reader (the
 *  Recipe Manager's Transform picker) can re-read the list. */
export const TEMPLATES_CHANGED_EVENT = "qz:templates-changed";

function announce(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TEMPLATES_CHANGED_EVENT));
}

export function loadTemplates(): AnalysisTemplate[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((t) => {
      try {
        return [parseTemplate(JSON.stringify(t))];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

/** Save (upsert by name) and return the new list. */
export function saveTemplate(t: AnalysisTemplate): AnalysisTemplate[] {
  const list = loadTemplates().filter((x) => x.name !== t.name);
  list.push(t);
  return saveTemplates(list);
}

/** Write the whole list (one storage write — a `.dwk` open adds several,
 *  lib/templatesProject.ts) and return it. */
export function saveTemplates(list: AnalysisTemplate[]): AnalysisTemplate[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    warnStorageRefused("analysis template"); // stays session-local
  }
  announce();
  return list;
}

export function deleteTemplate(name: string): AnalysisTemplate[] {
  const list = loadTemplates().filter((x) => x.name !== name);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    warnStorageRefused("analysis template");
  }
  announce();
  return list;
}

/** The raw stored list, untouched — every entry, readable or not, in storage
 *  order. `appendTemplates`'s own read; not for general use (every other
 *  reader wants `loadTemplates`'s validated list). */
function readRawTemplates(): unknown[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Append `records` in ONE read + ONE write, preserving any raw entry
 *  already in the slot that this build cannot parse — a newer build's
 *  version, or a damaged record (finding #6; mirrors lib/fitmodels.ts's
 *  `appendCustomModels`). A `.dwk` open must not silently drop such a
 *  record just because it rewrites the slot to merge the project's templates
 *  in: `saveTemplates([...loadTemplates(), ...records])` would, since
 *  `loadTemplates()` only ever returns what THIS build could read. Returns
 *  the new readable list, AS RE-READ from storage, so a write storage
 *  refused (quota, blocked) is visible to the caller rather than reported as
 *  done. */
export function appendTemplates(records: readonly AnalysisTemplate[]): AnalysisTemplate[] {
  if (records.length > 0) {
    try {
      localStorage.setItem(KEY, JSON.stringify([...readRawTemplates(), ...records]));
    } catch {
      /* storage unavailable — stays session-local */
    }
    announce();
  }
  return loadTemplates();
}

// ── Batch summary sheet (#3) ────────────────────────────────────────────────

/** Pull the declared outputs out of a fit result (params by declared order;
 *  "R2" maps to the goodness-of-fit). NaN where the fit is absent or short. */
export function extractOutputs(outputs: readonly string[], fit: CalcResult | undefined): number[] {
  if (!fit) return outputs.map(() => Number.NaN);
  const params = (fit.params as number[] | undefined) ?? [];
  return outputs.map((name, i) => {
    if (name === "R2") return typeof fit.R2 === "number" ? fit.R2 : Number.NaN;
    return typeof params[i] === "number" ? params[i] : Number.NaN;
  });
}

/** One processed file's extracted outputs (NaN for a failed/missing value). */
export interface BatchRow {
  file: string;
  values: number[]; // aligned with the template's outputs
  failed?: string; // failure note — the row stays, flagged, never crashes the batch
}

/** Assemble the one-row-per-file summary worksheet: x = file index (1-based),
 *  channels = the declared outputs; file names + failures in metadata. Lands
 *  in the library as a normal DataStruct (plottable/exportable). */
export function summaryDataset(
  templateName: string,
  outputs: readonly string[],
  rows: readonly BatchRow[],
): DataStruct {
  return {
    time: rows.map((_, i) => i + 1),
    values: rows.map((r) => outputs.map((_, c) => r.values[c] ?? Number.NaN)),
    labels: [...outputs],
    units: outputs.map(() => ""),
    metadata: {
      x_column_name: "file #",
      source: `template batch: ${templateName}`,
      files: rows.map((r) => r.file),
      failures: rows.flatMap((r, i) => (r.failed ? [`${i + 1}: ${r.file} — ${r.failed}`] : [])),
    },
  };
}
