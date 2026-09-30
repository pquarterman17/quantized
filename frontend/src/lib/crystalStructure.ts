// A CIF's crystal structure as a LATTICE PRESET for the XRD tools — pure, no
// React, no store, no fetch.
//
// Why not a dataset: a CIF has no sampled axis (no .time / .values), so it
// never becomes a DataStruct (io/registry.py names .cif a structure format).
// What the XRD tools want from it is the cell: Pawley's starting cell, tie
// and centering, and the Crystal calculator's system + cell for d-spacing
// (hkl indexing). This module derives exactly those from the parsed cell.
//
// Defaults follow the CIF core dictionary: an omitted _cell_angle_* is 90°;
// a length has no default, so a missing one is refused, never guessed.

import type { CrystalStructure, UnitCell } from "./api/structures";

export interface Cell {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
}

/** Pawley's axis tie and lattice centering (reductions/pawleyInputs, usePawley). */
export type LatticeTie = "abc" | "ab" | "none";
export type LatticeCentering = "P" | "F" | "I" | "A" | "B" | "C" | "R";
/** The Crystal calculator's systems (calculators/useCrystalCalc). */
export type CrystalSystem =
  | "cubic" | "tetragonal" | "hexagonal" | "rhombohedral" | "orthorhombic" | "monoclinic" | "triclinic";

export interface LatticePreset {
  cell: Cell;
  tie: LatticeTie;
  /** Null when the CIF names no usable space group: keep the user's choice. */
  centering: LatticeCentering | null;
  system: CrystalSystem;
}

/** True for a file name / path the structure import owns (.cif). */
export function structureFileName(name: string): boolean {
  return /\.cif$/i.test(name);
}

// CIF cells carry ~5 significant digits; 1e-6 relative calls a = b equal
// without calling a genuinely distinct 5.4309 / 5.4310 pair equal.
const eq = (x: number, y: number): boolean => Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
const right = (v: number): boolean => eq(v, 90);

export function crystalSystemOf(c: Cell): CrystalSystem {
  const abEq = eq(c.a, c.b);
  const abcEq = abEq && eq(c.b, c.c);
  const allRight = right(c.alpha) && right(c.beta) && right(c.gamma);
  if (allRight) return abcEq ? "cubic" : abEq ? "tetragonal" : "orthorhombic";
  if (abEq && right(c.alpha) && right(c.beta) && eq(c.gamma, 120)) return "hexagonal";
  if (abcEq && eq(c.alpha, c.beta) && eq(c.beta, c.gamma)) return "rhombohedral";
  if (right(c.alpha) && right(c.gamma)) return "monoclinic";
  return "triclinic";
}

export function pawleyTieOf(c: Cell): LatticeTie {
  if (eq(c.a, c.b)) return eq(c.b, c.c) ? "abc" : "ab";
  return "none";
}

/** The lattice letter of a Hermann-Mauguin symbol. Pawley applies the R
 *  obverse rule on HEXAGONAL axes, so an R group given on rhombohedral axes
 *  (α = β = γ ≠ 90°) is entered as primitive. */
export function centeringOf(spaceGroup: string, c: Cell): LatticeCentering | null {
  const letter = spaceGroup.replace(/^[\s'"_]+/, "").charAt(0).toUpperCase();
  if (letter === "" || !"PFIABCR".includes(letter)) return null;
  if (letter === "R" && crystalSystemOf(c) === "rhombohedral") return "P";
  return letter as LatticeCentering;
}

const length = (v: number | null): v is number => v != null && v > 0;

/** The preset a structure gives the XRD tools, or why it gives none. */
export function latticePreset(s: CrystalStructure): LatticePreset | { error: string } {
  const u: UnitCell = s.cell;
  const { a, b, c } = u;
  if (!length(a)) return { error: "the CIF gives no a length" };
  if (!length(b)) return { error: "the CIF gives no b length" };
  if (!length(c)) return { error: "the CIF gives no c length" };
  const cell: Cell = { a, b, c, alpha: u.alpha ?? 90, beta: u.beta ?? 90, gamma: u.gamma ?? 90 };
  return { cell, tie: pawleyTieOf(cell), centering: centeringOf(s.space_group, cell), system: crystalSystemOf(cell) };
}
