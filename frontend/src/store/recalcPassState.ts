// Which touches during a recalc pass are the pass's OWN writes (lane RP).
//
// `touchDataset` used to drop every touch while a pass ran, so the pass's own
// `applyCorrections` writes never re-marked what the pass was recomputing (the
// loop would feed itself). That also dropped a USER edit made mid-pass: a
// derived worksheet the pass had already re-derived from the pre-edit source
// ended the pass "Current" over stale numbers. The pass now says exactly which
// dataset it is writing (`beginPassWrite`/`endPassWrite`, around the one call
// that touches), and any other touch is a user edit: it is queued here and the
// engine replays it through the ordinary `touchDataset` once the pass settles,
// so the recalc mode applies as usual (Auto re-runs, Manual marks, None never
// queues because `touchDataset` returns first).
//
// A Set on both sides: a burst of edits to one dataset is one replay, and the
// replay's debounce coalesces the rest. Pass writes never reach the queue, so
// the replay cannot re-trigger itself.

const writing = new Set<string>();
const queued = new Set<string>();

/** The pass is about to run a write that calls `touchDataset(id)` itself. */
export function beginPassWrite(id: string): void {
  writing.add(id);
}

export function endPassWrite(id: string): void {
  writing.delete(id);
}

/** Record a touch that arrived mid-pass. Returns false (and records nothing)
 *  when it is the pass's own write to `id`. */
export function queueUserTouch(id: string): boolean {
  if (writing.has(id)) return false;
  queued.add(id);
  return true;
}

/** The queued user touches, cleared. Called once when a pass settles. */
export function drainUserTouches(): string[] {
  const ids = [...queued];
  queued.clear();
  writing.clear();
  return ids;
}
