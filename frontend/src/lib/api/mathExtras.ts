// /api/math-extras wrappers: areas, trace / scattered interpolation, B-spline
// resampling, 2-D map correlation and the equation / optimisation solver. Used
// only by the lazy Math extras workshop, so they live in their own sibling (see
// lib/api.ts's header) and are NOT re-exported from it. Shapes come from the
// generated OpenAPI schema. The routes that make a worksheet answer with a
// DataStruct.

import { postJSON } from "./http";
import type { components } from "./schema";
import type { DataStruct } from "../types";

type S = components["schemas"];

export type PolygonAreaResult = S["PolygonAreaResponse"];
export type SurfaceAreaResult = S["SurfaceAreaResponse"];
export type RootResult = S["RootResponse"];
export type OptimizeResult = S["OptimizeResponse"];
export type TraceBody = S["TraceRequest"];
export type BSplineBody = S["BSplineRequest"];
export type ScatterBody = S["ScatterRequest"];

export const polygonArea = (x: number[], y: number[], signal?: AbortSignal): Promise<PolygonAreaResult> =>
  postJSON("/api/math-extras/polygon-area", { x, y }, signal);
export const surfaceArea = (dataset: DataStruct, onNan: "error" | "skip", signal?: AbortSignal): Promise<SurfaceAreaResult> =>
  postJSON("/api/math-extras/surface-area", { dataset, on_nan: onNan }, signal);
export const traceInterp = (body: TraceBody, signal?: AbortSignal): Promise<DataStruct> => postJSON("/api/math-extras/trace", body, signal);
export const bsplineResample = (body: BSplineBody, signal?: AbortSignal): Promise<DataStruct> => postJSON("/api/math-extras/bspline", body, signal);
export const scatterInterp = (body: ScatterBody, signal?: AbortSignal): Promise<DataStruct> => postJSON("/api/math-extras/scatter", body, signal);
export const correlateMaps = (dataset: DataStruct, other: DataStruct, onNan: "error" | "zero", signal?: AbortSignal): Promise<DataStruct> =>
  postJSON("/api/math-extras/correlate", { dataset, other, on_nan: onNan }, signal);
export const solveRoot = (body: S["RootRequest"], signal?: AbortSignal): Promise<RootResult> => postJSON("/api/math-extras/solve-root", body, signal);
export const optimizeBox = (body: S["OptimizeRequest"], signal?: AbortSignal): Promise<OptimizeResult> => postJSON("/api/math-extras/optimize", body, signal);
