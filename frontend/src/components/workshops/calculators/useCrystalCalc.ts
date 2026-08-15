// Calculators — Crystallography domain hook (extracted from useCalculators.ts,
// DIRACULATOR_AUDIT P3 split): d-spacing from lattice + Miller indices
// (/api/crystallography/d-spacing) and cell volume / theoretical density
// (/api/crystallography/cell). Carries the P1 provenance contract, with
// field-aware invalidation: a form edit invalidates exactly the results that
// depend on it — hkl feed only the d-spacing, formula/Z feed only the cell,
// the lattice (system/lengths/angles) feeds both.

import { useRef, useState } from "react";

import { crystalCell, crystalDSpacing } from "../../../lib/api";
import { fmtNum } from "../../../lib/format";
import { useCalcHistory } from "../../../store/calcHistory";

export type CellAngle = "alpha" | "beta" | "gamma";

/** Crystal systems for the d-spacing calculator: the lattice lengths (beyond `a`)
 *  and the lattice angles each one needs shown in the form. (`a` is always shown;
 *  hexagonal fixes γ=120 implicitly, rhombohedral sets α=β=γ.) */
export const CRYSTAL_SYSTEMS: {
  value: string;
  label: string;
  lengths: ("b" | "c")[];
  angles: CellAngle[];
}[] = [
  { value: "cubic", label: "Cubic", lengths: [], angles: [] },
  { value: "tetragonal", label: "Tetragonal", lengths: ["c"], angles: [] },
  { value: "hexagonal", label: "Hexagonal", lengths: ["c"], angles: [] },
  { value: "rhombohedral", label: "Rhombohedral", lengths: [], angles: ["alpha"] },
  { value: "orthorhombic", label: "Orthorhombic", lengths: ["b", "c"], angles: [] },
  { value: "monoclinic", label: "Monoclinic", lengths: ["b", "c"], angles: ["beta"] },
  { value: "triclinic", label: "Triclinic", lengths: ["b", "c"], angles: ["alpha", "beta", "gamma"] },
];

export interface CrystalForm {
  system: string;
  a: string;
  b: string;
  c: string;
  alpha: string;
  beta: string;
  gamma: string;
  h: string;
  k: string;
  l: string;
  formula: string;
  z: string;
}

/** Resolve the full cell (lengths + angles, numeric) from the form + the active
 *  system: unused lengths default to `a`; unused angles to 90; hexagonal fixes
 *  γ=120 and rhombohedral sets α=β=γ. Throws on a non-numeric field. */
export function assembleCell(f: CrystalForm): {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
} {
  const spec = CRYSTAL_SYSTEMS.find((s) => s.value === f.system);
  const num = (s: string, label: string): number => {
    const v = Number(s);
    if (!Number.isFinite(v)) throw new Error(`enter a numeric ${label}`);
    return v;
  };
  const a = num(f.a, "a");
  const b = spec?.lengths.includes("b") ? num(f.b, "b") : a;
  const c = spec?.lengths.includes("c") ? num(f.c, "c") : a;
  const alpha = spec?.angles.includes("alpha") ? num(f.alpha, "α") : 90;
  let beta = spec?.angles.includes("beta") ? num(f.beta, "β") : 90;
  let gamma = spec?.angles.includes("gamma") ? num(f.gamma, "γ") : 90;
  if (f.system === "hexagonal") gamma = 120;
  if (f.system === "rhombohedral") {
    beta = alpha;
    gamma = alpha;
  }
  return { a, b, c, alpha, beta, gamma };
}

// Which results each form field feeds (the lattice feeds both): hkl are
// d-spacing-only, formula/Z are cell-only. Drives field-aware invalidation.
const D_SPACING_KEYS = new Set<keyof CrystalForm>([
  "system", "a", "b", "c", "alpha", "beta", "gamma", "h", "k", "l",
]);
const CELL_KEYS = new Set<keyof CrystalForm>([
  "system", "a", "b", "c", "alpha", "beta", "gamma", "formula", "z",
]);

export interface CrystalCalcState {
  crystal: CrystalForm;
  crResult: { d: number; system: string } | null;
  crError: string | null;
  crBusy: boolean;
  updCrystal: (patch: Partial<CrystalForm>) => void;
  crCompute: () => Promise<void>;
  cellResult: { volume: number; molar_mass?: number; density?: number } | null;
  cellError: string | null;
  cellBusy: boolean;
  cellCompute: () => Promise<void>;
}

export function useCrystalCalc(): CrystalCalcState {
  const [crystal, setCrystal] = useState<CrystalForm>({
    system: "cubic", a: "5.4309", b: "5.4309", c: "5.4309",
    alpha: "90", beta: "90", gamma: "90", h: "1", k: "1", l: "1",
    formula: "Si", z: "8",
  });
  const [crResult, setCrResult] = useState<{ d: number; system: string } | null>(null);
  const [crError, setCrError] = useState<string | null>(null);
  const [crBusy, setCrBusy] = useState(false);
  const [cellResult, setCellResult] = useState<
    { volume: number; molar_mass?: number; density?: number } | null
  >(null);
  const [cellError, setCellError] = useState<string | null>(null);
  const [cellBusy, setCellBusy] = useState(false);
  const crSeq = useRef(0);
  const cellSeq = useRef(0);

  const invalidateCr = (): void => {
    crSeq.current++;
    setCrResult(null);
    setCrError(null);
    setCrBusy(false);
  };
  const invalidateCell = (): void => {
    cellSeq.current++;
    setCellResult(null);
    setCellError(null);
    setCellBusy(false);
  };

  const updCrystal = (patch: Partial<CrystalForm>): void => {
    setCrystal((s) => ({ ...s, ...patch }));
    const keys = Object.keys(patch) as (keyof CrystalForm)[];
    if (keys.some((k) => D_SPACING_KEYS.has(k))) invalidateCr();
    if (keys.some((k) => CELL_KEYS.has(k))) invalidateCell();
  };

  async function crCompute(): Promise<void> {
    const id = ++crSeq.current;
    setCrBusy(true);
    setCrError(null);
    try {
      const cell = assembleCell(crystal);
      const h = Number(crystal.h);
      const k = Number(crystal.k);
      const l = Number(crystal.l);
      if ([h, k, l].some((v) => !Number.isFinite(v))) {
        throw new Error("enter numeric Miller indices");
      }
      // Hexagonal also carries the derived 4-index Miller-Bravais i = -(h+k)
      // (backend re-validates it); every other system omits it.
      const i = crystal.system === "hexagonal" ? -(h + k) : undefined;
      const r = await crystalDSpacing({
        system: crystal.system,
        ...cell,
        h,
        k,
        l,
        ...(i !== undefined ? { i } : {}),
      });
      if (crSeq.current !== id) return; // superseded — a newer run/edit owns this panel
      setCrResult(r);
      useCalcHistory.getState().record({
        domain: "Crystal",
        label: "d-spacing",
        summary: `d = ${fmtNum(r.d)} Å (${r.system}, hkl=${h} ${k} ${l})`,
      });
    } catch (e) {
      if (crSeq.current !== id) return;
      setCrResult(null);
      setCrError(e instanceof Error ? e.message : "calculation failed");
    } finally {
      if (crSeq.current === id) setCrBusy(false);
    }
  }

  async function cellCompute(): Promise<void> {
    const id = ++cellSeq.current;
    setCellBusy(true);
    setCellError(null);
    try {
      const cell = assembleCell(crystal);
      const formula = crystal.formula.trim();
      const z = Number(crystal.z);
      if (formula && !(Number.isFinite(z) && z >= 1)) {
        throw new Error("Z must be an integer ≥ 1");
      }
      const r = await crystalCell({ ...cell, ...(formula ? { formula, z } : {}) });
      if (cellSeq.current !== id) return;
      setCellResult(r);
      useCalcHistory.getState().record({
        domain: "Crystal",
        label: "Cell volume & density",
        summary:
          `V = ${fmtNum(r.volume)} Å³` +
          (r.density != null ? ` · ρ = ${fmtNum(r.density)} g/cm³` : ""),
      });
    } catch (e) {
      if (cellSeq.current !== id) return;
      setCellResult(null);
      setCellError(e instanceof Error ? e.message : "calculation failed");
    } finally {
      if (cellSeq.current === id) setCellBusy(false);
    }
  }

  return {
    crystal,
    crResult,
    crError,
    crBusy,
    updCrystal,
    crCompute,
    cellResult,
    cellError,
    cellBusy,
    cellCompute,
  };
}
