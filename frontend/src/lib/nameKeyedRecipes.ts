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

import { isGraphTemplate, loadGraphTemplates, saveGraphTemplate, deleteGraphTemplate, type GraphTemplate } from "./figuredoc";
import { sanitizeFigureOverrides } from "./figureOverrides";
import { sanitizeExportSeriesStyles } from "./publicationStyles";
import { isCustomFitModel, loadCustomModels, saveCustomModel, deleteCustomModel } from "./fitmodels";
import {
  deleteRecipe as deletePeakRecipe,
  isPeakRecipe,
  loadRecipes as loadPeakRecipes,
  PEAK_LINK_MODES,
  PEAK_SHAPES,
  type PeakRecipe,
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

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const finiteOrNull = (v: unknown): v is number | null => v === null || finite(v);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): v is T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v);
const nonneg = (v: unknown): v is number => finite(v) && v >= 0;
const positive = (v: unknown): v is number => finite(v) && v > 0;
const nonnegInt = (v: unknown): v is number => nonneg(v) && Number.isInteger(v);
const posInt = (v: unknown): v is number => positive(v) && Number.isInteger(v);

const PEAK_BASELINE_METHODS = ["none", "als", "rollingball", "modpoly"] as const;
const PEAK_REPORT_MODES = ["fit", "integrate"] as const;

/** FIELD-LEVEL validation at the file boundary (review finding on #290).
 *  `isPeakRecipe` -- the storage-boundary guard -- only checks that the five
 *  child values are non-null objects, which is the right tolerance for a
 *  record this app wrote itself but accepts `{range:{}, baseline:{}, ...}`
 *  from a file, and the Peak Analyzer then reads `undefined` where it
 *  expects numbers and enums. An imported file is untrusted, so every field
 *  the `PeakRecipe` type declares is checked for type, finiteness and enum
 *  membership here; nothing structurally "present but empty" gets through.
 *  Unknown extra keys are dropped rather than persisted.
 *
 *  SEMANTIC bounds too (review round 3 on #290): a well-typed value the
 *  wizard could never produce -- it rounds `order`/`max_peaks`/`bgDegree`
 *  and clamps `max_peaks >= 1`, `bgDegree >= 0`; the backend declares the
 *  counts/orders as `int` and refuses unknown shapes/link modes at fit time
 *  -- would import "successfully" and then fail the moment it is used. The
 *  rules mirror the owning UI/domain constraints, no tighter:
 *    range          lo <= hi when both are set
 *    baseline       lam > 0 (ALS smoothness); 0 < p < 1 (ALS asymmetry —
 *                   calc/baseline.py's baseline_als raises outside the OPEN
 *                   interval, so 0 and 1 are refused here too);
 *                   radius integer >= 1 (rolling-ball points);
 *                   order integer >= 0 (modpoly)
 *    find           snr_threshold >= 0; min_prominence >= 0;
 *                   max_peaks integer >= 1
 *    model          shape in PEAK_SHAPES; linkMode in PEAK_LINK_MODES;
 *                   bgDegree integer >= 0
 *    report         regionWidth > 0 (a width in x FWHM) */
function parsePeakRecipeFile(text: string): NamedRecord {
  const o = parseJsonRecord(text, "peak recipe");
  if (!isPeakRecipe(o)) throw new Error("not a valid peak recipe file");
  requireName(o, "peak recipe");
  const bad = (field: string): never => {
    throw new Error(`not a valid peak recipe file (${field})`);
  };
  const range = o.range as Record<string, unknown>;
  if (!finiteOrNull(range.lo) || !finiteOrNull(range.hi)) bad("range");
  if (range.lo !== null && range.hi !== null && (range.lo as number) > (range.hi as number)) bad("range: lo > hi");
  const baseline = o.baseline as Record<string, unknown>;
  if (!oneOf(baseline.method, PEAK_BASELINE_METHODS)) bad("baseline.method");
  if (!positive(baseline.lam)) bad("baseline.lam");
  if (!positive(baseline.p) || baseline.p >= 1) bad("baseline.p");
  if (!posInt(baseline.radius)) bad("baseline.radius");
  if (!nonnegInt(baseline.order)) bad("baseline.order");
  const find = o.find as Record<string, unknown>;
  if (!nonneg(find.snr_threshold)) bad("find.snr_threshold");
  if (!nonneg(find.min_prominence)) bad("find.min_prominence");
  if (!posInt(find.max_peaks)) bad("find.max_peaks");
  const model = o.model as Record<string, unknown>;
  if (!oneOf(model.shape, PEAK_SHAPES)) bad("model.shape");
  if (!oneOf(model.linkMode, PEAK_LINK_MODES)) bad("model.linkMode");
  if (!nonnegInt(model.bgDegree)) bad("model.bgDegree");
  if (typeof model.constrain !== "boolean") bad("model.constrain");
  const report = o.report as Record<string, unknown>;
  if (!oneOf(report.mode, PEAK_REPORT_MODES)) bad("report.mode");
  if (!positive(report.regionWidth)) bad("report.regionWidth");
  const record: PeakRecipe = {
    version: 1,
    name: o.name as string,
    range: { lo: range.lo as number | null, hi: range.hi as number | null },
    baseline: {
      method: baseline.method as PeakRecipe["baseline"]["method"],
      lam: baseline.lam as number,
      p: baseline.p as number,
      radius: baseline.radius as number,
      order: baseline.order as number,
    },
    find: {
      snr_threshold: find.snr_threshold as number,
      min_prominence: find.min_prominence as number,
      max_peaks: find.max_peaks as number,
    },
    model: {
      shape: model.shape as string,
      bgDegree: model.bgDegree as number,
      linkMode: model.linkMode as string,
      constrain: model.constrain as boolean,
    },
    report: { mode: report.mode as PeakRecipe["report"]["mode"], regionWidth: report.regionWidth as number },
  };
  return record;
}

function parseFitModelFile(text: string): NamedRecord {
  const o = parseJsonRecord(text, "fit model");
  if (!isCustomFitModel(o)) throw new Error("not a valid fit model file");
  requireName(o, "fit model");
  return o;
}

/** FIELD-LEVEL validation at the file boundary (review finding on #290).
 *  `isGraphTemplate` -- the storage-boundary guard -- only checks `name` and
 *  `style` are strings, and a bare `typeof === "object"` check let an ARRAY
 *  through as `overrides` and arbitrary values through inside `seriesStyles`.
 *  Both nested shapes are now validated by the SAME sanitizers the rest of
 *  the app trusts for persisted input (`sanitizeFigureOverrides`,
 *  `sanitizeExportSeriesStyles`), never a second hand-rolled walk:
 *
 *   - `overrides`: null, or a plain (non-array) object; the sanitized result
 *     (validated known keys only) is what gets stored.
 *   - `seriesStyles`: null, or an array whose every entry is null or a plain
 *     object -- a bare number or string entry is refused outright, not
 *     silently nulled; the sanitized entries are what gets stored.
 *
 *  Both keys must be PRESENT (a real `GraphTemplate` always carries both once
 *  serialized), which is what refuses a garbage `{name, style}` object.
 *  Unknown extra keys are dropped rather than persisted. */
function parseGraphTemplateFile(text: string): NamedRecord {
  const o = parseJsonRecord(text, "graph template");
  if (!isGraphTemplate(o)) throw new Error("not a valid graph template file");
  requireName(o, "graph template");
  if (!("overrides" in o) || (o.overrides !== null && !isObj(o.overrides))) {
    throw new Error("not a valid graph template file (overrides)");
  }
  if (!("seriesStyles" in o) || (o.seriesStyles !== null && !Array.isArray(o.seriesStyles))) {
    throw new Error("not a valid graph template file (seriesStyles)");
  }
  const rawStyles = o.seriesStyles as unknown[] | null;
  if (rawStyles !== null && !rawStyles.every((entry) => entry === null || isObj(entry))) {
    throw new Error("not a valid graph template file (seriesStyles)");
  }
  const overrides = o.overrides === null ? null : sanitizeFigureOverrides(o.overrides);
  if (o.overrides !== null && overrides === null) throw new Error("not a valid graph template file (overrides)");
  const record: GraphTemplate = {
    name: o.name as string,
    style: o.style as string,
    overrides,
    seriesStyles: rawStyles === null ? null : sanitizeExportSeriesStyles(rawStyles),
    ...(typeof o.source === "string" ? { source: o.source } : {}),
  };
  return record;
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
  // Every `save*` swallows a `localStorage.setItem` failure (quota, private
  // mode) and keeps the record session-local at best -- so a bare "saved"
  // here would announce an import that did not persist and hand the panel a
  // row to focus that the next read cannot find (review finding on #290).
  // Re-read from storage: the record is imported only if it is THERE.
  if (!adapter.load().some((r) => r.name === final)) {
    return { ok: false, reason: `could not save the imported ${kind} recipe — storage is full or unavailable` };
  }
  return { ok: true, name: final };
}
