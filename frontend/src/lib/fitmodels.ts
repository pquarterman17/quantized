// Saved custom fit models (GOTO #1) — a named, reusable equation model:
// name + equation + last-used guesses/bounds. Persists like analysis
// templates (lib/template.ts) and peak recipes: a localStorage list, upsert
// by name, malformed entries dropped on load. Saved models appear in the fit
// workshop's model picker alongside registry models and prefill the equation
// panel when chosen. Pure — no store imports.
//
// VERSIONS (audit P2.7 slice 3). v1 is the original record. v2 adds an
// optional free-text `description` and optional per-parameter `units`
// (aligned with `params`; "" = none). A record is written as v2 ONLY when it
// carries one of those; a model without them is still written as v1, so an
// older build of the app keeps reading it. Old v1 records load unchanged.
//
// TOLERANT ON LOAD, STRICT ON IMPORT. A stored record that is not a valid v1
// or v2 (damaged, or written by a newer build) is skipped on load — and
// reported ONCE by `loadCustomModelsChecked` for the workshop to show — but
// never destroyed: saves and deletes rewrite the slot around it. An imported
// FILE gets no such leniency (lib/nameKeyedRecipes' `parseFitModelFile`).

export const CUSTOM_FIT_MODEL_VERSION = 2;

export interface CustomFitModel {
  version: 1 | 2;
  name: string;
  /** The equation text, e.g. "y = a*exp(-x/t) + c". The backend parser
   *  (calc/fit_equation, no-eval RPN interpreter) is the only evaluator. */
  equation: string;
  /** Parameter names from the last successful validate, in equation order. */
  params: string[];
  /** Last-used starting guesses, aligned with params. */
  guesses: number[];
  /** Last-used bounds, aligned with params; null = unbounded on that side. */
  lower: (number | null)[];
  upper: (number | null)[];
  /** v2: what the model is for, shown in the picker and the library. */
  description?: string;
  /** v2: unit of each parameter, aligned with params; "" = none. */
  units?: string[];
}

function isBoundList(v: unknown, n: number): v is (number | null)[] {
  return Array.isArray(v) && v.length === n && v.every((b) => b === null || typeof b === "number");
}

export function isCustomFitModel(v: unknown): v is CustomFitModel {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.version !== 1 && o.version !== 2) return false;
  if (typeof o.name !== "string" || !o.name.trim()) return false;
  if (typeof o.equation !== "string" || !o.equation.trim()) return false;
  if (!Array.isArray(o.params) || !o.params.every((p) => typeof p === "string")) return false;
  const n = o.params.length;
  if (!Array.isArray(o.guesses) || o.guesses.length !== n) return false;
  if (!o.guesses.every((g) => typeof g === "number" && Number.isFinite(g))) return false;
  if (!isBoundList(o.lower, n) || !isBoundList(o.upper, n)) return false;
  // v1 never wrote the v2 fields, so for every record an older build wrote
  // these two checks are no-ops; they only keep a bogus field from reaching
  // a consumer typed `string` / `string[]`.
  if (o.description !== undefined && typeof o.description !== "string") return false;
  if (o.units !== undefined) {
    if (!Array.isArray(o.units) || o.units.length !== n) return false;
    if (!o.units.every((u) => typeof u === "string")) return false;
  }
  return true;
}

/** Build a record at the lowest version that holds it: v1 unless it has a
 *  description or any unit (see VERSIONS above). Blank text is dropped. */
export function buildCustomFitModel(
  fields: Omit<CustomFitModel, "version" | "description" | "units"> & {
    description?: string;
    units?: readonly string[];
  },
): CustomFitModel {
  const { description, units, ...base } = fields;
  const desc = description?.trim() ?? "";
  const cleanUnits = (units ?? []).map((u) => u.trim());
  const hasUnits = cleanUnits.some((u) => u !== "") && cleanUnits.length === base.params.length;
  if (!desc && !hasUnits) return { version: 1, ...base };
  return {
    version: 2,
    ...base,
    ...(desc ? { description: desc } : {}),
    ...(hasUnits ? { units: cleanUnits } : {}),
  };
}

// ── Persistence (localStorage, like analysis templates) ─────────────────────
const KEY = "qz.customFitModels";

function readRaw(): unknown[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function nameOf(v: unknown): string | null {
  return typeof v === "object" && v !== null && typeof (v as { name?: unknown }).name === "string"
    ? (v as { name: string }).name
    : null;
}

export interface CheckedCustomModels {
  models: CustomFitModel[];
  /** One message naming every stored record that was skipped, or null. */
  warning: string | null;
}

/** Every readable saved model plus ONE warning naming the records skipped
 *  (a damaged entry, or one a newer build wrote). */
export function loadCustomModelsChecked(): CheckedCustomModels {
  const raw = readRaw();
  const models = raw.filter(isCustomFitModel);
  const skipped = raw.filter((r) => !isCustomFitModel(r));
  if (skipped.length === 0) return { models, warning: null };
  const names = skipped.map((r) => nameOf(r)).filter((n): n is string => !!n);
  const what = skipped.length === 1 ? "1 saved fit model" : `${skipped.length} saved fit models`;
  const which = names.length ? `: ${names.map((n) => `"${n}"`).join(", ")}` : "";
  return {
    models,
    warning: `${what} could not be read and ${skipped.length === 1 ? "was" : "were"} skipped${which} (left in storage untouched)`,
  };
}

export function loadCustomModels(): CustomFitModel[] {
  return readRaw().filter(isCustomFitModel);
}

/** Rewrite the slot as `raw` — unreadable records ride through untouched —
 *  and return the readable list (session-local if storage refuses). */
function writeRaw(raw: unknown[]): CustomFitModel[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(raw));
  } catch {
    /* storage unavailable — the change stays session-local */
  }
  return raw.filter(isCustomFitModel);
}

/** Save (upsert by name) and return the new list. */
export function saveCustomModel(m: CustomFitModel): CustomFitModel[] {
  return writeRaw([...readRaw().filter((x) => !isCustomFitModel(x) || x.name !== m.name), m]);
}

/** Delete the READABLE record(s) of that name; an unreadable one is kept. */
export function deleteCustomModel(name: string): CustomFitModel[] {
  return writeRaw(readRaw().filter((x) => !isCustomFitModel(x) || x.name !== name));
}
