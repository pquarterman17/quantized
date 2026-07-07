// Analysis templates (#2/#3) — a template is a NAMED, SERIALIZED pipeline:
// version tag + the ordered typed steps + declared outputs (the fit parameters
// a batch run extracts into its summary sheet). Text/JSON and diffable (the
// "analysis is code" differentiator); persists like peak recipes
// (localStorage) and exports/imports as a standalone .json file. Pure.

import { makeStep, type PipelineStep, type StepKind } from "./pipeline";
import type { DataStruct } from "./types";

export interface AnalysisTemplate {
  version: 1;
  name: string;
  /** Ordered typed steps. "import" steps are the input slots — a run binds
   *  each processed file to them (they never re-execute verbatim). */
  steps: PipelineStep[];
  /** Declared outputs for the batch summary sheet (#3): typically the last
   *  fit step's parameter names + goodness-of-fit. */
  outputs: string[];
}

/** Freeze the current step list as a named template. */
export function toTemplate(
  name: string,
  steps: readonly PipelineStep[],
  outputs: readonly string[],
): AnalysisTemplate {
  return {
    version: 1,
    name,
    // Strip volatile ids — a template is content, not session state.
    steps: steps.map((s) => ({ ...s, id: "" })),
    outputs: [...outputs],
  };
}

/** Pretty, key-stable JSON so templates diff cleanly in git (#2 acceptance). */
export function serializeTemplate(t: AnalysisTemplate): string {
  return JSON.stringify(t, null, 2) + "\n";
}

const KINDS: readonly string[] = ["ui", "import", "expression", "correction", "reset", "fit"];

function isStep(v: unknown): v is PipelineStep {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.label === "string" &&
    typeof o.code === "string" &&
    KINDS.includes(String(o.kind)) &&
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
  };
}

// ── Persistence (localStorage, like peak recipes) ──────────────────────────
const KEY = "qz.analysisTemplates";

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
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — template stays session-local */
  }
  return list;
}

export function deleteTemplate(name: string): AnalysisTemplate[] {
  const list = loadTemplates().filter((x) => x.name !== name);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}

// ── Batch summary sheet (#3) ────────────────────────────────────────────────
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
