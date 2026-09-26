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
// never destroyed: saves and deletes rewrite the slot around it, and its NAME
// stays taken (a save onto it is refused). A slot that is not a JSON array at
// all is moved aside to DAMAGED_BACKUP_KEY before the next save or delete —
// the user's own gesture, after the workshop has warned — but NEVER by a
// project open, which leaves a damaged slot untouched (`appendCustomModels`).
// An imported FILE gets no such leniency (lib/nameKeyedRecipes'
// `parseFitModelFile`).

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

/** The CREATION check: every model this app makes or takes in as a new record
 *  — the fit workshop's Save (components/workshops/curvefit/useEquationFit)
 *  and an imported model file (lib/nameKeyedRecipes' `parseFitModelFile`).
 *  NOT a project's embedded models, which are an existing library travelling
 *  and cross `rebuildCustomFitModel` instead (below). `isCustomFitModel`
 *  proves the SHAPE (aligned arrays, finite guesses), but a record can still
 *  be well-typed and unusable — a bound pair with lower > upper, a starting
 *  guess outside its own bounds (scipy refuses an infeasible x0 at fit
 *  time), a blank or duplicated parameter name. Those throw, naming the
 *  field; a usable record is REBUILT from its known fields, so unknown extra
 *  keys never reach `qz.customFitModels`. */
export function checkFitModelRecord(o: unknown): CustomFitModel {
  const bad = (field: string): never => {
    throw new Error(field);
  };
  if (!isCustomFitModel(o)) bad("not a valid fit model");
  const m = o as CustomFitModel;
  checkFitModelFields(m, bad);
  return rebuildCustomFitModel(m);
}

/** The field checks of `checkFitModelRecord`, on an already-typed record. */
function checkFitModelFields(m: CustomFitModel, bad: (field: string) => never): void {
  const seen = new Set<string>();
  m.params.forEach((name, i) => {
    if (!name.trim()) bad(`params[${i}]: empty name`);
    if (seen.has(name)) bad(`params[${i}]: duplicate "${name}"`);
    seen.add(name);
    const lo = m.lower[i];
    const hi = m.upper[i];
    if ((lo !== null && !Number.isFinite(lo)) || (hi !== null && !Number.isFinite(hi))) bad(`bounds[${name}]`);
    if (lo !== null && hi !== null && lo > hi) bad(`bounds[${name}]: lower > upper`);
    const g = m.guesses[i];
    if ((lo !== null && g < lo) || (hi !== null && g > hi)) bad(`guess[${name}]: outside its bounds`);
  });
}

/** A readable record rebuilt from its KNOWN fields only (unknown extra keys
 *  dropped), with no semantic checks — exactly what this library's own slot
 *  accepts. A project's embedded models cross this, not
 *  `checkFitModelRecord`: they are this same library on another machine, so
 *  a record the slot holds must never read as "unreadable" in a project
 *  (lib/fitModelsProject.ts). */
export function rebuildCustomFitModel(m: CustomFitModel): CustomFitModel {
  return buildCustomFitModel({
    name: m.name,
    equation: m.equation,
    params: [...m.params],
    guesses: [...m.guesses],
    lower: [...m.lower],
    upper: [...m.upper],
    description: m.description,
    units: m.units,
  });
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

/** Where a damaged slot's text is moved before the first write replaces it. */
export const DAMAGED_BACKUP_KEY = `${KEY}.damaged`;

interface Slot {
  list: unknown[];
  /** The slot's text when it is present but not a JSON array, else null. */
  damaged: string | null;
}

function readSlot(): Slot {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return { list: [], damaged: null };
  }
  if (!raw) return { list: [], damaged: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? { list: parsed, damaged: null } : { list: [], damaged: raw };
  } catch {
    return { list: [], damaged: raw };
  }
}

/** One pass over the slot: each raw entry is validated ONCE and lands in
 *  exactly one of the two lists (raw order kept in `raw`). */
interface Scan extends Slot {
  readable: CustomFitModel[];
  unreadable: unknown[];
}

function scan(): Scan {
  const slot = readSlot();
  const readable: CustomFitModel[] = [];
  const unreadable: unknown[] = [];
  for (const r of slot.list) (isCustomFitModel(r) ? readable : unreadable).push(r as CustomFitModel);
  return { ...slot, readable, unreadable };
}

/** A stored or carried record's `name`, when it has a string one — readable
 *  or not. Shared with lib/fitModelsProject.ts. */
export function nameOf(v: unknown): string | null {
  return typeof v === "object" && v !== null && typeof (v as { name?: unknown }).name === "string"
    ? (v as { name: string }).name
    : null;
}

/** The ONE warning for records that could not be read, naming them — the
 *  local slot's (`loadCustomModelsChecked`) and a project file's
 *  (lib/fitModelsProject.ts) share it. `where` follows the count ("" or
 *  " in this project"); `kept` says where the records still are. */
export function unreadableFitModelsWarning(skipped: readonly unknown[], where: string, kept: string): string {
  const names = skipped.map(nameOf).filter((n): n is string => !!n);
  const what = skipped.length === 1 ? "1 saved fit model" : `${skipped.length} saved fit models`;
  const which = names.length ? `: ${names.map((n) => `"${n}"`).join(", ")}` : "";
  return `${what}${where} could not be read and ${skipped.length === 1 ? "was" : "were"} skipped${which} (${kept})`;
}

export interface CheckedCustomModels {
  models: CustomFitModel[];
  /** One message naming every stored record that was skipped, or null. */
  warning: string | null;
}

/** Every readable saved model plus ONE warning naming the records skipped
 *  (a damaged entry, or one a newer build wrote). */
export function loadCustomModelsChecked(): CheckedCustomModels {
  const { readable: models, unreadable: skipped, damaged } = scan();
  if (damaged !== null) {
    return {
      models: [],
      warning:
        "the saved fit model list could not be read; it will be kept aside " +
        `(${DAMAGED_BACKUP_KEY}) when a model is next saved`,
    };
  }
  if (skipped.length === 0) return { models, warning: null };
  return { models, warning: unreadableFitModelsWarning(skipped, "", "left in storage untouched") };
}

export function loadCustomModels(): CustomFitModel[] {
  return scan().readable;
}

/** Names held by stored records this app cannot read (a newer build's
 *  version, a damaged entry). They are TAKEN, as peak recipes' are
 *  (lib/peakwizard `unreadablePeakRecipeNames`): a save onto one is refused,
 *  and rename / duplicate / import dedupe around it (lib/nameKeyedRecipes). */
export function unreadableCustomModelNames(): string[] {
  return scan().unreadable.map(nameOf).filter((n): n is string => !!n);
}

// ── Change notification ─────────────────────────────────────────────────────
// localStorage has no same-tab change event, so every write here bumps a
// revision and tells its subscribers: the fit workshop's picker and the
// Recipe Library (`useSyncExternalStore(subscribeCustomModels,
// customModelsRevision)`) re-read after a save, a delete, or a project open
// that merged models in — whichever panel made the change. A write from
// ANOTHER window of this origin arrives as a `storage` event, which bumps it
// the same way while anything is subscribed.
let revision = 0;
const listeners = new Set<() => void>();
const onStorage = (e: StorageEvent): void => {
  if (e.key === KEY || e.key === null) notifyChanged(); // null = storage cleared
};

/** A number that changes on every write to the library. */
export function customModelsRevision(): number {
  return revision;
}

/** Call `listener` after every write to the library, from this window or
 *  another; returns the unsubscribe. */
export function subscribeCustomModels(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function notifyChanged(): void {
  revision++;
  for (const l of [...listeners]) l();
}

/** Rewrite the slot as `raw` (unreadable records ride through untouched),
 *  moving a damaged slot aside first. Session-local if storage refuses.
 *  Notifies subscribers either way. */
function writeRaw(damaged: string | null, raw: unknown[]): void {
  writeSlot(damaged, raw);
  notifyChanged();
}

function writeSlot(damaged: string | null, raw: unknown[]): void {
  try {
    // A damaged slot (not a JSON array at all) is moved aside, never simply
    // overwritten: it may hold every model the user had. An earlier backup
    // is never replaced either; a second one gets a numbered key.
    if (damaged !== null) {
      let key = DAMAGED_BACKUP_KEY;
      for (let n = 2; localStorage.getItem(key) !== null && localStorage.getItem(key) !== damaged; n++) {
        key = `${DAMAGED_BACKUP_KEY}.${n}`;
      }
      localStorage.setItem(key, damaged);
    }
    localStorage.setItem(KEY, JSON.stringify(raw));
  } catch {
    /* storage unavailable — the change stays session-local */
  }
}

/** Save (upsert by name) and return the new readable list. Throws, writing
 *  nothing, when the name belongs to a stored record this app cannot read:
 *  keeping both would leave two records under one name, and replacing it
 *  would destroy a newer build's model. */
export function saveCustomModel(m: CustomFitModel): CustomFitModel[] {
  const { list, damaged } = readSlot();
  const raw: unknown[] = [];
  const readable: CustomFitModel[] = [];
  for (const r of list) {
    const ok = isCustomFitModel(r);
    if (!ok && nameOf(r) === m.name) {
      throw new Error(
        `a saved fit model named "${m.name}" could not be read (a newer or damaged record) — save under another name`,
      );
    }
    if (ok && r.name === m.name) continue;
    raw.push(r);
    if (ok) readable.push(r);
  }
  raw.push(m);
  readable.push(m);
  writeRaw(damaged, raw);
  return readable;
}

/** Append several records in ONE read and ONE write (a project open,
 *  lib/fitModelsProject.ts). The caller guarantees every name is free — this
 *  never replaces anything. Returns the readable list AS RE-READ from storage
 *  (`stored`), so a write that storage refused (quota, blocked) is visible to
 *  the caller instead of reported as done.
 *
 *  A DAMAGED slot (not a JSON array) is not written at all — nothing
 *  appended, nothing moved aside — and `damaged` is true: an open is not the
 *  user choosing to replace a list they cannot see, and they were never told
 *  it happened. The caller carries the records and says why. */
export function appendCustomModels(records: readonly CustomFitModel[]): { stored: CustomFitModel[]; damaged: boolean } {
  const { list, damaged } = readSlot();
  if (damaged !== null) return { stored: [], damaged: true };
  if (records.length > 0) writeRaw(damaged, [...list, ...records]);
  return { stored: loadCustomModels(), damaged: false };
}

/** Delete the READABLE record(s) of that name; an unreadable one is kept. */
export function deleteCustomModel(name: string): CustomFitModel[] {
  const { list, damaged } = readSlot();
  const raw: unknown[] = [];
  const readable: CustomFitModel[] = [];
  for (const r of list) {
    const ok = isCustomFitModel(r);
    if (ok && r.name === name) continue;
    raw.push(r);
    if (ok) readable.push(r);
  }
  writeRaw(damaged, raw);
  return readable;
}
