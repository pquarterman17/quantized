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
// records the open project carried that this build could not read (below).
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
// WHAT AN OPEN DOES — the merge rule, applied per incoming record, in file
// order, against the library as it stands at that moment:
//   1. A local model with the same name AND identical content: nothing.
//   2. The name is free locally (no readable or unreadable record holds it):
//      the model is added under its own name.
//   3. Otherwise (same name, different content — or the name belongs to a
//      local record this build cannot read): the local one is NEVER touched.
//      If a model with identical content already sits under one of the
//      suffixed names below, nothing (so reopening the same project does not
//      pile up copies); else the incoming one is added as
//      "<name> (from project)", then "(from project 2)", "(from project 3)",
//      ... — the first name nothing holds.
// One toast per open names what was added and what was renamed. Adding to
// the library is not undoable, exactly like saving a model from the fit
// workshop: the library is not project state.
//
// UNREADABLE RECORDS IN THE FILE (a newer build's version, a damaged entry, or
// a field that is not an array at all) are skipped with a migration warning
// and NEVER destroyed: they ride in the store (`fitModelCarry`) and are
// written back into the file on the next save — the same "rewrite around it"
// rule lib/fitmodels.ts applies to its own slot. They also make the Recipe
// Library's `recipeSourcesComplete` false for the session, because a model
// the project holds is then not represented in the collection.

import {
  isCustomFitModel,
  loadCustomModels,
  saveCustomModel,
  unreadableCustomModelNames,
  type CustomFitModel,
} from "./fitmodels";
import { toast } from "../store/toasts";

/** The file's `customFitModels` field, split into what this build can read and
 *  what it must carry untouched. `undefined` (the key absent — every pre-P2.7
 *  project) is an empty, whole source. A present non-array is carried as ONE
 *  unreadable record, so even a malformed field survives the next save. */
export function splitProjectFitModels(
  raw: unknown,
  migrationWarnings: string[],
): { models: CustomFitModel[]; carry: unknown[] } {
  if (raw === undefined) return { models: [], carry: [] };
  const list = Array.isArray(raw) ? raw : [raw];
  const models: CustomFitModel[] = [];
  const carry: unknown[] = [];
  for (const r of list) (isCustomFitModel(r) ? models : carry).push(r as CustomFitModel);
  if (carry.length > 0) {
    const names = carry
      .map((r) => (typeof r === "object" && r !== null ? (r as { name?: unknown }).name : undefined))
      .filter((n): n is string => typeof n === "string" && n !== "");
    const what = carry.length === 1 ? "1 saved fit model" : `${carry.length} saved fit models`;
    const which = names.length ? ` (${names.map((n) => `"${n}"`).join(", ")})` : "";
    migrationWarnings.push(
      `${what} in this project could not be read by this build and ${carry.length === 1 ? "was" : "were"} skipped${which}; kept in the project file`,
    );
  }
  return { models, carry };
}

/** The records a save writes: the local library's readable models, then the
 *  carried unreadable records (exact duplicates dropped — an append of the
 *  same project twice must not double them). Reads localStorage; a storage
 *  failure reads as an empty library, exactly as `loadCustomModels` does. */
export function projectFitModelsForSave(
  models: readonly CustomFitModel[] | undefined,
  carry: readonly unknown[] | undefined,
): unknown[] {
  const out: unknown[] = [...(models ?? loadCustomModels())];
  const seen = new Set<string>();
  for (const r of carry ?? []) {
    const key = JSON.stringify(r) ?? "undefined";
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Everything but the name, in a fixed order: two records are the SAME model
 *  exactly when these agree. A missing optional field and an empty one are
 *  different records on disk but the same model, so both normalise here. */
function contentKey(m: CustomFitModel): string {
  return JSON.stringify([
    m.version,
    m.equation,
    m.params,
    m.guesses,
    m.lower,
    m.upper,
    m.description ?? "",
    m.units ?? [],
  ]);
}

export const FROM_PROJECT_SUFFIX = " (from project)";

function suffixed(name: string, n: number): string {
  return n === 1 ? `${name}${FROM_PROJECT_SUFFIX}` : `${name} (from project ${n})`;
}

export interface AdoptResult {
  /** Names added to the library under their own name (rule 2). */
  added: string[];
  /** Rule 3: `[incoming name, name it was added under]`. */
  renamed: [string, string][];
}

/** Merge a project's readable models into the local library under the rule in
 *  this module's header. Never overwrites or deletes a local record. */
export function mergeProjectFitModels(incoming: readonly CustomFitModel[]): AdoptResult {
  const result: AdoptResult = { added: [], renamed: [] };
  if (incoming.length === 0) return result;
  const local = new Map(loadCustomModels().map((m) => [m.name, m]));
  const taken = new Set([...local.keys(), ...unreadableCustomModelNames()]);
  for (const m of incoming) {
    const key = contentKey(m);
    const same = local.get(m.name);
    if (same && contentKey(same) === key) continue; // rule 1
    let name = m.name;
    if (taken.has(name)) {
      // Rule 3: already imported under a suffixed name by an earlier open?
      let n = 1;
      let dup = false;
      for (; taken.has(suffixed(m.name, n)); n++) {
        const held = local.get(suffixed(m.name, n));
        if (held && contentKey(held) === key) {
          dup = true;
          break;
        }
      }
      if (dup) continue;
      name = suffixed(m.name, n);
    }
    const record: CustomFitModel = { ...m, name };
    try {
      saveCustomModel(record);
    } catch {
      continue; // the name turned out to be held by an unreadable record
    }
    local.set(name, record);
    taken.add(name);
    if (name === m.name) result.added.push(name);
    else result.renamed.push([m.name, name]);
  }
  return result;
}

const quoted = (names: readonly string[]): string => names.map((n) => `"${n}"`).join(", ");

/** The ONE message an open shows for a merge, or null when the project brought
 *  nothing new (the common reopen). */
export function adoptionMessage({ added, renamed }: AdoptResult): string | null {
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
  return parts.length ? parts.join(". ") : null;
}

/** The slice of the store's `set` this module writes through. */
type CarrySet = (
  fn: (s: { fitModelCarry: unknown[]; recipeSourcesComplete: boolean }) => {
    fitModelCarry: unknown[];
    recipeSourcesComplete: boolean;
  },
) => void;

/** What the store's load/append runs after its own `set()`
 *  (store/workspaceHydration.ts): merge the project's readable models into
 *  the library and toast once. On an APPEND it also adds the appended file's
 *  unreadable records to the carry, which un-certifies the Recipe Library
 *  exactly as a load of that file would (a LOAD set the carry itself,
 *  synchronously, since it REPLACES it). When the merge wrote anything, the
 *  carry is re-set to a fresh array so a subscriber re-renders: the library
 *  is localStorage, which nothing can subscribe to, and an OPEN Recipe
 *  Library panel (which subscribes to `fitModelCarry` for this) would
 *  otherwise keep listing the pre-merge models. */
export function adoptProjectFitModels(
  ws: { customFitModels?: readonly CustomFitModel[]; fitModelCarry?: readonly unknown[] },
  set: CarrySet,
  append?: boolean,
): void {
  const carry = append ? (ws.fitModelCarry ?? []) : [];
  const result = mergeProjectFitModels(ws.customFitModels ?? []);
  if (carry.length || result.added.length || result.renamed.length) {
    set((s) => ({
      fitModelCarry: [...s.fitModelCarry, ...carry],
      recipeSourcesComplete: s.recipeSourcesComplete && carry.length === 0,
    }));
  }
  const msg = adoptionMessage(result);
  if (msg) toast(msg, "info");
}
