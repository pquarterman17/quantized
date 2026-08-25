// FU-1 (E1, provenance-disclosure follow-ups): error-role inference for ONE
// Origin book, sourced ONLY from that book's own authoritative column
// designations — never the label-name guesser in ./errorRoles.
//
// `errorRoles.ts`'s `inferErrorBindings`/`classifyErrorLabel` reads column
// NAMES and guesses ("dR" -> an error column for "R"). Run over an Origin
// book, that guess is actively harmful: `classifyErrorLabel`'s bare-`d`
// rule reads a genuine "Depth" measurement column as an error series
// (confirmed: `inferErrorBindingsFromLabels(["Refl","Depth","Refl_err"])`
// binds BOTH channel 1 "Depth" AND channel 2 "Refl_err" as Y-error for
// channel 0). Depth-profile/SIMS data is core to this repo, so this is not
// hypothetical — and downstream, a wrong guessed binding wins over the
// designation-derived one at render time, suppressing Origin's own real
// error bar and disabling its server-side decimation.
//
// Round 3 (L3): the short-name -> designation alignment is NOT re-derived
// here. `lib/columnmeta.ts` declares itself the one shared reader of
// `metadata.column_designations` + `metadata.origin_column_names` ("every
// consumer reads the SAME alignment and can never drift apart") — this
// module reads through `columnMetaList` exactly like `lib/errorbars.ts`'s
// `originErrKeys` does, rather than re-parsing the raw metadata maps. That
// also means this module inherits columnmeta's tolerant behaviour (a short
// `origin_column_names` list is fine — extra label channels past it simply
// have no designation) instead of the stricter length-equality bail this
// module used to apply on its own.
//
// No usable designation info on a book (columnmeta finds no
// `origin_column_names` array at all) means NO roles for that book, not a
// guess — signalled by returning `null` rather than `{ errorRoles: [] }`, so
// a caller that wants to fall back to the label guesser for a genuinely
// non-Origin payload can tell "nothing to say" apart from "said: no error
// columns here".
//
// Round 5 (O1): that second state -- designations WERE read and produced
// zero error columns -- is stamped as `{ errorRoles: [] }`, not `{}`.
// Several OTHER call sites across the codebase (lib/quickFigureMappingActions.ts,
// lib/quickPlotTemplates.ts x2, lib/plotRecipe.ts, lib/plotRecipeMatch.ts --
// none owned by this module) read `dataset.errorRoles ?? inferErrorBindings(
// dataset.data)`: omitting the field left THEM unable to tell "never
// determined" from "determined: none", so they re-ran the label guesser --
// and its Depth-misclassification bug -- on exactly the Origin datasets this
// module exists to protect. `[]` is not nullish, so every `??` consumer
// above stops falling back with NO change on their side, and every
// `!!errorRoles?.length`/`.length` check this codebase already uses
// (ErrorRolesCard, decimation, `hasRichErrorBindings`, `errKeysFromBindings`)
// still reads it as "no errors" exactly like `undefined` did. Preserved
// through a `.dwk` round trip too -- lib/workspace.ts's `serializeWorkspace`
// and lib/workspaceDatasetParse.ts's `parseWorkspaceDataset` both special-
// case `errorRoles` to keep an explicit `[]` distinct from an absent field
// (every other optional Dataset array field there still omits when empty).
//
// Q2 (documentation, round 6): this whole module -- reading designations
// instead of guessing, AND the `[]` marker above -- is a workaround for a
// broken classifier, not a fix to it. The real bug is
// `classifyErrorLabel`'s bare-`d` rule (./errorRoles.ts) misreading a
// "Depth"-style column as an error series; that misclassification is
// booked separately as its own fix (it also affects non-Origin, single-book
// imports on the label-guess path, which nothing here changes). Once THAT
// is fixed, this module's reason for existing narrows to "Origin's own
// designations are more authoritative than a name guess", which is still
// worth keeping, but the guesser-avoidance urgency goes away.

import { columnMetaList } from "./columnmeta";
import type { ErrorBinding } from "./errorRoles";
import type { DataStruct } from "./types";

/** Origin's own column designation is authoritative — there is no richer
 *  link between an error column and the value column it belongs to in
 *  `column_designations` itself (a flat short-name -> designation map, no
 *  linkage field), so pairing uses the same "nearest preceding Y" rule
 *  `lib/errorbars.ts`'s `originErrKeys` already applies for the legacy
 *  `errKeys` shape. Origin errors are single-column (not split +/-), so
 *  every binding is `side: "both"`.
 *
 *  Returns `null` when the payload carries no usable designation info at
 *  all (a genuinely non-Origin file) — the caller's cue to fall back to the
 *  label guesser instead. Returns `{ errorRoles: [] }` (round 5: NOT `{}`
 *  — see the module doc's O1 note) when designations exist but none is an
 *  error column — that is Origin's own answer, never a guess, and it must
 *  survive as a distinguishable value so a `?? inferErrorBindings(...)`
 *  reader elsewhere never mistakes it for "not yet determined". */
export function originBookErrorRoles(
  ds: Pick<DataStruct, "metadata">,
): { errorRoles: ErrorBinding[] } | null {
  const list = columnMetaList(ds);
  if (list.length === 0) return null;

  // L4: when the designated X column could not be decoded, `.time` is a
  // SYNTHETIC row index substituted in its place (io/origin_project/
  // opj.py's `x_column_recovered`), not a real physical quantity — binding
  // an X-error against it would draw whiskers against a row count, so skip
  // it for this book rather than render a meaningless span.
  const skipXError = ds.metadata?.["x_column_recovered"] === false;

  const roles: ErrorBinding[] = [];
  let lastY: number | null = null;
  for (let i = 0; i < list.length; i++) {
    const designation = list[i]?.designation;
    if (designation === "Y") {
      lastY = i;
    } else if (designation === "Y-error" && lastY !== null) {
      roles.push({ channel: i, target: lastY, axis: "y", side: "both" });
    } else if (designation === "X-error" && !skipXError) {
      roles.push({ channel: i, target: -1, axis: "x", side: "both" });
    }
  }
  return { errorRoles: roles }; // possibly [] -- see the O1 note above
}
