// Pawley refinement: the centering and axis-tie choices its section offers, in
// one place so the selects that render them and the preset adapter that
// accepts them cannot drift.

import type { PawleyCentering, PawleyTie } from "./pawleyInputs";

export const PAWLEY_CENTERING_OPTIONS: readonly { value: PawleyCentering; label: string }[] = [
  { value: "P", label: "Primitive (P)" },
  { value: "F", label: "Face-centered (F)" },
  { value: "I", label: "Body-centered (I)" },
  { value: "A", label: "A-centered" },
  { value: "B", label: "B-centered" },
  { value: "C", label: "C-centered" },
  // The engine applies the obverse rule on HEXAGONAL axes; a rhombohedral-
  // axes cell (a = b = c, α = β = γ ≠ 90°) must be entered as primitive.
  { value: "R", label: "R (hexagonal axes)" },
];

export const PAWLEY_TIE_OPTIONS: readonly { value: PawleyTie; label: string }[] = [
  { value: "abc", label: "Cubic (a = b = c)" },
  { value: "ab", label: "Tetragonal / hexagonal (a = b)" },
  { value: "none", label: "Independent a, b, c" },
];
