// Fitting preferences (a standalone slot, like the interaction prefs): the
// user's "Maximum bootstrap replicates". Owner decision 2026-11-24: a setting,
// default 10,000, not a fixed limit. The server only enforces a hard safety
// ceiling (routes/fitting_bootstrap.py); this cap is checked before anything
// is sent.

import { definePrefSlot } from "./prefSlots";

export const FIT_PREFS_KEY = "qz.fitPrefs";
export const BOOTSTRAP_CAP_DEFAULT = 10_000;
/** The route's (calc's) lower bound for n_boot. */
export const BOOTSTRAP_CAP_MIN = 20;
/** The server's hard ceiling; a cap above it could never be used. */
export const BOOTSTRAP_CAP_MAX = 1_000_000;

/** A whole number from the lower bound to the server ceiling, else null. */
export function validBootstrapCap(n: number): number | null {
  return Number.isInteger(n) && n >= BOOTSTRAP_CAP_MIN && n <= BOOTSTRAP_CAP_MAX ? n : null;
}

/** Solver limits (owner decision 2026-11-25: exposed in Preferences, defaults
 *  unchanged so every golden is untouched). The defaults ARE calc.fitting's:
 *  5000 iterations per free parameter, tol_fun 1e-12, tol_x 1e-10. Ranges
 *  mirror routes/_fit_options.py (provisional, owner to confirm). */
export const FIT_SOLVER_DEFAULTS = { maxIterPerParam: 5000, tolFun: 1e-12, tolX: 1e-10 };
export const FIT_SOLVER_RANGES = {
  maxIterPerParam: [100, 1_000_000],
  tolFun: [1e-15, 1e-3],
  tolX: [1e-15, 1e-3],
} as const;
export type FitSolverKey = keyof typeof FIT_SOLVER_RANGES;

/** `n` when inside the key's range (a whole number for the iteration cap), else null. */
export function validSolverValue(key: FitSolverKey, n: number): number | null {
  const [lo, hi] = FIT_SOLVER_RANGES[key];
  const ok = Number.isFinite(n) && n >= lo && n <= hi && (key !== "maxIterPerParam" || Number.isInteger(n));
  return ok ? n : null;
}

const fitDefaults = { bootstrapCap: BOOTSTRAP_CAP_DEFAULT, ...FIT_SOLVER_DEFAULTS };

// A slot (lib/prefSlots.ts): localStorage plus the server prefs file. An
// out-of-range stored value falls back to its default.
export const fitPrefsSlot = definePrefSlot(FIT_PREFS_KEY, fitDefaults, (p) => {
  const out = { ...fitDefaults };
  out.bootstrapCap = (typeof p.bootstrapCap === "number" && validBootstrapCap(p.bootstrapCap)) || BOOTSTRAP_CAP_DEFAULT;
  for (const k of Object.keys(FIT_SOLVER_RANGES) as FitSolverKey[])
    out[k] = (typeof p[k] === "number" && validSolverValue(k, p[k])) || FIT_SOLVER_DEFAULTS[k];
  return out;
});

/** The solver-limit fields a /fit or /equation/fit body carries: ONLY the ones
 *  that differ from the defaults, so an untouched Preferences sends a body
 *  byte-identical to before. Any other path gets nothing. */
export function fitSolverFields(path: string): { max_iter_per_param?: number; tol_fun?: number; tol_x?: number } {
  if (path !== "/api/fitting/fit" && path !== "/api/fitting/equation/fit") return {};
  const p = fitPrefsSlot.load();
  return {
    ...(p.maxIterPerParam !== FIT_SOLVER_DEFAULTS.maxIterPerParam ? { max_iter_per_param: p.maxIterPerParam } : {}),
    ...(p.tolFun !== FIT_SOLVER_DEFAULTS.tolFun ? { tol_fun: p.tolFun } : {}),
    ...(p.tolX !== FIT_SOLVER_DEFAULTS.tolX ? { tol_x: p.tolX } : {}),
  };
}

export function bootstrapCap(): number {
  return fitPrefsSlot.load().bootstrapCap;
}

export function saveBootstrapCap(n: number): void {
  const v = validBootstrapCap(n);
  if (v !== null) fitPrefsSlot.save({ ...fitPrefsSlot.load(), bootstrapCap: v });
}

/** The refusal shown when a request asks for more replicates than the cap. */
export function bootstrapCapMessage(cap: number): string {
  return `at most ${cap.toLocaleString("en-US")} bootstrap replicates (Preferences ▸ Fitting)`;
}
