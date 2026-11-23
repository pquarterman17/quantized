// The X unit a ranged filter / spectrogram recipe was recorded for. Their numbers are in X
// units: xMin / xMax absolutely, a convolve / deconvolve `fwhm`, the spectrogram's frequency
// axis (per X unit). Replaying one on a worksheet whose X unit differs would silently run a
// different analysis, so the recorded unit is checked (recipe preflight + the transform
// runner), as the Signal Processing recipes already do (signalRecipe.signalInputUnit).
// Pure leaf: imported by recipeExpect and the lazy transform modules.

const present = (v: unknown): boolean => v !== undefined && v !== null && v !== "";

/** Whether a recorded `sigop` / `spectrogram` step's numbers depend on the X unit. */
export function stepNeedsXUnit(params: Readonly<Record<string, unknown>>): boolean {
  if (params.op === "spectrogram") return true;
  if (params.op !== "sigop") return false;
  const args = (params.args ?? {}) as Record<string, unknown>;
  return present(args.xMin) || present(args.xMax) ||
    ((params.method === "convolve" || params.method === "deconvolve") && present(args.fwhm));
}

/** The recorded X unit of a `sigop` / `spectrogram` step (trimmed), or undefined when not recorded. */
export function stepXUnit(params: Readonly<Record<string, unknown>>): string | undefined {
  return typeof params.xUnit === "string" ? params.xUnit.trim() : undefined;
}

/** Throw when a step recorded for one X unit meets another. */
export function assertStepXUnit(params: Readonly<Record<string, unknown>>, actualUnit: string): void {
  const expected = stepXUnit(params);
  if (expected === undefined || !stepNeedsXUnit(params)) return;
  if (actualUnit.trim() !== expected) {
    throw new Error(`this step was recorded for X in ${expected || "an unknown unit"} but the worksheet's X is in ${actualUnit.trim() || "an unknown unit"}; its X range, width and frequency axis would mean something else`);
  }
}
