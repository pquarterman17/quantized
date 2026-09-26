// Saved custom fit models IN THE PROJECT FILE (.dwk) — the P2.7 follow-up.
//
// The fit-model library (lib/fitmodels.ts) is GLOBAL: one localStorage list
// per browser. This module is the bridge that lets a project carry it to
// another machine. It is reached only through the lazy `.dwk` codec
// (lib/workspace.ts parses, lib/workspaceSerialize.ts writes, and the store's
// load/append actions call `adoptProjectFitModels` through
// `workspaceCodec()`), so none of it is in the eager bundle.
//
// WHAT A SAVE EMBEDS: every readable model in the local library, plus the
// records the open project carried that this build could not accept (below).
// Not "the models the project uses": nothing in a project records which
// saved model a fit came from (an equation fit writes no `fitSpec`, and a
// model's name is not part of any result), so "used" is not derivable, and a
// heuristic that guessed would silently drop a model from a project that
// needed it. The cost is that a shared project carries the sender's whole
// fit-model library; a model is equation text plus start values, the same
// material the Recipe Library's export already hands out. The top-level key
// is written only when there is something to write, so a project saved by a
// user with no models is byte-identical to one saved before this existed.
//
// THE SAME MODEL. Two records are the same model when their DEFINITION agrees:
// equation, parameter names, description and units (a missing description or
// all-blank units = none). NOT the last-used start values and bounds, which
// the fit workshop rewrites on every fit — comparing those made every reopen
// of an older project after an ordinary fit look like a conflict. NOT the
// record `version` either, which is only the lowest format that holds it.
//
// WHAT AN OPEN DOES — the merge rule, applied per incoming record, in file
// order, against the library as it stands at that moment. The incoming name's
// BASE is the name without any trailing " (from project)" /
// " (from project N)", so a model that went A -> B -> A comes home instead of
// growing a second suffix.
//   1. Some local model whose base is the same holds the same model: nothing.
//      (Reopening the same project, or any older one, adds nothing.) The
//      LOCAL copy's last-used starts/bounds win: re-saving the project then
//      writes the local ones, so a project's own starting values are replaced
//      by this machine's for a model both hold. Deliberate — the start values
//      are last-used convenience, not part of the model — and the project's
//      fit results are untouched.
//   2. The name is free locally (no readable or unreadable record holds it):
//      the model is added under its own name.
//   3. Otherwise (the name holds a DIFFERENT model, or belongs to a local
//      record this build cannot read): the local one is NEVER touched; the
//      incoming one is added as "<base> (from project)", then
//      "(from project 2)", ... — the first name nothing holds.
// All additions are one storage write, then RE-READ: a record storage refused
// (quota, blocked) is not reported as added; it joins the carry below, so the
// next save still writes it into the project. One toast per open.
//
// Adding to the library is not undoable, exactly like saving a model from the
// fit workshop: the library is not project state. It also means a model the
// user deleted locally comes back when they open a project that holds it —
// the project needs it, and that is the point of carrying it. A crash-
// recovery AUTOSAVE is the exception (`autosaveRestoreFitModels`): it was
// written from this very library, which is newer, so its models are NOT
// merged back (that would resurrect deletions); the ones this library does not
// hold are moved to the carry instead, so the project still keeps them — a
// model the browser refused to store must survive a crash too.
//
// THE PROJECT BOUNDARY ACCEPTS WHAT THE LOCAL SLOT ACCEPTS: any record
// `isCustomFitModel` reads, rebuilt from its known fields
// (`rebuildCustomFitModel`, unknown keys dropped). The stricter creation
// checks (`checkFitModelRecord`: lower > upper, a guess outside its bounds,
// blank or duplicate parameter names) gate where a model is MADE — the fit
// workshop's Save and a model-file import — not where an existing library
// travels: a record this library holds must never come back from its own
// project as "could not be read".
//
// RECORDS THIS BUILD CANNOT READ — a newer build's version, a damaged entry,
// or a field that is not an array at all — are
// skipped with a migration warning and NEVER destroyed: they ride in the store
// (`fitModelCarry`, undoable with the rest of the project) and are written
// back into the file on the next save, the same "rewrite around it" rule
// lib/fitmodels.ts applies to its own slot. They also make the Recipe
// Library's `recipeSourcesComplete` false for the session.

import {
  appendCustomModels,
  isCustomFitModel,
  loadCustomModels,
  rebuildCustomFitModel,
  unreadableCustomModelNames,
  type CustomFitModel,
} from "./fitmodels";
import { toast } from "../store/toasts";

const nameOf = (r: unknown): string | null =>
  typeof r === "object" && r !== null && typeof (r as { name?: unknown }).name === "string"
    ? (r as { name: string }).name
    : null;

/** The file's `customFitModels` field, split into what this build accepts
 *  (validated and rebuilt from known fields) and what it must carry untouched.
 *  `undefined` (the key absent — every pre-P2.7 project) is an empty, whole
 *  source. A present non-array is carried as ONE record, so even a malformed
 *  field survives the next save. */
export function splitProjectFitModels(
  raw: unknown,
  migrationWarnings: string[],
): { models: CustomFitModel[]; carry: unknown[] } {
  if (raw === undefined) return { models: [], carry: [] };
  const list = Array.isArray(raw) ? raw : [raw];
  const models: CustomFitModel[] = [];
  const carry: unknown[] = [];
  for (const r of list) {
    if (isCustomFitModel(r)) models.push(rebuildCustomFitModel(r));
    else carry.push(r);
  }
  if (carry.length > 0) {
    const names = carry.map(nameOf).filter((n): n is string => !!n);
    const what = carry.length === 1 ? "1 saved fit model" : `${carry.length} saved fit models`;
    const which = names.length ? ` (${names.map((n) => `"${n}"`).join(", ")})` : "";
    migrationWarnings.push(
      `${what} in this project could not be read by this build and ${carry.length === 1 ? "was" : "were"} skipped${which}; kept in the project file`,
    );
  }
  return { models, carry };
}

/** The records a save writes: the given models (a parsed project re-saved) or
 *  else the local library's readable models, then the carried records — each
 *  once (appending the same project twice must not double them), and a
 *  READABLE carried record not at all when the library already holds that
 *  model under its base name (one the browser refused earlier and has since
 *  stored, say), so a file never holds a model twice. Reads localStorage; a
 *  storage failure reads as an empty library, exactly as `loadCustomModels`
 *  does. */
export function projectFitModelsForSave(
  models: readonly CustomFitModel[] | undefined,
  carry: readonly unknown[] | undefined,
): unknown[] {
  const lib = models ?? loadCustomModels();
  const out: unknown[] = [...lib];
  const held = new Set(lib.map(heldKey));
  const seen = new Set<string>();
  for (const r of carry ?? []) {
    const key = JSON.stringify(r) ?? "undefined";
    if (seen.has(key) || (isCustomFitModel(r) && held.has(heldKey(r)))) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** A crash-recovery restore (lib/autosave.ts): the autosave's models that
 *  this library already holds (same base name, same definition) are dropped —
 *  the library is newer — and the REST move to the carry, so they are kept
 *  in the project without being merged back into the library. */
export function autosaveRestoreFitModels(ws: {
  customFitModels?: CustomFitModel[];
  fitModelCarry?: unknown[];
}): { customFitModels: CustomFitModel[]; fitModelCarry: unknown[] } {
  const held = new Set(loadCustomModels().map(heldKey));
  const keep = (ws.customFitModels ?? []).filter((m) => !held.has(heldKey(m)));
  return { customFitModels: [], fitModelCarry: [...(ws.fitModelCarry ?? []), ...keep] };
}

/** "This library holds that model" — base name + definition. */
function heldKey(m: CustomFitModel): string {
  return `${baseName(m.name)}\u0000${definitionKey(m)}`;
}

/** The model's DEFINITION (see THE SAME MODEL above). */
function definitionKey(m: CustomFitModel): string {
  const units = m.units?.some((u) => u.trim() !== "") ? m.units.map((u) => u.trim()) : [];
  return JSON.stringify([m.equation, m.params, m.description?.trim() ?? "", units]);
}

const SUFFIX = / \(from project(?: \d+)?\)$/;

/** The name without any trailing "(from project[ N])", repeatedly. */
function baseName(name: string): string {
  let b = name;
  while (SUFFIX.test(b)) b = b.replace(SUFFIX, "");
  return b || name;
}

function suffixed(base: string, n: number): string {
  return n === 1 ? `${base} (from project)` : `${base} (from project ${n})`;
}

export interface AdoptResult {
  /** Names added to the library under their own name (rule 2). */
  added: string[];
  /** Rule 3: `[incoming name, name it was added under]`. */
  renamed: [string, string][];
  /** Records storage refused — the caller carries them so a save keeps them. */
  unstored: CustomFitModel[];
}

/** Merge a project's accepted models into the local library under the rule in
 *  this module's header. Never overwrites or deletes a local record. */
export function mergeProjectFitModels(incoming: readonly CustomFitModel[]): AdoptResult {
  const result: AdoptResult = { added: [], renamed: [], unstored: [] };
  if (incoming.length === 0) return result;
  const local = loadCustomModels();
  const taken = new Set([...local.map((m) => m.name), ...unreadableCustomModelNames()]);
  // Every definition already held under each base name (rule 1's lookup).
  const held = new Map<string, Set<string>>();
  const hold = (m: CustomFitModel): void => {
    const b = baseName(m.name);
    held.set(b, (held.get(b) ?? new Set()).add(definitionKey(m)));
  };
  local.forEach(hold);
  const toWrite: CustomFitModel[] = [];
  const plan: [string, string][] = []; // [incoming name, stored name]
  for (const m of incoming) {
    const base = baseName(m.name);
    if (held.get(base)?.has(definitionKey(m))) continue; // rule 1
    let name = m.name;
    if (taken.has(name)) {
      let n = 1;
      while (taken.has(suffixed(base, n))) n++;
      name = suffixed(base, n); // rule 3
    }
    const record: CustomFitModel = { ...m, name };
    toWrite.push(record);
    plan.push([m.name, name]);
    taken.add(name);
    hold(record);
  }
  if (toWrite.length === 0) return result;
  const stored = new Map(appendCustomModels(toWrite).map((m) => [m.name, m]));
  toWrite.forEach((record, i) => {
    const [from, to] = plan[i];
    const back = stored.get(to);
    if (!back || definitionKey(back) !== definitionKey(record)) result.unstored.push(record);
    else if (from === to) result.added.push(to);
    else result.renamed.push([from, to]);
  });
  return result;
}

const quoted = (names: readonly string[]): string => names.map((n) => `"${n}"`).join(", ");

/** The ONE message an open shows for a merge, or null when the project brought
 *  nothing new (the common reopen). `kept` says whether the refused records
 *  actually reached the carry — false when another load or an undo replaced
 *  the project before the merge landed, and the message must not claim it. */
export function adoptionMessage({ added, renamed, unstored }: AdoptResult, kept = true): string | null {
  const parts: string[] = [];
  if (added.length) {
    parts.push(
      `added ${added.length === 1 ? "1 fit model" : `${added.length} fit models`} from the project to your library: ${quoted(added)}`,
    );
  }
  if (renamed.length) {
    const list = renamed.map(([from, to]) => `"${from}" as "${to}"`).join(", ");
    parts.push(
      `${renamed.length === 1 ? "1 fit model differs" : `${renamed.length} fit models differ`} from the one saved here under the same name; yours ${renamed.length === 1 ? "was" : "were"} kept and the project's added as ${list}`,
    );
  }
  if (unstored.length) {
    parts.push(
      `${quoted(unstored.map((m) => m.name))} could not be saved to your library (browser storage refused it); ` +
        (kept
          ? "kept in the project"
          : "the project was replaced before it could be kept — it is still in the project file; reopen that file to try again"),
    );
  }
  return parts.length ? parts.join(". ") : null;
}

/** The slice of the store's `set` this module writes through. */
type CarrySet = (fn: (s: { fitModelCarry: unknown[] }) => { fitModelCarry?: unknown[] }) => void;

/** What the store's load/append runs after its own `set()`
 *  (store/workspaceHydration.ts, which already put this file's carry in
 *  place): merge the project's accepted models into the library and toast
 *  once. `expected` is the carry the store held right after that `set()`;
 *  if it is still there, records storage refused are added to it (so the
 *  next save keeps them) and it is re-set to a fresh array either way, so a
 *  subscriber re-renders — the library is localStorage, which nothing can
 *  subscribe to, and an OPEN Recipe Library panel (which subscribes to
 *  `fitModelCarry` for this) would otherwise keep listing the pre-merge
 *  models. If another load replaced it meanwhile, nothing is written: that
 *  project must not inherit this one's records. */
export function adoptProjectFitModels(
  ws: { customFitModels?: readonly CustomFitModel[] },
  set: CarrySet,
  expected: unknown[],
): void {
  const result = mergeProjectFitModels(ws.customFitModels ?? []);
  let kept = false;
  if (result.added.length || result.renamed.length || result.unstored.length) {
    // Zustand runs the updater synchronously, so `kept` is settled below.
    set((s) => {
      if (s.fitModelCarry !== expected) return {};
      kept = true;
      return { fitModelCarry: [...expected, ...result.unstored] };
    });
  }
  const msg = adoptionMessage(result, kept);
  if (msg) toast(msg, result.unstored.length ? "danger" : "info");
}
