// Saved custom fit models (GOTO #1) — a named, reusable equation model:
// name + equation + last-used guesses/bounds. Persists like analysis
// templates (lib/template.ts) and peak recipes: a localStorage list, upsert
// by name, malformed entries dropped on load. Saved models appear in the fit
// workshop's model picker alongside registry models and prefill the equation
// panel when chosen. Pure — no store imports.

export interface CustomFitModel {
  version: 1;
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
}

function isBoundList(v: unknown, n: number): v is (number | null)[] {
  return Array.isArray(v) && v.length === n && v.every((b) => b === null || typeof b === "number");
}

export function isCustomFitModel(v: unknown): v is CustomFitModel {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.version !== 1) return false;
  if (typeof o.name !== "string" || !o.name.trim()) return false;
  if (typeof o.equation !== "string" || !o.equation.trim()) return false;
  if (!Array.isArray(o.params) || !o.params.every((p) => typeof p === "string")) return false;
  const n = o.params.length;
  if (!Array.isArray(o.guesses) || o.guesses.length !== n) return false;
  if (!o.guesses.every((g) => typeof g === "number" && Number.isFinite(g))) return false;
  return isBoundList(o.lower, n) && isBoundList(o.upper, n);
}

// ── Persistence (localStorage, like analysis templates) ─────────────────────
const KEY = "qz.customFitModels";

export function loadCustomModels(): CustomFitModel[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCustomFitModel);
  } catch {
    return [];
  }
}

/** Save (upsert by name) and return the new list. */
export function saveCustomModel(m: CustomFitModel): CustomFitModel[] {
  const list = loadCustomModels().filter((x) => x.name !== m.name);
  list.push(m);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — the model stays session-local */
  }
  return list;
}

export function deleteCustomModel(name: string): CustomFitModel[] {
  const list = loadCustomModels().filter((x) => x.name !== name);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}
