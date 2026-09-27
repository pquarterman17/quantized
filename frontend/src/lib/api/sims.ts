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
