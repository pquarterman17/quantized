// P3.5 operation layer — rename / duplicate / delete / import / export for the
// four NAME-KEYED recipe systems (analysis, peak, graph, fitModel).
//
// WHY THESE FOUR TOGETHER. They are structurally identical: each stores a flat
// array in one localStorage slot, each record's `name` IS its primary key, and
// each exposes the same three functions — a `load*` returning the array, a
// `save*` that UPSERTS BY NAME, and a `delete*` that removes by name. Nothing
// else about them is shared, and nothing here reaches into a record beyond its
// `name`; the payload is opaque. That is what makes one adapter table honest
// rather than a lowest-common-denominator fiction.
//
// ── RENAME IS A DELETE PLUS A CREATE, AND THAT HAS TEETH ─────────────────
// Because `save*` upserts by name, renaming means writing the record under the
// new name and removing the old one. Three things follow, each of which is a
// way to lose a user's work if you get it wrong, and each has a test:
//
//   1. RENAME TO THE SAME NAME MUST NO-OP. Save-then-remove with from === to
//      writes the record and then deletes exactly what it just wrote. A
//      case-only "rename" that is really a no-op would silently destroy the
//      recipe.
//   2. SAVE BEFORE REMOVE, never the reverse. If the second step fails (quota,
//      private mode) the record still exists under one of the two names. The
//      other order can leave it under neither.
//   3. THE SIDECAR MUST TRAVEL. Favorites and tags are keyed by `refKey`, which
//      embeds the name, so a rename orphans them unless `moveEntry` carries
//      them across. This is the whole reason `recipeIndex.moveEntry` exists,
//      and wiring it here is what makes `canRename` honest for these kinds —
//      `stableId` stays false, because the underlying identity really does
//      change.
//
// A rename onto a name another record already holds DEDUPES ("X" -> "X (2)")
// rather than overwriting, matching `renameQuickPlotTemplate` and the L0.31
// convention used everywhere else in this codebase: two rows must never
// collide onto one label, and silently merging two recipes is worse than an
// unexpected suffix. The result reports the name actually used so a caller can
// say so.

import { isGraphTemplate, loadGraphTemplates, saveGraphTemplate, deleteGraphTemplate } from "./figuredoc";
import { isCustomFitModel, loadCustomModels, saveCustomModel, deleteCustomModel } from "./fitmodels";
import {
  deleteRecipe as deletePeakRecipe,
  isPeakRecipe,
  loadRecipes as loadPeakRecipes,
  saveRecipe as savePeakRecipe,
} from "./peakwizard";
import { dropEntry, moveEntry } from "./recipeIndex";
import type { RecipeKind, RecipeRef } from "./recipeLibrary";
import { uniqueTemplateName } from "./uniqueName";
import {
  deleteTemplate,
  loadTemplates,
  parseTemplate,
  saveTemplate,
  serializeTemplate,
} from "./template";

/** The subset of `RecipeKind` this module owns. The other two (plot,
 *  quickPlot) are store-backed, and the dispatcher that routes between the
 *  two worlds is `components/workshops/recipelibrary/recipeActions.ts` — a
 *  component module, because the plot half of those operations lives in one
 *  too. */
export type NameKeyedKind = Extract<RecipeKind, "analysis" | "peak" | "graph" | "fitModel">;

export const NAME_KEYED_KINDS: readonly NameKeyedKind[] = ["analysis", "peak", "graph", "fitModel"];

/** All this layer knows about a record. The payload is deliberately opaque:
 *  the only field any operation here reads or writes is `name`. */
interface NamedRecord {
  readonly name: string;
}

interface Adapter {
  load: () => readonly NamedRecord[];
  /** Upserts by name. The cast at each call site is sound because the record
   *  passed in always originated from THIS adapter's own `load`, with only
   *  `name` replaced. */
  save: (record: NamedRecord) => void;
  remove: (name: string) => void;
  /** Optional in the type so a future name-keyed kind without a serializer
   *  compiles honestly; every entry in `ADAPTERS` below now sets one (P3.5) —
   *  see RECIPE_CAPABILITIES for the resulting `canImportExport` matrix. */
  serialize?: (record: NamedRecord) => string;
  parse?: (text: string) => NamedRecord;
}

// ── P3.5 import/export for the three that had none ─────────────────────────
//
// Serialize matches `serializeTemplate` exactly (pretty, key-stable JSON) so
// every name-keyed export reads the same in a diff. Parse validates with the
// SAME guard each system's own loader uses (`isPeakRecipe`/`isGraphTemplate`/
// `isCustomFitModel`), never a second hand-rolled shape check -- one
// validator per format, used at both the storage boundary and the file
// boundary.
//
// A non-empty name is required at the FILE boundary for all three, even
// though `isPeakRecipe`/`isGraphTemplate` do not enforce it at the STORAGE
// boundary (`isCustomFitModel` already does). That asymmetry is deliberate:
// loosening the load-time validator would change what a stored (already
// trusted) record is tolerated to look like, which is not this change's
// business; an imported file is untrusted input and gets the stricter gate.
function serializeRecord(record: NamedRecord): string {
  return JSON.stringify(record, null, 2) + "\n";
}

function parseJsonRecord(text: string, label: string): Record<string, unknown> {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error(`not a valid ${label} file (bad JSON)`);
  }
  if (typeof v !== "object" || v === null) throw new Error(`not a valid ${label} file`);
  return v as Record<string, unknown>;
}

function requireName(o: Record<string, unknown>, label: string): void {
  if (typeof o.name !== "string" || !o.name.trim()) throw new Error(`${label} needs a name`);
}

function parsePeakRecipeFile(text: string): NamedRecord {
  const o = parseJsonRecord(text, "peak recipe");
  if (!isPeakRecipe(o)) throw new Error("not a valid peak recipe file");
  requireName(o, "peak recipe");
  return o;
}

function parseFitModelFile(text: string): NamedRecord {
  const o = parseJsonRecord(text, "fit model");
  if (!isCustomFitModel(o)) throw new Error("not a valid fit model file");
  requireName(o, "fit model");
  return o;
}

/** Stricter than the load-time `isGraphTemplate`: an imported file must
 *  actually CARRY `overrides`/`seriesStyles` (present, and object-or-null /
 *  array-or-null respectively), not merely omit them. Without this, a
 *  garbage `{name, style}` object -- which `isGraphTemplate` alone accepts,
 *  since it only checks those two fields -- would import as an empty-looking
 *  "valid" template. Every REAL `GraphTemplate` (the type both fields are
 *  required on) always carries both keys once serialized, so this refuses
 *  nothing a genuine export could ever produce. */
function parseGraphTemplateFile(text: string): NamedRecord {
  const o = parseJsonRecord(text, "graph template");
  if (!isGraphTemplate(o)) throw new Error("not a valid graph template file");
  requireName(o, "graph template");
  if (!("overrides" in o) || (o.overrides !== null && typeof o.overrides !== "object")) {
    throw new Error("not a valid graph template file");
  }
  if (!("seriesStyles" in o) || (o.seriesStyles !== null && !Array.isArray(o.seriesStyles))) {
    throw new Error("not a valid graph template file");
  }
  return o;
}

const ADAPTERS: Record<NameKeyedKind, Adapter> = {
  analysis: {
    load: loadTemplates,
    save: (r) => void saveTemplate(r as ReturnType<typeof loadTemplates>[number]),
    remove: (name) => void deleteTemplate(name),
    serialize: (r) => serializeTemplate(r as ReturnType<typeof loadTemplates>[number]),
    parse: parseTemplate,
  },
  peak: {
    load: loadPeakRecipes,
    save: (r) => void savePeakRecipe(r as ReturnType<typeof loadPeakRecipes>[number]),
    remove: (name) => void deletePeakRecipe(name),
    serialize: serializeRecord,
    parse: parsePeakRecipeFile,
  },
  graph: {
    load: loadGraphTemplates,
    save: (r) => void saveGraphTemplate(r as ReturnType<typeof loadGraphTemplates>[number]),
    remove: (name) => void deleteGraphTemplate(name),
    serialize: serializeRecord,
    parse: parseGraphTemplateFile,
  },
  fitModel: {
    load: loadCustomModels,
    save: (r) => void saveCustomModel(r as ReturnType<typeof loadCustomModels>[number]),
    remove: (name) => void deleteCustomModel(name),
    serialize: serializeRecord,
    parse: parseFitModelFile,
  },
};

/** Outcome of one operation. `name` is the name actually used, which is not
 *  always the one asked for — a collision dedupes. Refusal carries a reason
 *  fit to show a user, never an exception: these are ordinary outcomes (the
 *  record was deleted in another tab, the kind has no serializer), not bugs. */
export type RecipeOpResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: string };

const ref = (kind: NameKeyedKind, name: string): RecipeRef => ({ kind, scope: "global", id: name });

function find(kind: NameKeyedKind, name: string): NamedRecord | null {
  return ADAPTERS[kind].load().find((r) => r.name === name) ?? null;
}

export function renameNameKeyed(kind: NameKeyedKind, from: string, to: string): RecipeOpResult {
  const wanted = to.trim();
  if (wanted === "") return { ok: false, reason: "name cannot be empty" };
  // Guard 1 above. Falling through here would save the record and then delete
  // the very thing it just saved.
  if (wanted === from) return { ok: true, name: from };

  const adapter = ADAPTERS[kind];
  const all = adapter.load();
  const record = all.find((r) => r.name === from);
  if (!record) return { ok: false, reason: `"${from}" no longer exists` };

  const taken = new Set(all.map((r) => r.name).filter((n) => n !== from));
  const final = uniqueTemplateName(wanted, taken);
  adapter.save({ ...record, name: final }); // guard 2: save first…
  adapter.remove(from); // …then drop the old key
  moveEntry(ref(kind, from), ref(kind, final)); // guard 3: favorites/tags travel
  return { ok: true, name: final };
}

/** A duplicate is a NEW recipe, so it deliberately starts with NO sidecar
 *  metadata: inheriting the original's favorite flag and tags would assert a
 *  judgement about a copy the user has not formed yet. The payload is copied
 *  verbatim; only the name changes. */
export function duplicateNameKeyed(kind: NameKeyedKind, name: string): RecipeOpResult {
  const adapter = ADAPTERS[kind];
  const all = adapter.load();
  const record = all.find((r) => r.name === name);
  if (!record) return { ok: false, reason: `"${name}" no longer exists` };
  const final = uniqueTemplateName(`${name} copy`, new Set(all.map((r) => r.name)));
  adapter.save({ ...record, name: final });
  return { ok: true, name: final };
}

/** Deletes the record AND its sidecar entry. Dropping the entry here rather
 *  than waiting for `pruneEntries` matters because pruning is guarded on every
 *  source having been read completely — a user who deletes a recipe while some
 *  other system is unreadable would otherwise keep its favorite forever. */
export function deleteNameKeyed(kind: NameKeyedKind, name: string): RecipeOpResult {
  if (!find(kind, name)) return { ok: false, reason: `"${name}" no longer exists` };
  ADAPTERS[kind].remove(name);
  dropEntry(ref(kind, name));
  return { ok: true, name };
}

/** Serialized text for a record, or a refusal when the record itself is
 *  already gone (a normal race with another tab or an undo). Every
 *  name-keyed kind has a serializer as of P3.5 — the `adapter.serialize`
 *  check stays as a type-level guard, not a live refusal path today. */
export function exportNameKeyed(kind: NameKeyedKind, name: string): { ok: true; text: string; name: string } | { ok: false; reason: string } {
  const adapter = ADAPTERS[kind];
  if (!adapter.serialize) return { ok: false, reason: `${kind} recipes cannot be exported yet` };
  const record = find(kind, name);
  if (!record) return { ok: false, reason: `"${name}" no longer exists` };
  return { ok: true, text: adapter.serialize(record), name: record.name };
}

/** Parse and store an exported recipe, deduping its name against what is
 *  already there so an import never silently overwrites. */
export function importNameKeyed(kind: NameKeyedKind, text: string): RecipeOpResult {
  const adapter = ADAPTERS[kind];
  if (!adapter.parse) return { ok: false, reason: `${kind} recipes cannot be imported yet` };
  let parsed: NamedRecord;
  try {
    parsed = adapter.parse(text);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "not a valid recipe file" };
  }
  const final = uniqueTemplateName(parsed.name, new Set(adapter.load().map((r) => r.name)));
  adapter.save({ ...parsed, name: final });
  return { ok: true, name: final };
}
