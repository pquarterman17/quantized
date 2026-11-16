// Map/RSM capability checks — the two predicates needed EAGERLY at import
// time to route/gate the Map tab (lib/quickPlot.ts, lib/plotSelectedTogether.ts,
// lib/stagetab.ts, components/Stage/Stage.tsx).
//
// SCOPE (narrowed 2026-08-23, C2 bundle pass): the actual heatmap-grid
// fetch/regrid + RSM axis-key helpers (`fetchMap`/`buildMapColumns`/
// `regridNearest`/`hasQSpace`/`rsmAxisKeys`/`MapPayload`) now live in
// `lib/mapdataFetch.ts`, reached only from `MapStage` and its ROI/sector-wedge
// helpers — all already behind `MapStage`'s own `lazy()` boundary, never the
// eager tab-routing path. See that file's own header for the
// verified-no-eager-consumer rationale.

import type { DataStruct } from "./types";

/** True when a dataset is a 2-D map (e.g. an XRDML reciprocal-space map): the
 *  parser flagged `metadata.is2D` and it carries the ≥3 channels the map needs
 *  (two axes + intensity). Drives import-time stage routing to the Map tab. */
export function is2DMap(ds: DataStruct): boolean {
  return ds.metadata["is2D"] === true && ds.labels.length >= 3;
}

const gate = new WeakMap<DataStruct, boolean>();
const pending = new WeakMap<DataStruct, Promise<boolean>>();
const listeners = new Set<() => void>();
let version = 0;

/** `useSyncExternalStore` plumbing: re-render when a lazy gate result lands. */
export const subscribeMapGate = (f: () => void): (() => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};
export const mapGateVersion = (): number => version;

/** Cheap synchronous rejections shared by `canRenderMap` / `ensureMapGate`. */
const tooSmall = (d: DataStruct): boolean => d.labels.length + 1 < 3 || d.values.length < 4;

/** True when `canRenderMap(data)` is already its FINAL answer: decided
 *  synchronously (no data, parser-flagged, too small, scattered XYZ) or the
 *  lazy grid gate has classified this DataStruct. False only while the gate
 *  has not run yet -- a "no" from `canRenderMap` then means "not known yet",
 *  and a surface that names availability (the plot-type gallery, the Analysis
 *  Center) must say it is checking rather than call the type unavailable. */
export function mapGateResolved(data: DataStruct | null | undefined): boolean {
  if (!data || data.metadata["is2D"] === true || tooSmall(data) || data.metadata["scatteredXYZ"] === true) return true;
  return gate.has(data);
}

/** Shown while the lazy grid gate is still classifying a dataset. */
export const MAP_GATE_CHECKING = "Checking whether the data forms an X/Y grid…";

/** Resolve the grid gate for a dataset (loads the lazy engine once), memoised
 *  per DataStruct. Resolves to `canRenderMap(data)`'s final answer. */
export function ensureMapGate(data: DataStruct | null | undefined): Promise<boolean> {
  if (!data || data.metadata["is2D"] === true || tooSmall(data) || data.metadata["scatteredXYZ"] === true) {
    return Promise.resolve(canRenderMap(data));
  }
  const known = gate.get(data);
  if (known !== undefined) return Promise.resolve(known);
  let p = pending.get(data);
  if (!p) {
    p = import("./mapGate").then(
      (m) => {
        const ok = m.hasGridAxes(data);
        gate.set(data, ok);
        version++;
        listeners.forEach((f) => f());
        return ok;
      },
      () => false, // fail closed; a later call retries the chunk
    );
    pending.set(data, p);
  }
  return p;
}

/** Can this dataset produce a 2-D map at all? (owner request 2026-07-25)
 *
 *  Defined ONCE here because two consumers ask: `MapStage` (canvas vs. its
 *  "needs 3 channels" notice) and `Stage` (whether the Map TAB exists).
 *
 *  Since figures-audit #13: a parser-flagged 2-D map always qualifies; any
 *  other dataset needs three columns -- the file's first (axis) column
 *  counts, see `mapdataFetch.mapColumns` -- of which at least TWO repeat like gridded
 *  axes (`repeats`). That admits long-form XYZ (`X,Y,Z`, or `i,X,Y,Z`) and
 *  stops offering a Map tab for a 1-D sweep (`Energy,S0..S7`: a swept
 *  axis plus continuous signals), which could only ever draw nonsense.
 *
 *  UX-D: repeating columns are only CANDIDATE axes (an instrument file is full
 *  of step-valued status/range/setpoint columns). A candidate pair forms a grid
 *  when its value pairs cover >=80 % of levels(a) x levels(b), OR it is made of
 *  uniform scan lines (a sheared / staggered raster, e.g. a coupled omega-2theta
 *  RSM exported as long-form CSV): >=3 lines of >=3 points, near-constant
 *  (+-20 %) length, the fast axis (revisited by >=3 rows per level) taking new values that run ONE way along each
 *  line (a real raster line is monotone; a step column's noise is not). Each
 *  axis needs >=3 levels, so a 2 x N table is not a map. A dataset the gate
 *  rejects can still be opened as a scattered map by hand (Stage's "View as
 *  scattered map").
 *
 *  Cost is bounded: at most ~20k (strided) rows and 8 candidate columns are
 *  examined, level sets are built once, and pairs that cannot qualify are never
 *  scanned (`mapGateWork` counts the scans for the perf-invariant test).
 *
 *  The grid test itself (lib/mapGate.ts) is a LAZY chunk: `canRenderMap` is
 *  synchronous and FAILS CLOSED -- a dataset the parser did not flag `is2D`
 *  has no Map tab until `ensureMapGate` has resolved it (memoised per DataStruct,
 *  so once per dataset version) and notified `subscribeMapGate` listeners.
 *  `Stage` triggers it for the active dataset (that is the warm-up on import).
 *  Parser-flagged 2-D maps keep the tab immediately, with no lazy wait.
 *
 *  Deliberately capability, not history: "has a map been drawn" would be
 *  circular -- you could never reach the tab to draw the first one. */
export function canRenderMap(data: DataStruct | null | undefined): boolean {
  if (!data) return false;
  if (data.metadata["is2D"] === true) return data.labels.length >= 3;
  if (tooSmall(data)) return false;
  return data.metadata["scatteredXYZ"] === true || gate.get(data) === true;
}
