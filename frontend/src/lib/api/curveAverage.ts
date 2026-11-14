// `/api/transform/average` (origin gap audit 2 #9, Origin's "Average Multiple
// Curves"). Its only consumer is the lazy transform runner
// (lib/transformAverage.ts), so it lives here, NOT re-exported by lib/api.ts.

import { postJSON } from "./http";
import type { components } from "./schema";
import type { DataStruct } from "../types";

type WireDataset = Pick<DataStruct, "time" | "values" | "labels" | "units" | "metadata" | "cat_levels" | "level_order">;

export type AverageRequest = Omit<components["schemas"]["AverageRequest"], "curves"> & {
  curves: { name: string; dataset: WireDataset }[];
};
export type AverageWarningWire = components["schemas"]["ResampleWarning"];

export interface AverageResult {
  /** Mean, SD, SEM, N on the common grid (a blank value arrives as JSON null). */
  dataset: DataStruct;
  warnings: AverageWarningWire[];
  /** The overlap of every curve's x-range; nulls when they do not overlap. */
  overlap: (number | null)[];
  /** The y column each curve contributed. */
  channels: string[];
}

/** Average N curves onto one grid; `warnings` say what that did. */
export function averageCurves(body: AverageRequest, signal?: AbortSignal): Promise<AverageResult> {
  return postJSON("/api/transform/average", body, signal);
}
