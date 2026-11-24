// Statistical-tests workshop wrappers, part four (GAP_AUDIT_9 J14): SPC control
// charts and process capability. Request shapes come from the generated OpenAPI
// schema; the routes return plain calc dicts (non-finite values arrive as null).

import { postJSON } from "./http";
import type { components } from "./schema";

type S = components["schemas"];
type Num = number | null;

export type SpcChartKind = "xbar-r" | "xbar-s" | "imr" | "p" | "np" | "c" | "u" | "ewma" | "cusum";

export interface SpcViolation { rule: string; label: string; indices: number[] }

export interface SpcPanel {
  name: string;
  values: number[];
  center: number;
  ucl: number[];
  lcl: number[];
  beyond_limits: number[];
  violations: SpcViolation[];
  flagged: number[];
}

export interface ControlChartResult {
  chart: SpcChartKind;
  n_subgroups: number;
  subgroup_size: Num;
  panels: SpcPanel[];
  sigma_within: Num;
  grand_mean: number;
  dispersion_mean: Num;
  constants: Record<string, number> | null;
  out_of_control: number;
  /** EWMA / CUSUM only: the parameters used and where target / sigma came from. */
  params?: Record<string, number | string>;
  /** CUSUM only: the first signal per side and the estimated shift start (0-based). */
  signals?: { side: "upper" | "lower"; first_signal: number; estimated_shift_start: number }[];
}

export interface CapabilityIndices {
  sigma: number;
  cp?: Num; cpk?: Num; cpu?: Num; cpl?: Num;
  pp?: Num; ppk?: Num; ppu?: Num; ppl?: Num;
  ci: Record<string, [number, number] | null>;
}

export interface PpmSplit { below: Num; above: Num; total: number }

export interface CapabilityResult {
  n: number; mean: number; lsl: Num; usl: Num; target: Num; alpha: number;
  within: CapabilityIndices; overall: CapabilityIndices; cpm: Num;
  within_method: string; ppm_within: PpmSplit; ppm_overall: PpmSplit;
  histogram: { edges: number[]; counts: number[] };
  normality_p: Num; ci_note: string;
}

export const statsControlChart = (body: S["ControlChartRequest"], signal?: AbortSignal): Promise<ControlChartResult> =>
  postJSON("/api/stats/control-chart", body, signal);
export const statsCapability = (body: S["CapabilityRequest"], signal?: AbortSignal): Promise<CapabilityResult> =>
  postJSON("/api/stats/capability", body, signal);
