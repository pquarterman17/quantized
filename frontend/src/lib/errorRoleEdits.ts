// Inspector-only error-role EDITS (figures-audit #10): the Error columns
// card's manual Add rows and the Channels card's per-series "±" written into
// the canonical roles. Kept out of lib/errorRoles.ts, which the eager plot
// path loads, because only the lazy Inspector cards call these.

import type { ErrorBinding } from "./errorRoles";
import type { Dataset } from "./types";

/** The binding(s) a manual "Add" in the Inspector's Error columns card
 *  creates (figures-audit #10): the next column(s), in column order, that
 *  are neither already an error channel nor the series they describe, bound
 *  to the first plotted series (`plotted`, display order) that is not one of
 *  them. `pair` adds an asymmetric "+" then "−" half from the next TWO such
 *  columns. `[]` when not enough columns are free -- the caller says so. */
export function nextManualErrorBindings(
  dataset: Pick<Dataset, "data">,
  roles: readonly ErrorBinding[],
  pair: boolean,
  plotted: readonly number[],
): ErrorBinding[] {
  const n = dataset.data.labels.length;
  const used = new Set(roles.map((r) => r.channel));
  const target = plotted.find((ch) => !used.has(ch)) ?? 0;
  const free: number[] = [];
  for (let ch = 0; ch < n && free.length < (pair ? 2 : 1); ch++) {
    if (!used.has(ch) && ch !== target) free.push(ch);
  }
  if (free.length < (pair ? 2 : 1)) return [];
  return pair
    ? [
        { channel: free[0], target, axis: "y", side: "+" },
        { channel: free[1], target, axis: "y", side: "-" },
      ]
    : [{ channel: free[0], target, axis: "y", side: "both" }];
}

/** `roles` with `target`'s symmetric vertical error replaced by `channel`
 *  (null = removed) -- the Channels card's per-series "±" pick written into
 *  the canonical roles, so that card and the Error columns card can never
 *  show two different answers for the same series (figures-audit #10).
 *  Asymmetric halves and X errors are left alone. */
export function withSymmetricYError(roles: readonly ErrorBinding[], target: number, channel: number | null): ErrorBinding[] {
  const kept = roles.filter((r) => !(r.target === target && r.axis === "y" && r.side === "both"));
  return channel === null ? kept : [...kept, { channel, target, axis: "y", side: "both" }];
}
