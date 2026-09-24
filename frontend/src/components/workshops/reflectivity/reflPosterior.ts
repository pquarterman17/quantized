// Reflectivity fit — the DREAM posterior summary a fit record keeps (P2.2
// slice 4). Pure: no React, no store. A finished "Estimate uncertainty" run
// (calc/refl_dream.py, via POST /api/reflectivity/dream) is reduced to what
// the fit view and the report read — per-parameter intervals, R-hat, the draw
// counts, the correlation — and stored on the record (reflFitRecord.ts
// `withPosterior`). NEVER the chains, and not the bands: those are large, and
// "Add uncertainty bands" turns the live run's bands into library datasets
// instead (reflDreamBands.ts). The keys keep the backend's snake_case so the
// report (calc/report_emit.from_refl_fit) reads the stored summary as is.
//
// Read side: validated like the rest of the record, fail-soft — a malformed
// summary costs the record its posterior, never the record.

import type { ReflPosteriorParam, ReflPosteriorResult } from "../../../lib/api/reflectivity";
import { Bad, isObj, list, need, num, numOrNull, oneOf, str } from "./reflFitCodec";

/** The sampling budget the user chose. `pop` is chains per free parameter. */
export interface DreamSettings {
  samples: number;
  burn: number;
  pop: number;
  seed: number | null;
}

/** Enough draws for usable 95% intervals on a typical XRR fit (9 free
 *  parameters: 36 chains, ~480 generations, about a minute on a 500-point
 *  smeared scan); seeded, so a re-run reproduces. */
export const DREAM_DEFAULTS: DreamSettings = { samples: 10_000, burn: 200, pop: 4, seed: 1 };

type Stopped = "completed" | "deadline" | "cancelled";

export interface SavedConvergence {
  converged: boolean;
  rhat_threshold: number;
  rhat_max: number | null;
  flagged: string[];
  unmeasured: string[];
  stopped: Stopped;
  burn: number;
  thin: number;
  n_chains: number;
  n_generations: number;
  n_draws: number;
  reproducible: boolean;
}

export interface SavedPosterior {
  ranAt: string;
  settings: DreamSettings;
  parameters: ReflPosteriorParam[];
  correlation: (number | null)[][];
  convergence: SavedConvergence;
  map_chi2: number | null;
  warnings: string[];
}

/** The stored summary of a finished run. */
export function posteriorSummary(res: ReflPosteriorResult, settings: DreamSettings, ranAt: string): SavedPosterior {
  const c = res.convergence;
  return {
    ranAt,
    settings: { ...settings },
    parameters: res.parameters.map((p) => ({ ...p, interval68: [...p.interval68], interval95: [...p.interval95] })),
    correlation: res.correlation.map((row) => [...row]),
    convergence: {
      converged: c.converged,
      rhat_threshold: c.rhat_threshold,
      rhat_max: c.rhat_max,
      flagged: [...c.flagged],
      unmeasured: [...c.unmeasured],
      stopped: c.stopped,
      burn: c.burn,
      thin: c.thin,
      n_chains: c.n_chains,
      n_generations: c.n_generations,
      n_draws: c.n_draws,
      reproducible: c.reproducible,
    },
    map_chi2: res.map_chi2,
    warnings: [...res.warnings],
  };
}

/** Why the intervals should not be trusted as they stand, or null. */
export function posteriorCaveat(p: Pick<SavedPosterior, "convergence">): string | null {
  const c = p.convergence;
  if (c.stopped !== "completed") {
    return `Sampling stopped early (${c.stopped === "deadline" ? "time limit" : "cancelled"}): the intervals are provisional.`;
  }
  if (c.flagged.length) {
    return `R-hat above ${c.rhat_threshold} for ${c.flagged.join(", ")}: the chains have not mixed, so those intervals are not trustworthy. Sample longer (more samples or burn-in).`;
  }
  if (c.unmeasured.length || c.rhat_max == null) {
    return `R-hat could not be computed${c.unmeasured.length ? ` for ${c.unmeasured.join(", ")}` : ""} (too few draws): the intervals are not trustworthy. Sample longer.`;
  }
  return c.converged ? null : "The run did not converge: the intervals are not trustworthy.";
}

// ── the stored form, read back ───────────────────────────────────────────────

const pair = (v: unknown): [number, number] => {
  const ends = list(v, (x) => need(num(x), "interval end"));
  if (ends.length !== 2) throw new Bad("interval");
  return [ends[0], ends[1]];
};
const count = (v: unknown): number => {
  const n = need(num(v), "count");
  if (!Number.isInteger(n) || n < 0) throw new Bad("count");
  return n;
};

function decodeParam(v: unknown): ReflPosteriorParam {
  if (!isObj(v)) throw new Bad("posterior param");
  return {
    name: need(str(v.name), "name"),
    tie: str(v.tie),
    median: need(num(v.median), "median"),
    interval68: pair(v.interval68),
    interval95: pair(v.interval95),
    map: numOrNull(v.map) ?? null,
    rhat: numOrNull(v.rhat) ?? null,
    rhat_flag: v.rhat_flag === true,
    at_bound: v.at_bound === true,
  };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((f): f is string => typeof f === "string") : []);

function decodeConvergence(v: unknown): SavedConvergence {
  if (!isObj(v)) throw new Bad("convergence");
  return {
    converged: v.converged === true,
    rhat_threshold: num(v.rhat_threshold) ?? 1.2,
    rhat_max: numOrNull(v.rhat_max) ?? null,
    flagged: strings(v.flagged),
    unmeasured: strings(v.unmeasured), // absent before the review round: none
    stopped: oneOf<Stopped>(v.stopped, ["completed", "deadline", "cancelled"]),
    burn: count(v.burn),
    thin: count(v.thin),
    n_chains: count(v.n_chains),
    n_generations: count(v.n_generations),
    n_draws: count(v.n_draws),
    reproducible: v.reproducible === true,
  };
}

function decodeSettings(v: unknown): DreamSettings {
  if (!isObj(v)) return { ...DREAM_DEFAULTS };
  const seed = num(v.seed);
  return {
    samples: num(v.samples) ?? DREAM_DEFAULTS.samples,
    burn: num(v.burn) ?? DREAM_DEFAULTS.burn,
    pop: num(v.pop) ?? DREAM_DEFAULTS.pop,
    seed: seed !== undefined && Number.isInteger(seed) ? seed : null,
  };
}

/** A stored posterior summary, or undefined when absent or unusable. */
export function decodePosterior(v: unknown): SavedPosterior | undefined {
  if (!isObj(v)) return undefined;
  try {
    const parameters = list(v.parameters, decodeParam);
    if (parameters.length === 0) return undefined;
    return {
      ranAt: str(v.ranAt) ?? "",
      settings: decodeSettings(v.settings),
      parameters,
      correlation: Array.isArray(v.correlation) ? list(v.correlation, (row) => list(row, (x) => numOrNull(x) ?? null)) : [],
      convergence: decodeConvergence(v.convergence),
      map_chi2: numOrNull(v.map_chi2) ?? null,
      warnings: Array.isArray(v.warnings) ? v.warnings.filter((w): w is string => typeof w === "string") : [],
    };
  } catch (e) {
    if (e instanceof Bad) return undefined;
    throw e;
  }
}
