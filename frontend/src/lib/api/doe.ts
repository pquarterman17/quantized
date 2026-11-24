// Design of experiments wrappers (GAP_AUDIT_9 J16): `/api/doe/*`
// (routes/doe.py). Its own module, imported only by the lazy DOE workshop, so
// none of it reaches the eager bundle through `lib/api.ts`'s barrel.

import { getJSON, postJSON } from "./http";
import type { DataStruct } from "../types";

export type DoeDesignType = "full_factorial" | "fractional_factorial" | "plackett_burman" | "ccd" | "box_behnken";
export type DoeAlphaChoice = "rotatable" | "face_centered" | "orthogonal" | "custom";

export interface DoeFactorBody {
  name: string;
  low: number;
  high: number;
  unit: string;
}

export interface DoeGenerateBody {
  design: DoeDesignType;
  factors: DoeFactorBody[];
  response_name: string;
  p?: number | null;
  runs?: number | null;
  replicates?: number;
  /** null/omitted = the published default (NIST Table 3.28 for RSM, 0 for 2-level designs). */
  center_points?: number | null;
  alpha?: string | number;
  ccd_fractional?: boolean;
  ccd_inscribed?: boolean;
  randomize?: boolean;
  seed?: number | null;
}

export interface DoeFractionInfo {
  p: number;
  runs: number;
  resolution: number;
  generators: string[];
}

export interface DoeFractionsResponse {
  k: number;
  fractions: DoeFractionInfo[];
  center_points: { ccd: number; ccd_fractional: number; box_behnken: number };
}

export interface DoeEffectRow {
  term: string;
  effect: number;
  abs_effect: number;
  half_normal_q: number;
  t_ratio: number | null;
  significant: boolean | null;
}

export interface DoeEffectsResponse {
  n_runs: number;
  pse: number | null;
  me: number | null;
  sme: number | null;
  effects: DoeEffectRow[];
}

export interface DoeEffectsBody {
  factor_columns: Record<string, (number | null)[]>;
  response: (number | null)[];
  terms: string[][];
}

export function doeGenerate(body: DoeGenerateBody, signal?: AbortSignal): Promise<{ dataset: DataStruct }> {
  return postJSON("/api/doe/generate", body, signal);
}

export function doeFractions(k: number): Promise<DoeFractionsResponse> {
  return getJSON(`/api/doe/fractions/${k}`);
}

export function doeEffects(body: DoeEffectsBody, signal?: AbortSignal): Promise<DoeEffectsResponse> {
  return postJSON("/api/doe/effects", body, signal);
}
