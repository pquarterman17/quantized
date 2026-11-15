// `/api/transform/sigop` (gap audit 4, G6/G7): median / despike / LOWESS /
// (de)convolution / Hilbert / inverse FFT / Reduce XY. Consumed only by the lazy
// Signal Processing + Resample workshops and the lazy transform runner
// (lib/transformSigop.ts), so it is NOT re-exported by lib/api.ts.

import { postJSON } from "./http";
import type { components } from "./schema";
import type { DataStruct } from "../types";

export type SigopRequest = Omit<components["schemas"]["SigopRequest"], "dataset"> & {
  dataset: Pick<DataStruct, "time" | "values" | "labels" | "units" | "metadata" | "cat_levels" | "level_order">;
};

export interface SigopResult {
  /** The derived dataset (a blank value arrives as JSON null). */
  dataset: DataStruct;
  warnings: string[];
  /** Despike: channel index (string) -> flagged row numbers. */
  flagged: Record<string, number[]>;
  rows_in: number;
  rows_out: number;
}

export function sigopDataset(body: SigopRequest, signal?: AbortSignal): Promise<SigopResult> {
  return postJSON("/api/transform/sigop", body, signal);
}
