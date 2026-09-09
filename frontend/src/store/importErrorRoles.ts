// Which error-column roles a freshly imported dataset gets, and from where.
//
// Extracted from importDatasets.ts (which had reached the 500-line module
// ceiling) because the three sources form one cohesive decision with a
// PRECEDENCE that was previously only implicit in an inline `??` chain. Naming
// it makes the ranking reviewable, and gives the ordering one place to be
// documented and tested.
//
// The order, most authoritative first:
//   1. Origin's own column designations (`lib/originBookRoles`) — the file
//      stating a column IS a Y-error. Never overridden by a guess.
//   2. A PARSER's declaration for its own format
//      (`DataStruct.metadata["error_roles"]`) — the parser knows the layout;
//      see `quantized.io.ncnr`'s reductus triple (BUGS_AND_ISSUES BUG-001).
//   3. The label guesser (`lib/errorRoles.inferErrorBindings`) — spelling
//      conventions only, and only where the pairing is defensible.
// Nothing inferable at all yields NO key, so an ordinary numeric file carries
// no empty role list (the `[]` value is meaningful — see originBookRoles' O1).

import { inferErrorBindings, type ErrorBinding } from "../lib/errorRoles";
import { originBookErrorRoles } from "../lib/originBookRoles";
import type { DataStruct } from "../lib/types";

/** Roles a PARSER declared for its own format, via
 *  `DataStruct.metadata["error_roles"]` (the contract
 *  `quantized.io.import_error_bindings.binding_metadata` writes, and which
 *  `io/ncnr.py` uses for the reductus measured/uncertainty/resolution triple).
 *
 *  This is the reader that side of the contract was missing: the key was
 *  written and documented as backend-only, so a parser that knew an error
 *  column's role could not get bars onto a plot (BUGS_AND_ISSUES BUG-001).
 *
 *  It outranks `importRoles`'s label guess — a parser knows its format, the
 *  guesser only knows spellings — but is still ranked BELOW Origin's own
 *  column designations, which are the file's explicit statement of role.
 *
 *  The metadata comes from a parsed FILE, so every entry is validated rather
 *  than trusted: non-integer indices, out-of-range channels, a channel that is
 *  its own target, and unknown axis/side values are dropped. Returns `null`
 *  (not `{}`) when nothing survives, so the `??` chain falls through to the
 *  guesser exactly as it did before — an unrecognised or malformed hint must
 *  not silently suppress inference. */
function parserErrorRoles(data: DataStruct): { errorRoles: ErrorBinding[] } | null {
  const raw = (data.metadata ?? {})["error_roles"];
  if (!Array.isArray(raw)) return null;
  const n = data.labels?.length ?? 0;
  const chan = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n;
  const roles = (raw as Record<string, unknown>[])
    .filter(
      (r) =>
        !!r &&
        typeof r === "object" &&
        chan(r.channel) &&
        (r.target === -1 || chan(r.target)) &&
        r.target !== r.channel && // a column cannot be its own error
        (r.axis === "x" || r.axis === "y") &&
        (r.side === "both" || r.side === "+" || r.side === "-"),
    )
    // Constructed explicitly, never passed through: the metadata object may
    // carry extra keys, and those would otherwise be stored on the dataset and
    // serialized into the `.dwk`.
    .map((r) => ({
      channel: r.channel as number,
      target: r.target as number,
      axis: r.axis as ErrorBinding["axis"],
      side: r.side as ErrorBinding["side"],
    }));
  return roles.length ? { errorRoles: roles } : null;
}

/** Seed the canonical error-column roles from the parsed labels (MAIN #33).
 *
 *  Inference SUGGESTS — it only binds where the pairing is unambiguous or
 *  follows the instrument convention, and everything stays overridable. Omitted
 *  entirely when nothing is inferable, so an ordinary two-column file carries
 *  no empty role list. */
function importRoles(data: DataStruct): { errorRoles?: ErrorBinding[] } {
  const roles = inferErrorBindings(data);
  return roles.length ? { errorRoles: roles } : {};
}

/** The seeded roles for a newly imported dataset, by the precedence documented
 *  at the top of this module. Spread into the `Dataset` under construction. */
export function seedErrorRoles(data: DataStruct): { errorRoles?: ErrorBinding[] } {
  return originBookErrorRoles(data) ?? parserErrorRoles(data) ?? importRoles(data);
}
