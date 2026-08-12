// Pure error-binding canonical-draft helpers (F2.3f): patch/remove one
// binding by its array index and append a new one -- the same shape as
// canonicalRefLines.ts's list helpers. No React/store import -- unit-testable
// standalone.
//
// Unlike RefLine/Shape, an ErrorBinding carries no `id` (see errorRoles.ts's
// module doc). `Inspector/ErrorRolesCard.tsx`, the Stage-side editor of the
// same concept, already keys its own patch/remove by array INDEX rather than
// inventing an identity field, so this module follows the same convention.

import type { ErrorBinding, ErrorSide } from "../../../lib/errorRoles";

/** Merge `patch` into the binding at `index`; every other binding is
 *  returned unchanged (by reference). A no-op array for an out-of-range
 *  index -- callers don't special-case a missing row. Channel is
 *  deliberately excluded: which raw column holds the error VALUES is fixed
 *  once bound (the same "read-only per row" call RefLinePropertiesPanel
 *  makes for a line's axis). */
export function patchErrorBindingList(
  bindings: readonly ErrorBinding[],
  index: number,
  patch: Partial<Omit<ErrorBinding, "channel">>,
): ErrorBinding[] {
  return bindings.map((binding, i) => (i === index ? { ...binding, ...patch } : binding));
}

/** Drop the binding at `index`. No-op (same-length array) for an
 *  out-of-range index. */
export function removeErrorBindingFromList(
  bindings: readonly ErrorBinding[],
  index: number,
): ErrorBinding[] {
  return bindings.filter((_, i) => i !== index);
}

/** Append a new binding. No id to mint (unlike appendRefLine/canonicalShapes'
 *  add) -- see this module's doc for why the array index is the binding's
 *  whole identity. */
export function appendErrorBinding(
  bindings: readonly ErrorBinding[],
  channel: number,
  target: number,
  axis: ErrorBinding["axis"],
  side: ErrorSide,
): ErrorBinding[] {
  return [...bindings, { channel, target, axis, side }];
}
