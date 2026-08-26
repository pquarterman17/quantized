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
// Q2 (documentation, round 6; updated after PR #238): the bare-`d`
// misclassification described above (`classifyErrorLabel` reading a
// "Depth"-style column as an error series) has since been fixed by a
// structural rewrite of the classifier -- see
// plans/ERROR_LABEL_CLASSIFIER_PLAN.md -- so this module is no longer a
// workaround for a broken guesser. It stays anyway: an Origin book's
// `column_designations` is ground truth recorded by the instrument
// software, not an inference from a column's name, so it is preferred on
// principle even against a now-correct classifier -- a renamed, ambiguous,
// or non-English column label can still defeat any name-based rule, and
// designations simply cannot be fooled that way. `originBookErrorRoles`
// never calls into `./errorRoles.ts`/`./errorLabelClassify.ts` at all, so
// its own behaviour did not change with the rewrite (re-verified by this
// module's own `originBookRoles.test.ts`, unmodified and still green);
// what changed is only that the label-guess FALLBACK a caller takes when
// this module returns `null` (no usable designation info) is now itself
// correct on Depth/Kerr/Phase-style names, for the genuinely-non-Origin
// case this module was never meant to cover.

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
  // Round 7 (adversarial review, BLOCKER 1): `list.length === 0` alone is
  // NOT "no usable designation info" -- `columnMetaList` returns one entry
  // per name whenever `origin_column_names` is an array, with `designation:
  // undefined` on every one when `column_designations` is merely empty
  // (io/origin_project/opj.py:257 sets it to `{}` for every sheet-2+
  // pseudo-book: `col_meta = books_meta[base_book].columns if base_book in
  // books_meta and not sheet_no else {}`). That book's column NAMES are
  // real, but Origin told us NOTHING about which are error columns -- the
  // "no usable designation info at all" case this function's own doc
  // promises `null` for. Falling through to the loop on that input matches
  // no designation and returns the AUTHORITATIVE `{ errorRoles: [] }`,
  // which by design (O1) suppresses every downstream label-guess fallback
  // -- silently deleting an R/dR pair's error bars. Require at least one
  // entry to actually carry a designation before treating the list as
  // meaningful.
  if (list.length === 0 || list.every((c) => c?.designation === undefined)) return null;

  // L4: when the designated X column could not be decoded, `.time` is a
  // SYNTHETIC row index substituted in its place (io/origin_project/
  // opj.py's `x_column_recovered`), not a real physical quantity — binding
  // an X-error against it would draw whiskers against a row count, so skip
  // it for this book rather than render a meaningless span.
  const skipXError = ds.metadata?.["x_column_recovered"] === false;

  // Round 7 (adversarial review, item 5): unlike Y-error (paired to the
  // NEAREST preceding "Y" — a real channel index the render pipeline can
  // target individually), an X-error binding here is UNCONDITIONALLY
  // `target: -1`, and every consumer treats that as "the plot's ONE shared
  // x axis, apply to every plotted column" — `lib/errorbars.ts`'s
  // `buildErrorSpans` hardcodes `target = axis === "x" ? -1 : ch` when
  // searching bindings (never reads a channel-specific x target) and its
  // own doc says so explicitly ("emitted against every plotted column,
  // since the x uncertainty applies to each point regardless of which
  // series is drawn there"); `lib/plotDecimate.ts`'s eligibility check
  // (`b.axis === "x" ? opts.xErrorRenders : plotted.includes(b.target)`)
  // never even inspects `target` for an x binding either. So there is NO
  // per-channel "nearest preceding X" to give X error the same treatment
  // as Y: whatever channel index we attached, the render pipeline would
  // still draw it against the ONE shared axis regardless.
  //
  // That makes `column_designations`'s own multi-X shape (`lib/errorbars.ts`'s
  // `originHiddenChannels` doc: a Moke-style book storing several hysteresis
  // loops as X,Y,X,Y — only the FIRST X survives as `.time`; every later
  // "X" is a genuine secondary axis column, hidden but present in `.values`)
  // a real hazard rather than a hypothetical one: an "X-error" designated
  // AFTER a secondary "X" is that loop's OWN x uncertainty, not the shared
  // axis's — binding it to `target: -1` would draw the wrong loop's error
  // magnitude as a whisker on every plotted series' shared abscissa. Since
  // the pipeline cannot express "this error belongs to channel N's own x
  // values" for the x axis at all, the safe answer is NOT a guess in either
  // direction: stop treating "X-error" as the shared axis's error once a
  // secondary "X" has been seen. An "X-error" that precedes any secondary
  // "X" is unambiguous (nothing else has claimed to be an X yet) and keeps
  // binding to the shared axis exactly as before.
  const roles: ErrorBinding[] = [];
  let lastY: number | null = null;
  let sawSecondaryX = false;
  for (let i = 0; i < list.length; i++) {
    const designation = list[i]?.designation;
    if (designation === "Y") {
      lastY = i;
    } else if (designation === "X") {
      sawSecondaryX = true;
    } else if (designation === "Y-error" && lastY !== null) {
      roles.push({ channel: i, target: lastY, axis: "y", side: "both" });
    } else if (designation === "X-error" && !skipXError && !sawSecondaryX) {
      roles.push({ channel: i, target: -1, axis: "x", side: "both" });
    }
  }
  return { errorRoles: roles }; // possibly [] -- see the O1 note above
}
