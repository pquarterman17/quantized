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

// A slot (lib/prefSlots.ts): localStorage plus the server prefs file.
export const fitPrefsSlot = definePrefSlot(FIT_PREFS_KEY, { bootstrapCap: BOOTSTRAP_CAP_DEFAULT }, (p) => ({
  bootstrapCap: (typeof p.bootstrapCap === "number" && validBootstrapCap(p.bootstrapCap)) || BOOTSTRAP_CAP_DEFAULT,
}));

export function bootstrapCap(): number {
  return fitPrefsSlot.load().bootstrapCap;
}

export function saveBootstrapCap(n: number): void {
  const v = validBootstrapCap(n);
  if (v !== null) fitPrefsSlot.save({ bootstrapCap: v });
}

/** The refusal shown when a request asks for more replicates than the cap. */
export function bootstrapCapMessage(cap: number): string {
  return `at most ${cap.toLocaleString("en-US")} bootstrap replicates (Preferences ▸ Fitting)`;
}
