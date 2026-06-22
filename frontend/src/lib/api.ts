// Typed fetch layer over the FastAPI backend. All endpoints are under /api
// (dev: Vite proxies to uvicorn :8000; prod: same-origin static mount).

import type {
  CalcResult,
  CorrectionParams,
  DataStruct,
  ElementInfo,
  FitModel,
  PlotSeriesResponse,
} from "./types";

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<T>(res);
}

async function getJSON<T>(path: string): Promise<T> {
  return unwrap<T>(await fetch(path));
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const j = (await res.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export async function health(): Promise<{ status: string }> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`health ${res.status}`);
  return (await res.json()) as { status: string };
}

/** Import a local file path (auto-detect format) → DataStruct. */
export function importFile(path: string): Promise<DataStruct> {
  return postJSON<DataStruct>("/api/parsers/import", { path });
}

export interface PlotRequest {
  dataset: DataStruct;
  x_key?: number | string | null;
  y_keys?: (number | string)[] | null;
  x_log?: boolean;
  y_log?: boolean;
}

/** Build uPlot-ready series from a DataStruct + selection. */
export function plotSeries(req: PlotRequest): Promise<PlotSeriesResponse> {
  return postJSON<PlotSeriesResponse>("/api/plot/series", req);
}

export interface CorrectionsRequest {
  dataset: DataStruct;
  params: CorrectionParams;
  bg_dataset?: DataStruct | null;
  bg_interp?: string;
}

/** Apply the correction pipeline to a DataStruct → corrected DataStruct. */
export function applyCorrections(req: CorrectionsRequest): Promise<DataStruct> {
  return postJSON<DataStruct>("/api/corrections/apply", req);
}

// ── Fitting ─────────────────────────────────────────────────────────────────
export interface FitRequest {
  model: string;
  x: number[];
  y: number[];
  p0?: number[];
  lower?: number[];
  upper?: number[];
  weights?: number[];
  fixed?: boolean[];
  calc_errors?: boolean;
}

/** Registry of fit models with parameter names and defaults. */
export function listFitModels(): Promise<{ models: FitModel[] }> {
  return getJSON("/api/fitting/models");
}

/** Initial-parameter guess for a named model given (x, y). */
export function autoGuess(model: string, x: number[], y: number[]): Promise<{ p0: number[] }> {
  return postJSON("/api/fitting/autoguess", { model, x, y });
}

/** Bounded nonlinear least-squares fit of a named model. */
export function fitModel(req: FitRequest): Promise<CalcResult> {
  return postJSON("/api/fitting/fit", req);
}

// ── Baseline ────────────────────────────────────────────────────────────────
type BaselineResult = { baseline: (number | null)[] };
type BaselineWithInfo = BaselineResult & { info: CalcResult };

export function baselineEstimate(body: {
  x: number[];
  y: number[];
  method?: string;
}): Promise<BaselineResult> {
  return postJSON("/api/baseline/estimate", body);
}

export function baselineALS(body: {
  y: number[];
  lam?: number;
  p?: number;
}): Promise<BaselineResult> {
  return postJSON("/api/baseline/als", body);
}

export function baselineRollingBall(body: {
  y: number[];
  radius?: number;
  smooth?: number;
}): Promise<BaselineWithInfo> {
  return postJSON("/api/baseline/rollingball", body);
}

export function baselineModPoly(body: {
  y: number[];
  order?: number;
}): Promise<BaselineWithInfo> {
  return postJSON("/api/baseline/modpoly", body);
}

// ── Stats ───────────────────────────────────────────────────────────────────
export function statsDescriptive(x: number[]): Promise<CalcResult> {
  return postJSON("/api/stats/descriptive", { x });
}

export function statsRegression(body: {
  x: number[];
  y: number[];
  order?: number;
  alpha?: number;
}): Promise<CalcResult> {
  return postJSON("/api/stats/regression", body);
}

export function statsTTest(body: {
  x: number[];
  y?: number[];
  mu?: number;
  paired?: boolean;
  tail?: string;
}): Promise<CalcResult> {
  return postJSON("/api/stats/ttest", body);
}

export function statsAnova(groups: number[][]): Promise<CalcResult> {
  return postJSON("/api/stats/anova", { groups });
}

export function statsPCA(body: {
  data: number[][];
  center?: boolean;
  scale?: boolean;
}): Promise<CalcResult> {
  return postJSON("/api/stats/pca", body);
}

// ── Reference data ──────────────────────────────────────────────────────────
export function getConstants(): Promise<{ constants: Record<string, number> }> {
  return getJSON("/api/reference/constants");
}

export function getElements(): Promise<{ elements: ElementInfo[] }> {
  return getJSON("/api/reference/elements");
}

export function getElement(symbol: string): Promise<ElementInfo> {
  return getJSON(`/api/reference/elements/${encodeURIComponent(symbol)}`);
}

export function convertUnits(
  value: number | number[],
  from: string,
  to: string,
): Promise<{ result: number | (number | null)[]; info: CalcResult }> {
  return postJSON("/api/reference/convert", { value, from, to });
}
