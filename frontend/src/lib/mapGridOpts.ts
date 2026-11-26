// The 2-D map card's opt-in gridding options for the modified Shepard and
// kriging methods (the same options as the Map gridding workshop, and the same
// request fields as /api/map-ops/grid). Nothing set = the route's own defaults,
// so a map that never touches them is fetched exactly as before.
//
// Session state, like `mapMethod` (nothing here is written to the project). It
// is a small external store rather than a field of the eager app store: only
// the lazily loaded map stage and map card read it, and a store field would
// have put its slot, setter and pinned test keys in the startup chunk.

import { useSyncExternalStore } from "react";

import type { Variogram } from "./api/mapGrid";
import type { MapRequest } from "./api/plot";

export interface MapGridOpts {
  /** Shepard weight neighbours, 3..200 (route default 19). */
  shepNeighbors?: number;
  /** Shepard radius as a fraction of the data extent, (0, 2]; absent = adaptive. */
  shepRadius?: number;
  /** Shepard quadratic nodal functions (route default true). */
  shepQuadratic?: boolean;
  variogram?: Variogram;
  /** Kriging neighbours, 4..200 (route default 32). */
  krigeNeighbors?: number;
}

export const SHEP_NEIGHBORS_RANGE: readonly [number, number] = [3, 200];
export const KRIGE_NEIGHBORS_RANGE: readonly [number, number] = [4, 200];

const EMPTY: MapGridOpts = {};
let current: MapGridOpts = EMPTY;
const listeners = new Set<() => void>();

export const getMapGridOpts = (): MapGridOpts => current;

/** Merge `patch` in; a key set to `undefined` goes back to the route's default. */
export function setMapGridOpts(patch: Partial<Record<keyof MapGridOpts, MapGridOpts[keyof MapGridOpts]>>): void {
  const next: Record<string, unknown> = { ...current, ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  current = Object.keys(next).length === 0 ? EMPTY : (next as MapGridOpts);
  listeners.forEach((l) => l());
}

export function useMapGridOpts(): MapGridOpts {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    getMapGridOpts,
  );
}

/** The `/api/plot/map` fields for `method`'s own options only: another
 *  method's leftovers are never sent (the route refuses them). */
export function gridRequestFields(method: string, o: MapGridOpts): Partial<MapRequest> {
  const out: Partial<MapRequest> = {};
  if (method === "shepard") {
    if (o.shepNeighbors !== undefined) out.shepard_neighbors = o.shepNeighbors;
    if (o.shepRadius !== undefined) out.shepard_radius = o.shepRadius;
    if (o.shepQuadratic !== undefined) out.shepard_quadratic = o.shepQuadratic;
  } else if (method === "kriging") {
    if (o.variogram !== undefined) out.variogram = o.variogram;
    if (o.krigeNeighbors !== undefined) out.krige_neighbors = o.krigeNeighbors;
  }
  return out;
}

/** A whole number within `range`, or null (blank and out-of-range both null). */
export function parseWhole(text: string, range: readonly [number, number]): number | null {
  const v = Number(text);
  return text.trim() !== "" && Number.isInteger(v) && v >= range[0] && v <= range[1] ? v : null;
}

/** A Shepard radius in (0, 2], or null. */
export function parseRadius(text: string): number | null {
  const v = Number(text);
  return text.trim() !== "" && v > 0 && v <= 2 ? v : null;
}
