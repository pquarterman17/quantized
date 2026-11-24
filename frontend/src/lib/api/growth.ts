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
