// /api/reflectivity/* wrappers — split out of lib/api.ts (R8 bundle-diet
// pass, 2026-08-23; see api/reference.ts's header for why): its one
// consumer is the lazy reflectivity workshop. NOT re-exported by
// lib/api.ts; useReflectivity.ts imports directly from this path.

import { getJSON, postJSON } from "./http";
import type { SldPreset } from "../types";
import type { components } from "./schema";

/** Material SLD presets for building reflectivity models. */
export function reflPresets(): Promise<{ presets: SldPreset[] }> {
  return getJSON("/api/reflectivity/presets");
}

/** A layer row: [thickness Å, SLD_real Å⁻², SLD_imag Å⁻², roughness Å]. */
export type ReflLayer = [number, number, number, number];

/** Simulate specular reflectivity R(Q) from a layer stack (Parratt recursion). */
export function reflSimulate(body: {
  layers: ReflLayer[];
  q_min?: number;
  q_max?: number;
  n_points?: number;
  roughness?: boolean;
  scale?: number;
  background?: number;
  resolution?: number | null;
}): Promise<{ q: number[]; r: (number | null)[] }> {
  return postJSON("/api/reflectivity/simulate", body);
}

/** Compute the SLD(z) depth profile for a layer stack (error-function interfaces). */
export function reflSldProfile(body: {
  layers: ReflLayer[];
  n_points?: number;
  padding?: number;
}): Promise<{ z: number[]; sld: (number | null)[] }> {
  return postJSON("/api/reflectivity/sld-profile", body);
}

// ── fit a layer model to measured data (P2.2) ───────────────────────────────

/** Request body for POST /api/reflectivity/fit (generated from the route's
 *  pydantic models in routes/reflectivity.py). */
export type ReflFitRequest = components["schemas"]["ReflFitRequest"];
export type ReflFitChannel = components["schemas"]["ReflFitChannel"];
export type ReflFitParameter = components["schemas"]["ReflFitParameter"];

/** One fitted parameter. `stderr` is null when the parameter was fixed, ended
 *  on a bound, or is not determined by the data (calc/refl_fit.py). */
export interface ReflFitParamResult {
  name: string;
  value: number;
  stderr: number | null;
  vary: boolean;
  tie: string | null;
  at_bound: boolean;
}

/** One channel's fitted points — only the points the fit used, in row order. */
export interface ReflFitCurve {
  label: string;
  spin: "+" | "-" | null;
  q: number[];
  r: number[];
  dr: number[] | null;
  model: (number | null)[];
  residual: (number | null)[];
}

/** The fit response. The route's OpenAPI response is an untyped dict, so this
 *  mirrors `fit_reflectivity`'s return value by hand. `dr` weighting reports
 *  `chi2`/`reduced_chi2`; `log` weighting reports `sum_sq_log`/
 *  `reduced_sum_sq_log` and leaves the chi-square fields null. */
export interface ReflFitResult {
  parameters: ReflFitParamResult[];
  free: string[];
  correlation: (number | null)[][];
  chi2: number | null;
  reduced_chi2: number | null;
  sum_sq_log: number | null;
  reduced_sum_sq_log: number | null;
  n_points: number;
  n_free: number;
  success: boolean;
  message: string;
  n_evaluations: number;
  weighting: "dr" | "log";
  curves: ReflFitCurve[];
  sld_profiles: { spin: "+" | "-" | null; z: number[]; sld: (number | null)[] }[];
  warnings: string[];
}

/** Fit the layer model to one or more measured curves. `signal` aborts the
 *  request; the server still finishes its own time-bounded run. */
export function reflFit(body: ReflFitRequest, signal?: AbortSignal): Promise<ReflFitResult> {
  return postJSON("/api/reflectivity/fit", body, signal);
}

// ── the posterior of a fit: DREAM through the job queue (P2.2 slice 4) ─────

export type ReflDreamRequest = components["schemas"]["ReflDreamRequest"];

/** One sampled parameter (a tied one reports its target's posterior). */
export interface ReflPosteriorParam {
  name: string;
  tie: string | null;
  median: number;
  interval68: [number, number];
  interval95: [number, number];
  /** The best draw (MAP under the flat prior). */
  map: number | null;
  rhat: number | null;
  rhat_flag: boolean;
  /** The bounds, not the data, limit the 95% interval. */
  at_bound: boolean;
}

type Percentiles = Record<"lo95" | "lo68" | "median" | "hi68" | "hi95", (number | null)[]>;

/** The finished job's result: `calc.refl_dream.sample_reflectivity`'s dict
 *  (the route's OpenAPI response is untyped, so this mirrors it by hand). */
export interface ReflPosteriorResult {
  parameters: ReflPosteriorParam[];
  free: string[];
  correlation: (number | null)[][];
  map_chi2: number | null;
  n_points: number;
  convergence: {
    converged: boolean;
    rhat_threshold: number;
    rhat_max: number | null;
    flagged: string[];
    /** Parameters whose R-hat could not be computed (too few generations). */
    unmeasured: string[];
    stopped: "completed" | "deadline" | "cancelled";
    burn: number;
    burn_requested: number;
    thin: number;
    n_chains: number;
    n_generations: number;
    n_generations_requested: number;
    n_draws: number;
    n_band_draws: number;
    n_evaluations: number;
    seed: number | null;
    reproducible: boolean;
  };
  /** R(Q) percentiles per channel, on the fitted points. */
  r_bands: ({ label: string; spin: "+" | "-" | null; q: number[]; r: number[]; dr: number[] | null } & Percentiles)[];
  /** SLD(z) percentiles per spin state, on one z grid. */
  sld_bands: ({ spin: "+" | "-" | null; z: number[] } & Percentiles)[];
  warnings: string[];
}

/** Queue a DREAM run; poll the returned job id with `pollReflJob`. A request
 *  the sampler would refuse is rejected here, before anything is queued. */
export function reflDream(
  body: ReflDreamRequest,
): Promise<{ job_id: string; plan: { n_free: number; n_chains: number; n_generations: number; n_evaluations: number } }> {
  return postJSON("/api/reflectivity/dream", body);
}

// ── the job's poll loop ──────────────────────────────────────────────────────
//
// lib/jobs.ts's `pollJob`/`cancelJob`, RESTATED here rather than imported,
// deliberately: lib/jobs lives in the lazy Curve Fit chunk, and importing it
// from this lazy chunk too splits it into a shared chunk whose name the EAGER
// entry then lists in both workshops' preload maps — measured +34 B against an
// eager budget with 51 B of headroom (2026-09-24, vite build after npm ci).
// Same transport (GET-poll /api/jobs/{id}, then /result; error text through
// http.ts's shared `ensureOk`); reflectivityJobs.test.ts runs lib/jobs as the
// oracle over the same job histories, so the two cannot drift.

/** Thrown when the job ends as cancelled — deliberate, not an error. */
export class ReflJobCancelled extends Error {
  constructor(jobId: string) {
    super(`job ${jobId} cancelled`);
    this.name = "ReflJobCancelled";
  }
}

interface JobSnap {
  status: "pending" | "running" | "done" | "error" | "cancelled";
  progress: number;
  message: string;
  error?: string;
}

/** Poll a job to its terminal state: its result on `done`; throws
 *  Error(job error) on `error` and ReflJobCancelled on `cancelled`.
 *  `onProgress` fires on every poll. */
export async function pollReflJob<T>(
  id: string,
  onProgress?: (fraction: number, message: string) => void,
  intervalMs = 1000,
): Promise<T> {
  for (;;) {
    const snap = await getJSON<JobSnap>(`/api/jobs/${id}`);
    onProgress?.(snap.progress, snap.message);
    if (snap.status === "done") return (await getJSON<{ result: T }>(`/api/jobs/${id}/result`)).result;
    if (snap.status === "error") throw new Error(snap.error || "job failed");
    if (snap.status === "cancelled") throw new ReflJobCancelled(id);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Request cooperative cancellation; the poll loop then settles as cancelled. */
export function cancelReflJob(id: string): Promise<unknown> {
  return postJSON(`/api/jobs/${id}/cancel`, {});
}
