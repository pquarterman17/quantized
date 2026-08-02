// Crystallography endpoint wrappers — the `/api/crystallography/*` half of
// the typed backend client. Extracted from `lib/api.ts` (hexagonal
// Miller-Bravais support): that file is pinned shrink-only (JMP_GAP #14,
// `architecture.test.ts`), and the added 4-index `i` field would have
// pushed it back over its pin. Same template as `api/plot.ts` — new
// `/api/crystallography/*` wrappers go HERE, not in api.ts.
//
// Re-exported by `lib/api.ts`, so every consumer keeps importing from
// `./lib/api` unchanged.

import { postJSON } from "./http";

/** Interplanar d-spacing from lattice params + Miller indices (calc.crystallography).
 *  Angles (deg) default to 90 server-side; only the low-symmetry systems use them.
 *  `i` is the optional 4-index Miller-Bravais plane index (hexagonal only) —
 *  the backend validates `i === -(h+k)` when present. */
export function crystalDSpacing(body: {
  system: string;
  a: number;
  b: number;
  c: number;
  h: number;
  k: number;
  l: number;
  alpha?: number;
  beta?: number;
  gamma?: number;
  i?: number;
}): Promise<{ d: number; system: string }> {
  return postJSON("/api/crystallography/dspacing", body);
}

/** Unit-cell volume (Å³) + optional molar mass & theoretical density from a
 *  chemical formula and Z (calc.crystallography + calc.formula). */
export function crystalCell(body: {
  a: number;
  b: number;
  c: number;
  alpha?: number;
  beta?: number;
  gamma?: number;
  formula?: string;
  z?: number;
}): Promise<{ volume: number; molar_mass?: number; density?: number }> {
  return postJSON("/api/crystallography/cell", body);
}

/** Angle between two lattice planes (h1k1l1) and (h2k2l2), for any of the
 *  seven crystal systems, via the reciprocal metric tensor (calc.crystallography). */
export function crystalInterplanarAngle(body: {
  system: string;
  a: number;
  b: number;
  c: number;
  h1: number;
  k1: number;
  l1: number;
  h2: number;
  k2: number;
  l2: number;
  alpha?: number;
  beta?: number;
  gamma?: number;
}): Promise<{ angle_deg: number; d1: number; d2: number; system: string }> {
  return postJSON("/api/crystallography/angle", body);
}
