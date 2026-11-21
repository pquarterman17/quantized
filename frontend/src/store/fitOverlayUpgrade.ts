// The fit slot at FULL resolution before anything that keeps or ships it (P4
// phase 2, lib/fitCurve.ts). A large Curve Fit draws a display curve; an
// export, a copy or a Snapshot-to-window first swaps it for the same curve at
// every fitted row (by id, or evaluated from its parameters when the id is
// gone), so what leaves the canvas is the fit itself, not its thinned picture.
// LAZY: eager callers reach it through a dynamic import, only when the slot
// holds a display curve -- and it imports its own lazy dependencies on use,
// so the eager call site's preload list stays one chunk long.

import { readLivePlotSnapshot } from "../lib/plotsnapshot";
import type { BaselineOverlay } from "../lib/types";
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

type FullBaseline = () => Promise<(number | null)[]>;
const baselineFull = new WeakMap<BaselineOverlay, FullBaseline>();

/** Record how to fetch the full baseline of a lean preview (`overlay.lean`):
 *  its result id, re-running the request on a miss (baselineCall). Kept off the
 *  overlay itself, which is plain data the store copies and persists. */
export function rememberBaselineFull(overlay: BaselineOverlay, full: FullBaseline): void {
  baselineFull.set(overlay, full);
}

/** The baseline slot's lean preview swapped for the full baseline (the same
 *  curve, so not an edit). Resolves false only when the slot changed to
 *  another lean preview meanwhile. A preview with no way to fetch, or whose
 *  fetch fails, stays lean and a figure drops it with the notice. */
export async function upgradeBaselineOverlay(): Promise<boolean> {
  const cur = useApp.getState().baselineOverlay;
  if (!cur?.lean) return true;
  const fetchFull = baselineFull.get(cur);
  if (!fetchFull) return true;
  let y: (number | null)[];
  try {
    y = await fetchFull();
  } catch {
    return true;
  }
  if (useApp.getState().baselineOverlay !== cur) return !useApp.getState().baselineOverlay?.lean;
  if (y.length !== cur.y.length) return true;
  const { lean: _lean, ...rest } = cur;
  asRestore(() => useApp.getState().setBaselineOverlay({ ...rest, y }));
  return true;
}

/** Everything an export or copy ships at full resolution: the fit's curve and
 *  the baseline. Resolves which slot changed mid-fetch (its new curve is
 *  another display one, so the caller must stop), else null. */
export async function upgradeOverlaysForExport(): Promise<"fit" | "baseline" | null> {
  if (!(await upgradeFitOverlay())) return "fit";
  return (await upgradeBaselineOverlay()) ? null : "baseline";
}

const frame = (): Promise<void> => new Promise((done) => setTimeout(done, 16));

/** Upgrade, wait for the canvas to publish the upgraded payload (bounded),
 *  then run `snapshot` (Snapshot to New Window freezes the PUBLISHED payload,
 *  lib/plotsnapshot). On failure it says so and freezes nothing. */
export async function snapshotAfterUpgrade(snapshot: () => void): Promise<void> {
  const before = readLivePlotSnapshot();
  try {
    const changed = await upgradeOverlaysForExport();
    if (changed) throw new Error(`the ${changed} changed`);
  } catch (e) {
    useApp.getState().setStatus(`snapshot not taken: the full-resolution fit could not be loaded (${e instanceof Error ? e.message : "error"})`, "danger");
    return;
  }
  for (let i = 0; i < 60 && readLivePlotSnapshot() === before; i++) await frame();
  if (useApp.getState().fitOverlay?.full) return; // a new display fit landed meanwhile
  if (useApp.getState().baselineOverlay?.lean) {
    useApp.getState().setStatus("snapshot not taken: the full-resolution baseline could not be loaded", "danger");
    return;
  }
  snapshot();
}
