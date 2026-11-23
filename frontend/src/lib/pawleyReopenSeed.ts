// "Open in Pawley refinement" (OPEN_ITEMS row 12): the recorded settings of a
// Pawley output, read back strictly. FAIL CLOSED: null unless EVERY setting is
// present and of the right type (a partial record is never seeded). The
// starting cell is the one the refinement STARTED from (`cellInitial`, as the
// backend echoed it), not the refined one. The picked intensity column is
// proved by `extra.picks` (lib/reductionsReopenSeed.ts). Lazy: imported by the
// Pawley hook and the lazy opener (store/toolReopenPicks.ts) only.

import type { ReopenSeed } from "./committedOutputReopen";

const TIES = ["abc", "ab", "none"] as const;
const CENTERINGS = ["P", "F", "I", "A", "B", "C", "R"] as const;

export interface PawleySeed {
  col: number;
  tie: (typeof TIES)[number];
  symmetry: (typeof CENTERINGS)[number];
  refineCell: boolean;
  wavelength: number;
  fwhm: number;
  /** The starting cell as the text fields hold it. */
  cell: { a: string; b: string; c: string; alpha: string; beta: string; gamma: string };
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value);

export function pawleySeed(s: ReopenSeed | null | undefined): PawleySeed | null {
  if (!s) return null;
  const { col, tie, symmetry, refineCell, wavelength, fwhm, cellInitial } = s;
  if (!isNumber(col) || !oneOf(tie, TIES) || !oneOf(symmetry, CENTERINGS) || typeof refineCell !== "boolean"
    || !isNumber(wavelength) || !isNumber(fwhm)) return null;
  if (!Array.isArray(cellInitial) || cellInitial.length !== 6 || !cellInitial.every(isNumber)) return null;
  const [a, b, c, alpha, beta, gamma] = (cellInitial as number[]).map(String) as [string, string, string, string, string, string];
  return { col, tie, symmetry, refineCell, wavelength, fwhm, cell: { a, b, c, alpha, beta, gamma } };
}
