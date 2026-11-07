// Composition endpoint wrappers — `/api/composition/*` (calc.composition):
// weight% <-> atomic% and co-deposition flux ratios. A focused module like
// `api/crystallography.ts`; imported directly by the X-ray tab's
// CompositionCards rather than re-exported through the pinned `lib/api.ts`.

import { postJSON } from "./http";

export interface PercentResult {
  elements: string[];
  weight_pct: number[];
  atomic_pct: number[];
  masses: number[];
}

/** Atomic % -> weight % (inputs are normalised to 100 server-side). */
export function atomicToWeight(elements: string[], values: number[]): Promise<PercentResult> {
  return postJSON("/api/composition/atomic-to-weight", { elements, values });
}

/** Weight % -> atomic % (inputs are normalised to 100 server-side). */
export function weightToAtomic(elements: string[], values: number[]): Promise<PercentResult> {
  return postJSON("/api/composition/weight-to-atomic", { elements, values });
}

/** Relative source fluxes (smallest = 1) to co-deposit `formula` from `sources`.
 *  `warnings` flags a source matching several target cations, a target cation
 *  no source is matched to, or one matched twice. */
export function coDeposition(
  formula: string,
  sources: string[],
): Promise<{ ratios: number[]; needed: number[]; cations: string[]; sources: string[]; warnings: string[] }> {
  return postJSON("/api/composition/co-deposition", { formula, sources });
}
