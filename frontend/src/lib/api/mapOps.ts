// `/api/map-ops/apply` (calc/map_ops, calc/map_arith): one call per map
// operation, result is a native-grid map DataStruct. Its only consumer is the
// lazy Map operations workshop; NOT re-exported by lib/api.ts.

import { postJSON } from "./http";
import type { DataStruct } from "../types";

export type MapOpName = "crop" | "flip" | "rotate" | "transpose" | "plane_level" | "arith" | "scalar";

export interface MapOpRequest {
  dataset: DataStruct;
  op: MapOpName;
  x_col?: number;
  y_col?: number;
  z_col?: number;
  xmin?: number | null;
  xmax?: number | null;
  ymin?: number | null;
  ymax?: number | null;
  axis?: "h" | "v";
  degrees?: number;
  order?: number;
  restore_mean?: boolean;
  other?: DataStruct;
  arith?: "add" | "sub" | "mul" | "div";
  interpolate?: boolean;
  allow_mismatch?: boolean;
  value?: number;
  reverse?: boolean;
}

export const mapOpApply = (body: MapOpRequest, signal?: AbortSignal): Promise<DataStruct> =>
  postJSON("/api/map-ops/apply", body, signal);
