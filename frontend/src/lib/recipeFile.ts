// P3.5 slice 4 — recognize an untrusted JSON file's recipe KIND before any
// system-specific parser gets to run. This is the one place that decides
// "what does this file even claim to be", so the library-level "Import
// recipe…" button can route to the right importer without asking the user.
//
// SHAPE, NOT CONTENT. Every check below reads only structural fields
// (presence, type, a couple of literal discriminants) — never a value a user
// typed. A `RecipeKind` is the only thing this module hands back.
//
// MOST-SPECIFIC-FIRST, DELIBERATELY ORDERED. `plot`, `analysis`, `peak`, and
// `fitModel` each carry an unambiguous discriminant (a numeric `schemaVersion`
// plus array `signature`/object `mapping`; `version === 1` plus a distinct
// trio of fields) that no other kind's shape can satisfy, so their order
// among themselves does not matter. `graph` is checked LAST because its own
// discriminant (`name`+`style` strings) is the loosest of the five and is the
// one shape a `QuickPlotTemplate` could plausibly graze — `QuickPlotStyle` is
// itself a string union, so a saved quickPlot template's `style` field IS a
// string. What keeps a quickPlot template from sniffing as `graph` is the
// `"overrides" in o || "seriesStyles" in o` guard: a quickPlot template
// carries neither field, and a REAL `GraphTemplate` (both fields required on
// the type) always carries at least one once serialized.
//
// quickPlot has NO case here on purpose — it has no serializer (see
// `lib/recipeLibrary.ts`'s capability matrix), so nothing this module could
// ever be asked to sniff is genuinely a quickPlot export; a quickPlot-shaped
// object sniffs to `null`, same as any other file this system does not own.

import type { RecipeKind } from "./recipeLibrary";

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deterministic, never-throwing shape detection. `null` means "recognized
 *  by nothing here" — a refusal for the caller to report, not a crash. */
export function sniffRecipeKind(parsed: unknown): RecipeKind | null {
  if (!isObj(parsed)) return null;

  if (typeof parsed.schemaVersion === "number" && Array.isArray(parsed.signature) && isObj(parsed.mapping)) {
    return "plot";
  }
  // `steps` alone is the discriminant: no other kind carries one. `outputs` is
  // deliberately NOT required here because `parseTemplate` itself tolerates
  // its absence (defaults to []), and a sniffer stricter than the parser it
  // routes to would refuse at the library door a file the per-kind import
  // accepts.
  if (parsed.version === 1 && Array.isArray(parsed.steps)) {
    return "analysis";
  }
  if (parsed.version === 1 && isObj(parsed.baseline) && isObj(parsed.model) && isObj(parsed.find)) {
    return "peak";
  }
  if (parsed.version === 1 && typeof parsed.equation === "string" && Array.isArray(parsed.params)) {
    return "fitModel";
  }
  if (
    typeof parsed.name === "string" &&
    typeof parsed.style === "string" &&
    ("overrides" in parsed || "seriesStyles" in parsed)
  ) {
    return "graph";
  }
  return null;
}

export type RecipeFileSniff = { readonly kind: RecipeKind } | { readonly error: string };

/** JSON-parse + sniff in one step, with a user-facing refusal on either
 *  failure — the shape a file-picker handler wants directly. */
export function sniffRecipeKindFromText(text: string): RecipeFileSniff {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "not a valid recipe file (bad JSON)" };
  }
  const kind = sniffRecipeKind(parsed);
  return kind === null ? { error: "not a recognised recipe file" } : { kind };
}
