// The untrusted-input half of lib/errorRoles.ts (bundle diet slice 32): the
// binding validator and the "declared, not guessed" test built on it. Only lazy
// chunks (the `.dwk` parse, the import filters, the confidence grading) call
// them, so they ship with those; lib/errorRoles.ts re-exports them with
// `export *`.

import { columnMetaList } from "./columnmeta";
import type { ErrorBinding } from "./errorRoles";
import type { DataStruct } from "./types";

/** Is this pairing DECLARED rather than guessed? Either the file's Origin
 *  column designations (the whole book -- exactly when `originBookErrorRoles`
 *  is non-null), or the pairing is listed in `metadata.error_roles`: the P1.6
 *  contract a parser / import filter writes, which a user's confirmation
 *  extends (lib/errorRoleConfirm.ts), so it survives `.dwk`. Declared pairings
 *  outrank the confidence grade (lib/errorBindingConfidence.ts). Matched by
 *  channel and target. */
export function isDeclaredBinding(data: DataStruct, b: ErrorBinding): boolean {
  return (
    columnMetaList(data).some((c) => c?.designation !== undefined) ||
    !!sanitizeBindings(data.metadata?.["error_roles"], data.labels.length)?.some(
      (d) => d.channel === b.channel && d.target === b.target,
    )
  );
}

/** Validate bindings from any UNTRUSTED slot — a `.dwk`/template being read
 *  back, or a parser's `DataStruct.metadata["error_roles"]` declaration
 *  (`store/importErrorRoles.ts`). THE one validator for the shape, so the two
 *  entry points cannot drift: a review of the parser-declared path found it had
 *  grown a second, stricter copy of these rules, which meant a self-targeting
 *  binding was rejected on import but accepted on reload.
 *
 *  Drops anything referencing a channel the dataset no longer has, which is
 *  what keeps a reapplied template from binding error bars to the wrong column
 *  after the source's shape changed. Also drops, per that review:
 *   - NON-INTEGER indices. A channel is an array position; `1.5` cannot name
 *     one, and `values[1.5]` is `undefined` rather than an error.
 *   - a binding whose `target` IS its own `channel` — that would draw a
 *     channel's whiskers from its own values, which is never what any slot
 *     means, and is silently wrong rather than visibly broken. */
export function sanitizeBindings(
  raw: unknown,
  channelCount: number,
): ErrorBinding[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ErrorBinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Partial<ErrorBinding>;
    if (!Number.isInteger(b.channel) || !Number.isInteger(b.target)) continue;
    if (b.channel! < 0 || b.channel! >= channelCount) continue;
    if (b.target! < -1 || b.target! >= channelCount) continue;
    if (b.target === b.channel) continue;
    if (b.axis !== "x" && b.axis !== "y") continue;
    if (b.side !== "both" && b.side !== "+" && b.side !== "-") continue;
    out.push({ channel: b.channel!, target: b.target!, axis: b.axis, side: b.side });
  }
  return out;
}
