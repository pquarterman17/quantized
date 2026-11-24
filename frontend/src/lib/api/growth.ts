// /api/substrates/critical-thickness-model and /api/growth/* wrappers
// (thin-film planning extensions). Kept apart from api/substrates.ts so the
// lazily loaded cards that use them stay out of that module's mocks.

import { postJSON } from "./http";

export type CtModel = "matthews_blakeslee" | "people_bean";

export interface CtModelResult {
  model: CtModel;
  label: string;
  /** null when lattice matched. */
  h_c: number | null;
  h_c_nm: number | null;
  mismatch: number;
  b: number;
  nu: number;
  matched: boolean;
}

export function criticalThicknessModel(req: {
  model: CtModel;
  a_film: number;
  a_sub: number;
  nu: number;
  b?: number | null;
  alpha_deg?: number;
  lambda_deg?: number;
}): Promise<CtModelResult> {
  return postJSON("/api/substrates/critical-thickness-model", req);
}

export type BauerVerdict = "FvdM" | "VW" | "SK" | "indeterminate";

export interface BauerResult {
  points: { gamma_int: number; delta: number; verdict: BauerVerdict }[];
  boundaries: { name: string; gamma_int: number; between: string[] }[];
  uncertainty: number;
  strain_penalty: number;
  verdict_labels: Record<BauerVerdict, string>;
  note: string;
}

/** Bauer growth-mode verdict over a gamma_int range (all energies in one user unit). */
export function bauerScan(req: {
  gamma_substrate: number;
  gamma_film: number;
  gamma_int_min: number;
  gamma_int_max: number;
  n: number;
  uncertainty: number;
  strain_penalty: number;
}): Promise<BauerResult> {
  return postJSON("/api/growth/bauer", req);
}
