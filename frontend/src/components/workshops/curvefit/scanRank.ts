// Rank all models: the pure parts of the ranking table -- which row is the
// best, and how the columns sort. The backend already orders by AICc
// (successes ascending, failures last); sorting here only re-orders what it
// returned. A failed candidate is always last whatever the key: it has no
// number to sort on, and it must stay visible.

import type { ScanEntry } from "../../../lib/api/curvefit";

export type ScanSortKey = "k" | "chiSqRed" | "adjR2" | "AIC" | "AICc" | "BIC";
export interface ScanSort {
  key: ScanSortKey;
  dir: "asc" | "desc";
}

/** A better fit has a LOWER information criterion, a smaller reduced chi^2 and
 *  fewer parameters, but a HIGHER adjusted R^2: the first click on a column puts
 *  the best row first. */
export const FIRST_DIR: Record<ScanSortKey, "asc" | "desc"> = {
  k: "asc", chiSqRed: "asc", adjR2: "desc", AIC: "asc", AICc: "asc", BIC: "asc",
};

export const entryKey = (e: ScanEntry): string => `${e.kind}:${e.name}`;

/** The best model: the first converged row of the backend's ranking (ascending
 *  AICc). Read from the backend order, not the displayed one: a perfect fit has
 *  AICc -inf, which reaches the wire as null and cannot be compared here. A fit
 *  the optimiser flagged unconverged is listed but never recommended. */
export function bestEntry(results: readonly ScanEntry[]): ScanEntry | null {
  return results.find((e) => e.error === null && e.converged === true) ?? null;
}

/** `results` ordered by `sort` (null = as the backend ranked them). Rows with
 *  no value for the key (NaN or null, e.g. an exactly determined fit) and failed
 *  candidates go last, in their original order. */
export function sortScan(results: readonly ScanEntry[], sort: ScanSort | null): ScanEntry[] {
  if (sort === null) return [...results];
  const sign = sort.dir === "asc" ? 1 : -1;
  const val = (e: ScanEntry): number | null => {
    if (e.error !== null) return null;
    const v = sort.key === "k" ? e.k : e[sort.key];
    return v === null || Number.isNaN(v) ? null : v;
  };
  return results
    .map((e, i) => ({ e, i, v: val(e) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
      return a.v === b.v ? a.i - b.i : sign * (a.v - b.v);
    })
    .map((r) => r.e);
}
