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
// A save ALWAYS reads the library and the store's carry — never models a
// parsed workspace happens to hold (those are `projectFitModels`, outside
// `WorkspaceState`, so re-serializing a parsed file cannot write them).
//
// ONE RECORD PER NAME IN THE FILE (`projectFitModelsForSave`). The library
// wins: a carried record whose name the library (or an earlier carried
// record) already holds is written under the first free
// "<base> (from project[ N])" — the same suffix an open would give it — and
// a READABLE carried record the library already holds as the same model is
// not written at all. The rename is the only change a save ever makes to a
// carried record; nothing carried is ever dropped for its name.
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
//   3. Otherwise the incoming one is added as "<base> (from project)", then
//      "(from project 2)", ... — the first name nothing holds. The name was
//      held by a DIFFERENT local model (yours is kept), by a local record
//      this build cannot read (left untouched), or by an earlier, different
//      model in the same project; the toast says which.
// All additions are one storage write, then RE-READ: a record storage refused
// (quota, blocked) is not reported as added; it joins the carry below, so the
// next save still writes it into the project. One toast per open. A DAMAGED
// local slot (not a JSON array) is not written at all — an open never moves
// the user's unreadable list aside behind their back (lib/fitmodels.ts's
// `appendCustomModels`); every incoming model is carried instead and the
// toast says the list was left untouched.
//
// Adding to the library is not undoable, exactly like saving a model from the
// fit workshop: the library is not project state. It also means a model the
// user deleted locally comes back when they open a project that holds it —
// the project needs it, and that is the point of carrying it.
//
// CRASH-RECOVERY AUTOSAVE is the exception. An autosave is restored only on
// this machine, where the library already lives, so it embeds the CARRY only
// (`serializeWorkspace(ws, { fitModelLibrary: false })`, lib/autosave.ts), and
// a restore (`autosaveRestoreFitModels`) merges nothing: every record it holds
// goes back to the carry. Library models never enter an autosave, so a
// restart can neither resurrect a model deleted since nor pin an edited
// model's stale version as a second same-name record.
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
// THE CARRY (`fitModelCarry`, store/recipeFidelity.ts) holds exactly the
// project content the library does not: records this build cannot read — a
// newer build's version, a damaged entry, or a field that is not an array at
// all — skipped with a migration warning and NEVER destroyed, plus readable
// records the library refused (storage full, or a damaged slot). It is
// undoable with the rest of the project, autosaved, and written back into the
// file on the next save, the same "rewrite around it" rule lib/fitmodels.ts
// applies to its own slot. A non-empty carry makes the Recipe Library's
// sources incomplete (`recipeSourcesWhole`).

import {
  appendCustomModels,
  isCustomFitModel,
  loadCustomModels,
  nameOf,
  rebuildCustomFitModel,
  unreadableCustomModelNames,
  unreadableFitModelsWarning,
  type CustomFitModel,
} from "./fitmodels";
import { toast } from "../store/toasts";

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
    migrationWarnings.push(unreadableFitModelsWarning(carry, " in this project", "kept in the project file"));
  }
  return { models, carry };
}

/** The records a save writes: the local library's readable models (unless
 *  `fitModelLibrary` is false — the crash-recovery autosave, see the header),
 *  then the carried records, ONE PER NAME (see the header): each exact record
 *  once (appending the same project twice must not double it), a READABLE
 *  carried record not at all when the library already holds that model under
 *  its base name (one the browser refused earlier and has since stored, say),
 *  and a carried record whose name is already written renamed to the first
 *  free "(from project[ N])". Reads localStorage; a storage failure reads as
 *  an empty library, exactly as `loadCustomModels` does. */
export function projectFitModelsForSave(
  carry: readonly unknown[] | undefined,
  opts: { fitModelLibrary?: boolean } = {},
): unknown[] {
  const lib = opts.fitModelLibrary === false ? [] : loadCustomModels();
  const taken = new Set(lib.map((m) => m.name));
  const held = new Set(lib.map(heldKey));
  const seen = new Set<string>();
  // Pass 1: which records are written, and which keep their own name (the
  // first to claim a name the library does not hold).
  const kept: { record: unknown; clash: boolean }[] = [];
  for (const r of carry ?? []) {
    const key = JSON.stringify(r) ?? "undefined";
    if (seen.has(key) || (isCustomFitModel(r) && held.has(heldKey(r)))) continue;
    seen.add(key);
    if (isCustomFitModel(r)) held.add(heldKey(r)); // a rename keeps the base name
    const name = nameOf(r);
    const clash = name !== null && taken.has(name);
    if (name !== null) taken.add(name);
    kept.push({ record: r, clash });
  }
  // Pass 2: a clashing record takes a name NO record holds — `taken` now
  // includes every later record's own name, so a rename never lands on the
  // name a later record keeps (which would swap the two).
  const renamed = kept.map(({ record, clash }) => {
    if (!clash) return record;
    const name = freeName(nameOf(record) as string, taken);
    taken.add(name);
    return { ...(record as object), name };
  });
  return [...lib, ...renamed];
}

/** A crash-recovery restore (lib/autosave.ts). The autosave embeds only the
 *  CARRY (see the header), so everything it holds goes back to the carry —
 *  readable or not — and nothing is merged into the library. A readable one
 *  the library has since come to hold (same base name, same definition) is
 *  dropped: the library already keeps it. */
export function autosaveRestoreFitModels(ws: {
  projectFitModels?: CustomFitModel[];
  fitModelCarry?: unknown[];
}): { projectFitModels: CustomFitModel[]; fitModelCarry: unknown[] } {
  const held = new Set(loadCustomModels().map(heldKey));
  const keep = (ws.projectFitModels ?? []).filter((m) => !held.has(heldKey(m)));
  return { projectFitModels: [], fitModelCarry: [...(ws.fitModelCarry ?? []), ...keep] };
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

/** The first "<base> (from project[ N])" that `taken` does not hold. */
function freeName(name: string, taken: ReadonlySet<string>): string {
  const base = baseName(name);
  let n = 1;
  const at = (k: number): string => (k === 1 ? `${base} (from project)` : `${base} (from project ${k})`);
  while (taken.has(at(n))) n++;
  return at(n);
}

/** Why rule 3 renamed a model: its name was held by a different LOCAL model,
 *  by a local record this build cannot READ, or by an earlier, different
 *  model in the same PROJECT. */
export type RenameReason = "local" | "unreadable" | "project";

export interface Renamed {
  from: string;
  to: string;
  reason: RenameReason;
}

export interface AdoptResult {
  /** Names added to the library under their own name (rule 2). */
  added: string[];
  /** Rule 3, with why. */
  renamed: Renamed[];
  /** Records the library did not take — the caller carries them so a save
   *  keeps them. */
  unstored: CustomFitModel[];
  /** True when `unstored` is everything because the local slot is DAMAGED
   *  and was left untouched, rather than because storage refused a write. */
  libraryDamaged?: boolean;
}

/** Merge a project's accepted models into the local library under the rule in
 *  this module's header. Never overwrites or deletes a local record. */
export function mergeProjectFitModels(incoming: readonly CustomFitModel[]): AdoptResult {
  const result: AdoptResult = { added: [], renamed: [], unstored: [] };
  if (incoming.length === 0) return result;
  // A damaged slot reads as empty here; `appendCustomModels` then refuses to
  // write it and says so — the one guard for that case.
  const local = loadCustomModels();
  const localNames = new Set(local.map((m) => m.name));
  const unreadable = new Set(unreadableCustomModelNames());
  const taken = new Set([...localNames, ...unreadable]);
  // Every definition already held under each base name (rule 1's lookup).
  const held = new Map<string, Set<string>>();
  const hold = (m: CustomFitModel): void => {
    const b = baseName(m.name);
    held.set(b, (held.get(b) ?? new Set()).add(definitionKey(m)));
  };
  local.forEach(hold);
  const toWrite: CustomFitModel[] = [];
  const plan: Renamed[] = []; // `to` = the stored name; reason unused when from === to
  for (const m of incoming) {
    if (held.get(baseName(m.name))?.has(definitionKey(m))) continue; // rule 1
    let name = m.name;
    let reason: RenameReason = "project";
    if (taken.has(name)) {
      reason = localNames.has(name) ? "local" : unreadable.has(name) ? "unreadable" : "project";
      name = freeName(m.name, taken); // rule 3
    }
    const record: CustomFitModel = { ...m, name };
    toWrite.push(record);
    plan.push({ from: m.name, to: name, reason });
    taken.add(name);
    hold(record);
  }
  if (toWrite.length === 0) return result;
  const { stored: back, damaged } = appendCustomModels(toWrite);
  if (damaged) return { ...result, unstored: toWrite, libraryDamaged: true };
  const stored = new Map(back.map((m) => [m.name, m]));
  toWrite.forEach((record, i) => {
    const step = plan[i];
    const back = stored.get(step.to);
    if (!back || definitionKey(back) !== definitionKey(record)) result.unstored.push(record);
    else if (step.from === step.to) result.added.push(step.to);
    else result.renamed.push(step);
  });
  return result;
}

const quoted = (names: readonly string[]): string => names.map((n) => `"${n}"`).join(", ");

/** One clause per rule-3 cause, so the toast never claims "yours was kept"
 *  when there was no model of yours under that name. */
function renamedClauses(renamed: readonly Renamed[]): string[] {
  const clauses: string[] = [];
  const of = (reason: RenameReason): Renamed[] => renamed.filter((r) => r.reason === reason);
  const as = (list: readonly Renamed[]): string => list.map(({ from, to }) => `"${from}" as "${to}"`).join(", ");
  const local = of("local");
  if (local.length) {
    const one = local.length === 1;
    clauses.push(
      `${one ? "1 fit model differs" : `${local.length} fit models differ`} from the one saved here under the same name; yours ${one ? "was" : "were"} kept and the project's added as ${as(local)}`,
    );
  }
  const unreadable = of("unreadable");
  if (unreadable.length) {
    const one = unreadable.length === 1;
    clauses.push(
      `${one ? "1 fit model's name is" : `${unreadable.length} fit models' names are`} held by a saved model here that this build cannot read (left untouched); the project's ${one ? "was" : "were"} added as ${as(unreadable)}`,
    );
  }
  const project = of("project");
  if (project.length) {
    clauses.push(
      `the project holds different fit models under the same name; the later ${project.length === 1 ? "one was" : "ones were"} added as ${as(project)}`,
    );
  }
  return clauses;
}

/** The ONE message an open shows for a merge, or null when the project brought
 *  nothing new (the common reopen). `kept` says whether the refused records
 *  actually reached the carry — false when another load or an undo replaced
 *  the project before the merge landed, and the message must not claim it. */
export function adoptionMessage(
  { added, renamed, unstored, libraryDamaged }: AdoptResult,
  kept = true,
): string | null {
  const parts: string[] = [];
  if (added.length) {
    parts.push(
      `added ${added.length === 1 ? "1 fit model" : `${added.length} fit models`} from the project to your library: ${quoted(added)}`,
    );
  }
  parts.push(...renamedClauses(renamed));
  if (unstored.length) {
    const where = kept
      ? "kept in the project"
      : "the project was replaced before it could be kept — it is still in the project file; reopen that file to try again";
    parts.push(
      libraryDamaged
        ? `your saved fit model list could not be read, so the project's ${quoted(unstored.map((m) => m.name))} ${unstored.length === 1 ? "was" : "were"} not added to it and the list was left untouched; ${where}`
        : `${quoted(unstored.map((m) => m.name))} could not be saved to your library (browser storage refused it); ${where}`,
    );
  }
  return parts.length ? parts.join(". ") : null;
}

/** What the store's load/append runs after its own `set()`
 *  (store/workspaceHydration.ts's `adoptFitModels`, which already put this
 *  file's carry in place): merge the project's accepted models into the
 *  library and toast once. An open panel listing the library re-reads on its
 *  own (lib/fitmodels.ts's `subscribeCustomModels`). `carry` hands the
 *  records the library did not take back to the store, which adds them to the
 *  project's carry — if it is still that project's (see
 *  store/recipeFidelity.ts's `carryGrewFrom`) — and says whether it did. */
export function adoptProjectFitModels(
  ws: { projectFitModels?: readonly CustomFitModel[] },
  carry: (unstored: readonly CustomFitModel[]) => boolean,
): void {
  const result = mergeProjectFitModels(ws.projectFitModels ?? []);
  const kept = result.unstored.length > 0 && carry(result.unstored);
  const msg = adoptionMessage(result, kept);
  if (msg) toast(msg, result.unstored.length ? "danger" : "info");
}
