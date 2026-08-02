// /api/reference/* wrappers beyond convertUnits (which stays in lib/api.ts
// alongside getConstants/getElements). Extracted to a sibling module (the
// lib/api/stats.ts pattern) so the DiraCulator units-converter expansion
// doesn't push the pinned lib/api.ts over its size-ratchet ceiling.
//
// NOT re-exported by `lib/api.ts` (unlike stats/plot/exportMultivar) --
// lib/api.ts is at its pin with zero headroom, so even a one-line
// `export * from "./api/reference"` would fail the ratchet. Its one
// consumer (useCalculators.ts) imports directly from this path instead.

import { getJSON } from "./http";

/** One option in a units-converter category (DiraCulator Units tab). */
export interface UnitOption {
  value: string;
  label: string;
}

/** A curated group of interconvertible units (or a documented near-miss
 *  family, e.g. photon/thermal energy) for the category -> from/to picker. */
export interface UnitCategoryDef {
  id: string;
  label: string;
  hint: string | null;
  units: UnitOption[];
}

/** Curated category -> unit table backing the Units tab's pickers. The
 *  conversion math stays in `convertUnits` / calc.unit_convert; this is only
 *  the UI-curation index (single source of truth, driven from the backend). */
export function getUnitCategories(): Promise<{ categories: UnitCategoryDef[] }> {
  return getJSON("/api/reference/unit-categories");
}
