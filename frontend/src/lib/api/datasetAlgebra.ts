// `/api/aggregate/algebra` — split out of lib/api.ts (R8 bundle-diet pass,
// 2026-08-23; see api/reference.ts's header for why): its one consumer is
// the lazy dataset-math workshop. NOT re-exported by lib/api.ts;
// useDatasetMath.ts imports directly from this path.

import { postJSON } from "./http";
import type { DataStruct } from "../types";

/** Combine two datasets pointwise on A's x-grid (B interpolated). calc.aggregate. */
export function datasetAlgebra(body: {
  dataset_a: DataStruct;
  dataset_b: DataStruct;
  operation: string;
  interp_method?: string;
  channel_a?: number;
  channel_b?: number;
}): Promise<DataStruct> {
  return postJSON("/api/aggregate/algebra", body);
}
