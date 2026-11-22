// One surface fit from plain columns, for Surface fit's worksheet batch and its
// By levels. Start values are auto-guessed for EACH input (the panel's typed
// start values describe the active worksheet's scale, not another sheet's or
// level's); the model and the bounds are the panel's.

import { surfaceFit, surfaceGuess, type SurfaceModelInfo } from "../../../lib/api/analysisExtras";
import { parseField } from "../analysisextras/columnPicks";

export interface SurfaceBounds {
  lower: (number | null)[];
  upper: (number | null)[];
}

/** The panel's bound fields as numbers (null = none), or why they are unusable. */
export function parseBounds(lower: readonly string[], upper: readonly string[]): SurfaceBounds | string {
  const lo = lower.map(parseField);
  const hi = upper.map(parseField);
  if ([...lo, ...hi].some((v) => v !== null && Number.isNaN(v))) return "A bound is not a number (leave it empty for no bound).";
  return { lower: lo, upper: hi };
}

export const surfaceSummaryHeaders = (model: SurfaceModelInfo): string[] => [...model.param_names, "R²", "RMSE", "N points"];

export async function fitSurfaceColumns(
  cols: readonly number[][],
  model: SurfaceModelInfo,
  bounds: SurfaceBounds,
): Promise<{ values: (number | null)[]; warnings: string[] }> {
  const [x, y, z] = cols as [number[], number[], number[]];
  if (x.length < model.param_names.length) {
    throw new Error(`not enough finite points (n=${x.length}) for ${model.param_names.length} parameters`);
  }
  const guess = await surfaceGuess({ x, y, z, model: model.name });
  const result = await surfaceFit({ x, y, z, model: model.name, p0: guess.p0, lower: bounds.lower, upper: bounds.upper });
  const warnings: string[] = [];
  if (result.exit_flag === 0) warnings.push("The optimiser stopped at its iteration limit; the fit may not have converged.");
  if (result.dof <= 0) warnings.push("Not enough points for standard errors.");
  return { values: [...result.params, result.r2, result.rmse, result.n_points], warnings };
}
