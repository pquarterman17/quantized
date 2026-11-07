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

/** Atomic angle atom1-vertex-atom3 from fractional unit-cell coordinates.
 *  Neighbours use their nearest periodic images unless explicitly disabled.
 *  `ambiguous`/`warnings` flag a neighbour that sits exactly (within
 *  tolerance) on a periodic-image boundary: the chosen image is still
 *  deterministic, but a genuinely different image would be equally valid. */
export function crystalBondAngle(body: {
  a: number;
  b: number;
  c: number;
  alpha?: number;
  beta?: number;
  gamma?: number;
  atom1: [number, number, number];
  vertex: [number, number, number];
  atom3: [number, number, number];
  minimum_image?: boolean;
}): Promise<{
  angle_deg: number;
  distance1: number;
  distance3: number;
  image1: [number, number, number];
  image3: [number, number, number];
  ambiguous: boolean;
  warnings: string[];
}> {
  return postJSON("/api/crystallography/bond-angle", body);
}

/** Allowed (hkl) reflections with d, 2θ and multiplicity (calc.crystal.planeSpacings).
 *  `two_theta` entries are `null` for reflections unreachable at `wavelength`
 *  (λ/2d > 1). `max_hkl` is 1–10, as on the MATLAB card. */
export function crystalPlaneSpacings(body: {
  a: number;
  b?: number;
  c?: number;
  alpha?: number;
  beta?: number;
  gamma?: number;
  max_hkl: number;
  wavelength: number;
  centering: string;
}): Promise<{
  hkl: [number, number, number][];
  d: number[];
  two_theta: (number | null)[];
  multiplicity: number[];
  centering: string;
  system: string;
  n_reflections: number;
}> {
  return postJSON("/api/crystallography/plane-spacings", body);
}

/** Atomic number density n = Z/V in atoms/cm³ (calc.crystallography.atomic_density). */
export function crystalAtomicDensity(body: {
  a: number;
  z: number;
  b?: number;
  c?: number;
  alpha?: number;
  beta?: number;
  gamma?: number;
}): Promise<{ density: number; z: number; volume: number }> {
  return postJSON("/api/crystallography/atomic-density", body);
}

/** Film c/a and tetragonal distortion (calc.epitaxial_strain). `c_relaxed`
 *  defaults to `a_relaxed` (cubic bulk) server-side. */
export function crystalTetragonalDistortion(body: {
  a_relaxed: number;
  c_measured: number;
  c_relaxed?: number;
}): Promise<{ c_over_a: number; distortion_pct: number; a_relaxed: number; c_measured: number; c_relaxed: number }> {
  return postJSON("/api/crystallography/tetragonal-distortion", body);
}

/** Out-of-plane strain from biaxial in-plane strain, ε⊥ = −2ν/(1−ν)·ε∥ (calc.epitaxial_strain). */
export function crystalPoissonStrain(body: {
  eps_parallel: number;
  nu: number;
}): Promise<{ eps_perp: number; eps_parallel: number; nu: number }> {
  return postJSON("/api/crystallography/poisson-strain", body);
}
