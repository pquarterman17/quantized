// `/api/transform/resample` (audit P2.5 align/interpolate). Its consumers are
// the lazy Resample workshop and the lazy transform runner (lib/
// transformResample.ts), so it lives here, NOT re-exported by lib/api.ts.

import { postJSON } from "./http";
import type { components } from "./schema";
import type { DataStruct } from "../types";

export type ResampleRequest = Omit<components["schemas"]["ResampleRequest"], "dataset"> & {
  dataset: Pick<DataStruct, "time" | "values" | "labels" | "units" | "metadata" | "cat_levels" | "level_order">;
};
export type ResampleWarningWire = components["schemas"]["ResampleWarning"];

export interface ResampleResult {
  /** The resampled dataset (a blank value arrives as JSON null). */
  dataset: DataStruct;
  warnings: ResampleWarningWire[];
  /** The source's finite x-range [lo, hi]. */
  source_range: number[];
  rows_in: number;
  rows_out: number;
}

/** Resample one dataset onto a target grid; `warnings` say what that did. */
export function resampleDataset(body: ResampleRequest, signal?: AbortSignal): Promise<ResampleResult> {
  return postJSON("/api/transform/resample", body, signal);
}
