// Calculator material presets, fetched from the backend's own tables
// (calc.semiconductor.material_presets / calc.superconductor.material_presets)
// instead of a hand-mirrored frontend copy. Their own module — not
// api/semiconductor.ts / api/superconductor.ts — so it loads with the lazy
// calculator tabs only, and so those modules' existing test mocks stay whole.

import { getJSON, postJSON } from "./http";

/** 300 K band parameters; a NaN in the backend table arrives as null. */
export interface SemiconductorMaterial {
  name: string;
  Eg: number | null;
  eps_r: number | null;
  me: number | null;
  mh: number | null;
}

/** lambda0 / xi0 in nm, Hc0 in Oe, Tc in K, Delta0 in meV. */
export interface SuperconductorMaterial {
  Tc: number;
  lambda0: number;
  xi0: number;
  Hc0: number;
  Delta0: number;
  type: string;
}

export function semiconductorMaterials(): Promise<{ materials: Record<string, SemiconductorMaterial> }> {
  return getJSON("/api/semiconductor/materials");
}

export function superconductorMaterials(): Promise<{ materials: Record<string, SuperconductorMaterial> }> {
  return postJSON("/api/superconductor/material-presets", {});
}
