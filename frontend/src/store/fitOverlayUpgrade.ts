// The fit slot at FULL resolution before anything that keeps or ships it (P4
// phase 2, lib/fitCurve.ts). A large Curve Fit draws a display curve; an
// export, a copy or a Snapshot-to-window first swaps it for the same curve at
// every fitted row (by id, or evaluated from its parameters when the id is
// gone), so what leaves the canvas is the fit itself, not its thinned picture.
// LAZY: eager callers reach it through a dynamic import, only when the slot
// holds a display curve -- and it imports its own lazy dependencies on use,
// so the eager call site's preload list stays one chunk long.

import { readLivePlotSnapshot } from "../lib/plotsnapshot";
import { asRestore } from "./autosaveTrigger";
import { useApp } from "./useApp";

/** Swap a display curve in the fit slot for its full-resolution copy. The
 *  same curve, so not an edit (asRestore); a no-op when the slot changed
 *  meanwhile. Resolves true when the slot now holds no display curve. */
export async function upgradeFitOverlay(): Promise<boolean> {
  const cur = useApp.getState().fitOverlay;
  if (!cur?.full) return true;
  const [{ fullFitOverlay }, own] = await Promise.all([import("../lib/fitCurve"), import("./curveFitOverlay")]);
  const full = await fullFitOverlay(cur);
  if (useApp.getState().fitOverlay !== cur) return !useApp.getState().fitOverlay?.full;
  if (own.isCurveFitOverlay(cur)) own.rememberCurveFitOverlay(full); // its band toggle still owns it
  asRestore(() => useApp.getState().setFitOverlay(full));
  return true;
}

const frame = (): Promise<void> => new Promise((done) => setTimeout(done, 16));

/** Upgrade, wait for the canvas to publish the upgraded payload (bounded),
 *  then run `snapshot` (Snapshot to New Window freezes the PUBLISHED payload,
 *  lib/plotsnapshot). On failure it says so and freezes nothing. */
export async function snapshotAfterUpgrade(snapshot: () => void): Promise<void> {
  const before = readLivePlotSnapshot();
  try {
    if (!(await upgradeFitOverlay())) throw new Error("the fit curve changed");
  } catch (e) {
    useApp.getState().setStatus(`snapshot not taken: the full-resolution fit could not be loaded (${e instanceof Error ? e.message : "error"})`, "danger");
    return;
  }
  for (let i = 0; i < 60 && readLivePlotSnapshot() === before; i++) await frame();
  if (useApp.getState().fitOverlay?.full) return; // a new display fit landed meanwhile
  snapshot();
}
