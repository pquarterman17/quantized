// Design of experiments: the option lists of the setup form outside the design
// picker (which lives with the form model in useDoe.ts), in one place so the UI
// that renders them and the preset adapter that accepts them cannot drift.

import type { DoeAlphaChoice, DoeOptModel } from "../../../lib/api/doe";

export const ALPHA_OPTIONS: readonly { value: DoeAlphaChoice; label: string }[] = [
  { value: "rotatable", label: "Rotatable (alpha = F^1/4)" },
  { value: "face_centered", label: "Face-centered (alpha = 1)" },
  { value: "orthogonal", label: "Orthogonal" },
  { value: "custom", label: "Custom…" },
];

/** The block counts the blocking menu offers. */
export const BLOCK_COUNTS: readonly number[] = [1, 2, 4, 8, 16];
export const BLOCK_OPTIONS = BLOCK_COUNTS.map((n) => ({ value: String(n), label: n === 1 ? "No blocks" : `${n} blocks` }));

export const MODEL_OPTIONS: readonly { value: DoeOptModel; label: string }[] = [
  { value: "main", label: "Main effects" },
  { value: "interaction", label: "Main effects + 2-factor interactions" },
  { value: "quadratic", label: "Quadratic (response surface)" },
];

export const METHOD_OPTIONS: readonly { value: "coordinate" | "fedorov"; label: string }[] = [
  { value: "coordinate", label: "Coordinate exchange" },
  { value: "fedorov", label: "Fedorov exchange (candidate grid)" },
];

/** The run counts of a Plackett-Burman design. */
export const PB_RUN_COUNTS: readonly number[] = [12, 20, 24];
