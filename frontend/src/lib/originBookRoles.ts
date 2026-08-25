// FU-1 round 2 (E1, provenance-disclosure follow-ups): error-role inference
// for ONE Origin book, sourced ONLY from that book's own authoritative
// column designations — never the label-name guesser in ./errorRoles.
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
// Origin already KNOWS which columns are errors — `io/origin_project/
// opj.py`'s `_build_book` puts `column_designations` (short column name ->
// Origin's own "Y-error"/"X-error"/"Y"/"X"/"Z"/"label"/"disregard") and
// `origin_column_names` (that book's value channels, in the SAME order as
// `.labels`/`.values`) into every book's metadata. Verified this reaches the
// frontend unmodified for every `books[]` shape (primary marker, lazy
// preview, and the `full_books=true` full-inline escape hatch):
// `routes/parsers.py`'s `_slim_metadata` strips only `origin_books`, and
// `datastruct_payload` strips nothing from `.metadata` at all.
//
// So for an Origin book, designations are the ONLY role source — this
// module never falls back to the label guesser. No usable designation info
// on a book (the metadata shape is missing or doesn't line up) means NO
// roles for that book, not a guess.

import type { ErrorBinding } from "./errorRoles";

/** Origin's own column designation is authoritative — there is no
 *  richer link between an error column and the value column it belongs to
 *  in `column_designations` itself (a flat short-name -> designation map,
 *  no linkage field), so pairing uses the same "nearest preceding" rule
 *  `errorRoles.ts`'s label-based inference already applies. Origin errors
 *  are single-column (not split +/-), so every binding is `side: "both"`. */
export function originBookErrorRoles(
  metadata: Record<string, unknown>,
  labels: readonly string[],
): { errorRoles?: ErrorBinding[] } {
  const designations = metadata.column_designations;
  const columnNames = metadata.origin_column_names;
  if (
    designations == null ||
    typeof designations !== "object" ||
    !Array.isArray(columnNames) ||
    columnNames.length !== labels.length
  ) {
    return {};
  }
  const map = designations as Record<string, string>;
  const desig = columnNames.map((c) => map[String(c)]);
  const roles: ErrorBinding[] = [];
  for (let ch = 0; ch < desig.length; ch++) {
    if (desig[ch] === "X-error") {
      roles.push({ channel: ch, target: -1, axis: "x", side: "both" });
    } else if (desig[ch] === "Y-error") {
      const target = desig.slice(0, ch).lastIndexOf("Y");
      if (target >= 0) roles.push({ channel: ch, target, axis: "y", side: "both" });
    }
  }
  return roles.length ? { errorRoles: roles } : {};
}
