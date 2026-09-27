// `/api/sims/process` (audit P2.3 SIMS depth profiles). Its consumers are the
// lazy SIMS workshop and the lazy transform runner (lib/transformSims.ts), so
// it lives here, NOT re-exported by lib/api.ts.

import { postJSON } from "./http";
import type { components } from "./schema";
import type { DataStruct } from "../types";

export type SimsProcessRequest = Omit<components["schemas"]["SimsProcessRequest"], "dataset"> & {
  dataset: Pick<DataStruct, "time" | "values" | "labels" | "units" | "metadata" | "cat_levels" | "level_order">;
};
export type SimsWarningWire = components["schemas"]["SimsWarning"];

export interface SimsProcessResult {
  /** The processed dataset (a blank value arrives as JSON null). */
  dataset: DataStruct;
  warnings: SimsWarningWire[];
  /** Every stage's parameters and derived values (also in the dataset's
   *  `metadata.sims_processing`). */
  stages: Record<string, unknown>[];
}

/** Calibrate / correct one SIMS profile; `warnings` say what that did. */
export function processSims(body: SimsProcessRequest, signal?: AbortSignal): Promise<SimsProcessResult> {
  return postJSON("/api/sims/process", body, signal);
}

type WireDataset = Pick<DataStruct, "time" | "values" | "labels" | "units" | "metadata" | "cat_levels" | "level_order">;

export interface SimsCompareRequest {
  profiles: { name: string; dataset: WireDataset }[];
  species: string[];
}

export interface SimsCompareResult {
  /** The comparison table (row blocks; a blank arrives as JSON null). */
  dataset: DataStruct;
  warnings: SimsWarningWire[];
  /** One entry per trace: label, profile, species, unit, rows [start, stop). */
  traces: Record<string, unknown>[];
}

/** Several profiles' species side by side in one comparison table (slice 2). */
export function compareSims(body: SimsCompareRequest, signal?: AbortSignal): Promise<SimsCompareResult> {
  return postJSON("/api/sims/compare", body, signal);
}

export type SimsRegionRequest = Omit<components["schemas"]["SimsRegionRequest"], "dataset"> & { dataset: WireDataset };
export type SimsRegionResult = components["schemas"]["SimsRegionResponse"];
export type SimsRegionSpecies = components["schemas"]["SimsRegionSpecies"];

/** Dose, peak, mean and junction depth per species over one region (slice 2). */
export function measureSimsRegion(body: SimsRegionRequest, signal?: AbortSignal): Promise<SimsRegionResult> {
  return postJSON("/api/sims/region", body, signal);
}
