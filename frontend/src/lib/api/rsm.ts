// Sector/chi/box endpoint wrappers — the RSM_CUTS_PLAN half of `/api/rsm/*`
// (items 1 and 3 build the routes in a parallel worktree; this file compiles
// against their documented request/response contract from the plan, not
// against a running backend). New `lib/api/rsm.ts` per `lib/api.ts`'s own
// pin comment: that file is shrink-only ratcheted (architecture.test.ts), so
// new `/api/rsm/*` wrappers land HERE — same `lib/api/plot.ts` transport
// idiom (postJSON + one typed request interface per endpoint). `api.ts`
// already carries FIVE older rsm* wrappers (rsmLinecut/rsmCutSegment/
// rsmProjection/analyzeRsm/rsmStrain, all still there); migrating them to
// this sibling is Tier 3 item 14 (lowers the 1828 pin next time one is
// touched) — deliberately NOT done here, and `api.ts` is not re-exporting
// this file either (unlike plot.ts/stats.ts) until that migration lands, so
// nothing here can accidentally push api.ts back toward its pin.
//
// The dataset-handle cache (item 18) needs NO changes here: every wrapper
// below still always passes a full `dataset`, unchanged -- `postJSON`
// itself (lib/api/http.ts) transparently swaps it for a remembered
// `dataset_handle` on repeat calls for /api/rsm/* paths (see
// lib/api/datasetCache.ts). That is also why the five OLDER rsm* wrappers
// still in the pinned `lib/api.ts` get the same saving for free without
// that file ever being touched.

import { postJSON } from "./http";
import type { DataStruct } from "../types";

// ── Sector / chi profile (item 1, calc/sectorcut.py) ────────────────────

/** Dual phi-bound parameterization (Resolved decisions: "Dual sector
 *  parameterization at the boundary"): supply EITHER the canonical
 *  `phi_min`/`phi_max` pair OR the panel-friendly `phi_center`/
 *  `phi_halfwidth` pair — never both (the backend 422s on that); omit both
 *  for a full circle. `lib/roi.ts::sectorFromCenter` builds the center/
 *  halfwidth pair without wrapping (the backend owns the mod-360 rebase).
 *  Shared by `/sector` and `/chi-profile` — both take the same annulus/
 *  sector bounds (the plan's Sector card drives "Radial" and "Azimuthal"
 *  profile buttons off ONE set of q/phi fields). */
export interface SectorBoundsRequest {
  q_min: number;
  q_max: number;
  n_bins?: number;
  mode?: "sum" | "mean";
  phi_min?: number;
  phi_max?: number;
  phi_center?: number;
  phi_halfwidth?: number;
}

export interface SectorRequest extends SectorBoundsRequest {
  dataset: DataStruct;
}

/** Radial |Q| profile within a sector — POST /api/rsm/sector
 *  (calc.sectorcut.sector_profile). True-polar branch (i) of the
 *  polar-space rule: requires Qx/Qz on `dataset`. */
export function rsmSector(req: SectorRequest): Promise<DataStruct> {
  return postJSON<DataStruct>("/api/rsm/sector", req);
}

export interface ChiProfileRequest extends SectorBoundsRequest {
  dataset: DataStruct;
}

/** Azimuthal (chi) profile within an annulus — POST /api/rsm/chi-profile
 *  (calc.sectorcut.chi_profile). Same dual phi parameterization and
 *  true-polar requirement as `rsmSector`. */
export function rsmChiProfile(req: ChiProfileRequest): Promise<DataStruct> {
  return postJSON<DataStruct>("/api/rsm/chi-profile", req);
}

// ── Box cut / stats (item 3, calc/boxcut.py) ─────────────────────────────

export interface BoxCutRequest {
  dataset: DataStruct;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
  space?: string;
  collapse?: "x" | "y";
  reduce?: "sum" | "mean" | "max";
  n_bins?: number;
  angle?: number;
  wrap?: "x" | "y" | null;
}

/** Bounded box/ruler integration — POST /api/rsm/box (calc.boxcut.box_cut).
 *  `lib/roi.ts::roiBoxBody`/`rulerBoxBody` shape the request from a drawn
 *  RoiRect/RoiRuler. */
export function rsmBoxCut(req: BoxCutRequest): Promise<DataStruct> {
  return postJSON<DataStruct>("/api/rsm/box", req);
}

export interface BoxStatsRequest {
  dataset: DataStruct;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
  space?: string;
  angle?: number;
  wrap?: "x" | "y" | null;
}

/** Scalar summary over a box/ruler — POST /api/rsm/box-stats
 *  (calc.boxcut.box_stats). A plain dict response (Resolved decisions:
 *  "Dict, not DataStruct — the rsm_strain precedent"): never lands in the
 *  library directly, just echoes bounds + summary scalars for a copyable
 *  readout. No sigma/uncertainty field — item 3's docstring corrects the
 *  rev-1 overclaim (see calc.boxcut's own docstring: sigma=sqrt(sum I) is
 *  only valid for raw-count intensities, not cps). */
export interface BoxStats {
  n_points: number;
  integrated_intensity: number;
  mean_intensity: number;
  max_intensity: number;
  peak_x: number;
  peak_y: number;
  centroid_x: number;
  centroid_y: number;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
  space: string;
  angle: number;
  wrap: "x" | "y" | null;
}

export function rsmBoxStats(req: BoxStatsRequest): Promise<BoxStats> {
  return postJSON<BoxStats>("/api/rsm/box-stats", req);
}
