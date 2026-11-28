// `/api/map-stack-fit/job` (calc/map_stack_fit): the per-pixel fit through a
// stack of maps, queued through the poll-model job runner. Its only consumer is
// the lazy Map stack fit workshop; NOT re-exported by lib/api.ts.

import type { JobSubmitResponse } from "../jobs";
import type { DataStruct } from "../types";
import { postJSON } from "./http";

export interface StackFitRequest {
  datasets: DataStruct[];
  layer_names: string[];
  x_values: number[];
  x_label: string;
  model: string;
  /** null = start from each pixel's own auto-guess. */
  p0: (number | null)[];
  /** null = open on that side. */
  lower: (number | null)[];
  upper: (number | null)[];
  fixed: boolean[];
  keep_unconverged: boolean;
}

export interface StackFitOutput {
  name: string;
  kind: "parameter" | "error" | "chisq" | "converged";
  dataset: DataStruct;
}

export interface StackFitSummary {
  n_pixels: number;
  n_layers: number;
  n_fitted: number;
  n_failed: number;
  n_no_data: number;
  n_unconverged_kept: number;
  failures: { reason: string; count: number; first_pixel: { row: number; col: number } }[];
}

export interface StackFitResult {
  outputs: StackFitOutput[];
  summary: StackFitSummary;
}

export function submitStackFit(body: StackFitRequest, signal?: AbortSignal): Promise<JobSubmitResponse> {
  return postJSON("/api/map-stack-fit/job", body, signal);
}
