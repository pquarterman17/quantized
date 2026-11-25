// The Preferences ▸ Fitting solver limits a /fit or /equation/fit body carries
// (lib/fitPrefs.ts `fitSolverFields`). A dynamic import on purpose: the fit
// request paths are eager, the prefs module (ranges, slot, validation) is not,
// and every caller is already async. Defaults add nothing to the body.

export async function fitSolverExtra(path: string): Promise<Record<string, number>> {
  return (await import("./fitPrefs")).fitSolverFields(path);
}
