// /api/reference/* wrappers. getUnitCategories was extracted first (the
// lib/api.ts pin had zero headroom for the DiraCulator units-converter
// expansion); getConstants/getElements/getElement/convertUnits joined it in
// the R8 bundle-diet pass (2026-08-23): all four were still defined directly
// in lib/api.ts, so useApp.ts's unrelated eager imports from that SAME file
// (fftSpectral, fitModel, peaksIntegrate, uploadFile) were dragging this
// lazy-only reference/units data into the eager bundle — the same
// one-file-one-chunk mechanics as the api/stats.ts note below, just via
// co-location in lib/api.ts itself instead of a re-export. See
// `docs/EAGER_BUDGET` in scripts/check-bundle-size.mjs's header for the
// measured deltas.
//
// NOT re-exported by `lib/api.ts` (unlike stats/plot/exportMultivar) --
// lib/api.ts is at its pin with zero headroom, so even a one-line
// `export * from "./api/reference"` would fail the ratchet. Every consumer
// (useCalculators.ts, ConstantsTab.tsx, ElementsTab.tsx, useUnitsCalc.ts)
// imports directly from this path instead.

import { getJSON, postJSON } from "./http";
import type { CalcResult, ElementInfo } from "../types";

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

export function getConstants(): Promise<{
  constants: Record<string, number>;
  systems: Record<
    "SI" | "CGS" | "eV",
    { key: string; name: string; symbol: string; value: number; unit: string }[]
  >;
}> {
  return getJSON("/api/reference/constants");
}

export function getElements(): Promise<{ elements: ElementInfo[] }> {
  return getJSON("/api/reference/elements");
}

export function getElement(symbol: string): Promise<ElementInfo> {
  return getJSON(`/api/reference/elements/${encodeURIComponent(symbol)}`);
}

export function convertUnits(
  value: number | number[],
  from: string,
  to: string,
): Promise<{ result: number | (number | null)[]; info: CalcResult }> {
  return postJSON("/api/reference/convert", { value, from, to });
}
