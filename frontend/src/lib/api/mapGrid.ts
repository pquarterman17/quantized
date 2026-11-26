// `/api/map-ops/{grid,formula,extract}` (calc/grid_xyz, calc/map_formula,
// calc/map_extract): XYZ gridding to a new map, a map's values from a formula,
// and the value at one (x, y) in every map. Each result is a new DataStruct.
// Its only consumer is the lazy Map gridding workshop; NOT re-exported by api.ts.

import { postJSON } from "./http";
import type { DataStruct } from "../types";

export type GridMethod = "natural" | "linear" | "nearest" | "cubic" | "idw" | "thinplate" | "shepard" | "kriging" | "renka";
export type Variogram = "auto" | "spherical" | "exponential" | "gaussian";

export interface GridRequest {
  dataset: DataStruct;
  x_col: number | string;
  y_col: number | string;
  z_col: number | string;
  method: GridMethod;
  nx: number;
  ny: number;
  log_x?: boolean;
  log_y?: boolean;
  extrapolation?: "none" | "nearest";
  output?: "value" | "variance";
  shepard_radius?: number | null;
  shepard_neighbors?: number;
  shepard_quadratic?: boolean;
  variogram?: Variogram;
  krige_neighbors?: number;
}

export interface FormulaRequest {
  dataset: DataStruct;
  expr: string;
  unit?: string | null;
}

export interface ExtractRequest {
  maps: { name: string; dataset: DataStruct }[];
  x: number;
  y: number;
}

export const gridXyz = (body: GridRequest, signal?: AbortSignal): Promise<DataStruct> =>
  postJSON("/api/map-ops/grid", body, signal);
export const mapFormula = (body: FormulaRequest, signal?: AbortSignal): Promise<DataStruct> =>
  postJSON("/api/map-ops/formula", body, signal);
export const extractPixels = (body: ExtractRequest, signal?: AbortSignal): Promise<DataStruct> =>
  postJSON("/api/map-ops/extract", body, signal);
