// store/packProject.ts's action bodies — split out of the eager store,
// and out of the eager bundle: nothing needs `useApp`/`serializeWorkspace`
// (nor the `desktopPackBridge.ts` wire calls) until the user actually
// starts a pack, so the store `import()`s this on the click (the
// store/relinkCommit.ts precedent — see that module's header for the same
// bundle reasoning). This module also OWNS the 250ms poll loop once
// packing starts: it lives in MODULE scope, not a React effect, so it
// keeps running regardless of whether any component observing
// `usePackProject` is mounted, and stops itself the moment the backend
// reports a terminal phase — never on unmount, because there is no
// mount to tie it to.
//
// The workspace-CONTENT half (what a pack sends, and the refusal when a
// pending book can't be resolved for it) lives in the sibling
// store/packProjectContent.ts — extracted under the .ts size ceiling when
// BUG-011's resolve step landed. `useApp`/`serializeWorkspace` are reached
// through it now, still only inside this lazy chunk.

import {
  CANCELLED,
  packCancel,
  packPreview,
  packReset,
  packStart,
  packStatus,
  pickPackDestination,
  type PackStatus,
} from "../lib/desktopPackBridge";
import {
  packError,
  EMPTY_PACK_PROGRESS,
  type PackProjectError,
  type PackProjectPhase,
  type PackProjectPreview,
  type PackProjectProgress,
  type PackProjectState,
} from "./packProject";
import {
  contentFingerprint,
  deriveProjectName,
  notePackOutcome,
  refusePack,
  serializeCurrentWorkspaceForPack,
} from "./packProjectContent";

import type { PortableManifest } from "../lib/desktopPackBridge";

type Get = () => PackProjectState;
type Set = (partial: Partial<PackProjectState>) => void;

const POLL_INTERVAL_MS = 250;
const THROTTLE_MS = 200;

// BUG-011 round 3 finding #2: round 2's `notePackOutcome` closed the stale
// "…packing…"/"…review the pack preview" transient only for the two
// terminals it was actually caught on (`awaiting_confirmation`, `completed`)
// -- every OTHER way this store reaches `failed` or `cancelled` left
// whichever status line was already standing uncorrected. These two helpers
// are the single choke point for every `failed`/`cancelled` transition in
// this file (both the ones reached directly, and `pollOnce`'s own poll-
// driven ones below), so the closure is now actually universal rather than
// two named exceptions.
function noteFailed(set: Set, errors: PackProjectError[]): void {
  set({ phase: "failed", errors });
  notePackOutcome(errors[0]?.message ?? "pack failed");
}

function noteCancelled(set: Set): void {
  set({ phase: "cancelled" });
  notePackOutcome("pack cancelled — nothing was modified");
}

// -- generation counter (review finding #3) --------------------------------
//
// `runPreviewPackProject` awaits two things in sequence — the native
// folder-dialog promise (`pickPackDestination`) and the preview RPC
// (`packPreview`) — and either one can resolve well after the user already
// cancelled (or reset) from the phase this call started in. Without a
// generation check, that late resolution would silently overwrite the
// `cancelled`/`idle` phase the store already shows with whatever the
// (now-stale) continuation worked out. Every entry point that STARTS a new
// attempt (`runPreviewPackProject`) or explicitly ENDS the current one
// (`runCancelPackProject`, `runResetPackProject`) bumps this counter; a
// continuation that resumes after an `await` with a stale generation bails
// out immediately, touching neither the store nor (for `packPreview`) ever
// having called the bridge with data nobody asked for any more.
//
// BUG-011 REVIEW (2026-09-13): `runStartPackProject`'s own book-resolve
// await needed the identical protection — added there as a bare READ of
// this counter (captured before the await, compared after), never a bump:
// Start doesn't start or end an attempt from this state machine's point of
// view, it only needs to know whether one of the THREE functions above
// (`runPreviewPackProject`/`runCancelPackProject`/`runResetPackProject`)
// bumped the counter while it was waiting.
let generation = 0;

export function bumpGeneration(): number {
  generation += 1;
  return generation;
}

/** Exported for test use only: reset the counter to its initial value,
 *  mirroring `resetThrottle`/`resetPollSequencing`'s own test-reset role. */
export function resetGeneration(): void {
  generation = 0;
}

// -- preview ----------------------------------------------------------

export async function runPreviewPackProject(set: Set, destination?: string): Promise<void> {
  const myGeneration = bumpGeneration();
  // Review finding #2: a re-preview from a TERMINAL phase (retrying after
  // a completed/cancelled/failed run) must not carry the PREVIOUS run's
  // progress/result/cleanup/warnings/errors forward -- `applyStatus`'s own
  // monotonic clamp (`Math.max(current.progress.*, ...)`) would otherwise
  // pin this run's real (lower) numbers to the old run's, and a stale
  // `resultPath` would make this run look already-completed before it is.
  set({
    progress: EMPTY_PACK_PROGRESS,
    warnings: [],
    errors: [],
    resultPath: null,
    cleanupOk: null,
  });
  let destinationParent = destination;
  if (destinationParent === undefined) {
    set({ phase: "selecting_destination" });
    const picked = await pickPackDestination();
    if (generation !== myGeneration) return; // cancelled/reset while the dialog was open
    // `CANCELLED` (the user backed out of the native dialog) degrades the
    // way this store always has — silently back to `idle`, never a
    // rejection. `null` (no usable bridge: the shell lacks the pack methods
    // or the picker threw) is a FAILURE, exactly as `packPreview`'s null is
    // below — otherwise a broken bridge is indistinguishable from the user
    // pressing Cancel and the panel closes with no explanation (PR 6
    // self-review). A backend REFUSAL (review finding #8) is likewise a
    // failure, or a bad destination pick would look like an ordinary cancel.
    if (picked === CANCELLED) {
      // A full reset, not a bare `set({ phase: "idle" })`: a retry after a
      // failed attempt may still hold the EARLIER pick's write-dir grant and
      // a stale backend preview; `pack_reset` clears both, so backing out
      // of the picker leaves no footprint behind (PR 6 self-review).
      await runResetPackProject(set);
      return;
    }
    if (picked === null) {
      noteFailed(set, [packError("bridge_unavailable", "the desktop bridge is unavailable")]);
      return;
    }
    if (typeof picked !== "string") {
      noteFailed(set, [packError("destination_pick_failed", picked.error)]);
      return;
    }
    destinationParent = picked;
  }

  set({ phase: "scanning" });
  const serialized = await serializeCurrentWorkspaceForPack();
  // A third await in this continuation (BUG-011's resolve step), so it needs
  // the same generation check as the two above it — a cancel/reset while a
  // slow book fetch was in flight must not be overwritten by this refusal
  // or by the preview it would otherwise go on to request.
  if (generation !== myGeneration) return;
  if (!serialized.ok) {
    refusePack(set, serialized.message);
    return;
  }
  const content = serialized.content;
  const projectName = deriveProjectName();
  const result = await packPreview(content, projectName, destinationParent);
  if (generation !== myGeneration) return; // cancelled/reset while packPreview was in flight

  if (result === null) {
    noteFailed(set, [packError("bridge_unavailable", "the desktop bridge is unavailable")]);
    return;
  }
  if (!result.ok) {
    noteFailed(set, [packError(result.error.code, result.error.message ?? result.error.code)]);
    return;
  }

  const preview: PackProjectPreview = {
    token: result.token,
    manifest: result.manifest,
    destination: { bundleDir: result.destination.bundle_dir, exists: result.destination.exists },
    warnings: result.warnings,
    blockers: result.blockers,
    content,
    destinationParent,
    projectName,
  };
  set({ phase: "awaiting_confirmation", preview, warnings: result.warnings, errors: [] });
  // Round 2 finding N1/F3: replaces whatever `serializeCurrentWorkspace-
  // ForPack` set above (up to and including its own "…packing…" transient)
  // with a real outcome — the preview is ready to REVIEW, nothing has been
  // copied yet, so "packing" must never be the word left standing here.
  const n = result.manifest.summary.datasets;
  notePackOutcome(`${n} dataset${n === 1 ? "" : "s"} ready — review the pack preview`);
}

// -- start + polling ------------------------------------------------------

let pollTimer: ReturnType<typeof setInterval> | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingApply: (() => void) | null = null;
let lastAppliedAt = -Infinity; // sentinel: no update has landed yet
let lastAppliedKey: string | null = null;

/** Exported for test use only (the module-level throttle bookkeeping has
 *  no other reset hook): clears any pending trailing-edge apply and the
 *  "last applied" watermark, so a test driving `scheduleStatusApply`
 *  directly starts from the same clean state a real `startPolling` call
 *  always establishes before the first tick of a new operation. */
export function resetThrottle(): void {
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  pendingTimer = null;
  pendingApply = null;
  lastAppliedAt = -Infinity;
  lastAppliedKey = null;
}

/** Exported for test use only: stop the 250ms poll interval without going
 *  through a terminal status — lets a test drive ticks manually
 *  (`scheduleStatusApply`) without a concurrent real interval also
 *  calling `packStatus`. */
export function stopPolling(): void {
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
}

function isTerminal(phase: PackProjectPhase | PackStatus["phase"]): boolean {
  return phase === "completed" || phase === "cancelled" || phase === "failed";
}

function statusKey(status: PackStatus): string {
  return JSON.stringify(status);
}

/** Map one polled `PackStatus` onto the store, CLAMPING the two
 *  "progress so far" counters (`bytesCopied`/`completedCount`) so a
 *  misbehaving/out-of-order status can never regress what was already
 *  shown — the frontend's own defense, independent of the backend's
 *  (already-monotonic-in-practice) tick stream. */
function applyStatus(get: Get, set: Set, status: PackStatus): void {
  const current = get();
  const progress: PackProjectProgress = {
    currentFile: status.progress.current_file,
    completedCount: Math.max(current.progress.completedCount, status.progress.completed_files),
    totalCount: status.progress.total_files,
    bytesCopied: Math.max(current.progress.bytesCopied, status.progress.bytes_copied),
    bytesTotal: status.progress.bytes_total,
    stage: status.progress.stage,
  };
  const errors = status.errors.map((e) => packError(e.code, e.message));
  set({
    phase: status.phase,
    progress,
    warnings: status.warnings.length > 0 ? status.warnings : current.warnings,
    errors: errors.length > 0 ? errors : current.errors,
    resultPath: status.result?.bundle_dir ?? current.resultPath,
    cleanupOk: status.cleanup_ok,
  });
}

/** Trailing-edge throttle: at most one store update per `THROTTLE_MS`,
 *  always carrying the LATEST status by the time it fires — never a
 *  no-op re-apply of an identical status. Exported (and driven entirely by
 *  the CALLER-supplied `now`, never `Date.now()` internally) so a test can
 *  drive it directly, deterministically, without racing either the real
 *  250ms poll interval or wall-clock time. */
export function scheduleStatusApply(get: Get, set: Set, status: PackStatus, now: number): void {
  const key = statusKey(status);
  if (key === lastAppliedKey) return;
  const elapsed = now - lastAppliedAt; // +Infinity before the first apply -> always immediate
  const apply = (appliedAt: number): void => {
    lastAppliedAt = appliedAt;
    lastAppliedKey = key;
    applyStatus(get, set, status);
  };
  if (elapsed >= THROTTLE_MS) {
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    pendingTimer = null;
    pendingApply = null;
    apply(now);
    return;
  }
  pendingApply = () => apply(now + (THROTTLE_MS - elapsed));
  if (pendingTimer === null) {
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      const fn = pendingApply;
      pendingApply = null;
      if (fn) fn();
    }, THROTTLE_MS - elapsed);
  }
}

// -- overlapping-poll ordering (review finding #4) -------------------------
//
// `pollOnce` awaits `packStatus()` (a real IPC round trip), and the 250ms
// interval can dispatch a NEXT tick before a slow one resolves — two
// `packStatus()` calls in flight at once, with no guarantee they resolve in
// dispatch order. Each dispatch gets a strictly increasing sequence number;
// a response numbered lower than the last one actually APPLIED is a stale
// straggler and is dropped outright, and once any response has reported a
// TERMINAL phase, every later-resolving response (regardless of its own
// sequence number — it raced the terminal one and lost) is dropped too, so
// a `completed` the store already shows can never be overwritten by a
// `packing` that merely happened to still be in flight.
let pollSeq = 0;
let lastAppliedSeq = -1;
let terminalReached = false;

/** Exported for test use only: reset the sequencing bookkeeping above,
 *  mirroring `resetThrottle`/`stopPolling`'s own test-reset role. */
export function resetPollSequencing(): void {
  pollSeq = 0;
  lastAppliedSeq = -1;
  terminalReached = false;
}

/** Exported for test use only: drive one poll tick directly, without a real
 *  250ms interval, so a test can control exactly when each `packStatus()`
 *  call resolves relative to another. */
export async function pollOnce(get: Get, set: Set): Promise<void> {
  const seq = ++pollSeq;
  const status = await packStatus();
  if (terminalReached) return; // a terminal phase already won this run
  if (status === null) {
    stopPolling();
    terminalReached = true;
    noteFailed(set, [packError("bridge_unavailable", "the desktop bridge is unavailable")]);
    return;
  }
  if (seq < lastAppliedSeq) return; // an older in-flight response landed late
  lastAppliedSeq = seq;
  scheduleStatusApply(get, set, status, Date.now());
  if (isTerminal(status.phase)) {
    terminalReached = true;
    stopPolling();
    // Round 2 finding N1/F3 (widened round 3 finding #2 to cover every
    // terminal, not only `completed`): the panel's own completed view
    // already knows the dataset count (`preview.manifest.summary.datasets`)
    // and destination (`status.result.bundle_dir`); this is that same
    // information, just also on the app-wide status line rather than only
    // inside the panel. `failed`/`cancelled` get the same treatment now --
    // `scheduleStatusApply` just wrote `status.errors` into the store above,
    // so a real reason is always available for `failed`.
    if (status.phase === "completed") {
      const n = get().preview?.manifest.summary.datasets;
      const where = status.result?.bundle_dir;
      notePackOutcome(
        where
          ? `packed ${n !== undefined ? `${n} dataset${n === 1 ? "" : "s"}` : "project"} to ${where}`
          : "pack completed",
      );
    } else if (status.phase === "failed") {
      notePackOutcome(status.errors[0]?.message ?? "pack failed");
    } else {
      notePackOutcome("pack cancelled — nothing was modified");
    }
  }
}

function startPolling(get: Get, set: Set): void {
  stopPolling();
  resetThrottle();
  resetPollSequencing();
  // Review finding #2: the same reset `runPreviewPackProject` already does
  // (see its own doc), repeated here right before the first real poll tick
  // so any future call path into `startPolling` that skips a fresh preview
  // still starts this run's progress/result/cleanup/warnings/errors clean.
  set({
    progress: EMPTY_PACK_PROGRESS,
    warnings: [],
    errors: [],
    resultPath: null,
    cleanupOk: null,
  });
  pollTimer = setInterval(() => {
    void pollOnce(get, set);
  }, POLL_INTERVAL_MS);
}

/** `approvedManifest` must be REFERENCE-IDENTICAL to `preview.manifest` —
 *  a fresh preview (a re-preview, or one against a different destination)
 *  always creates a brand-new manifest object, so identity is exactly
 *  "is this still the plan the store currently holds", with no separate
 *  hash to keep in sync. A fresh re-serialization compared via
 *  `contentFingerprint` (never a raw string compare — see that function's
 *  doc) catches the OTHER staleness case: the project itself changed
 *  since preview, even though the manifest reference is still current.
 *  Either mismatch rejects LOCALLY — the bridge is never called with data
 *  the store itself already knows is stale, and so does a book that can no
 *  longer be fetched (BUG-011's refusal). When nothing changed, the
 *  EXACT `preview.content` string (not a fresh re-serialization) is what
 *  goes to `pack_start` — byte-identical to what `pack_preview` sent,
 *  which is what lets the backend's own `sha256(content)` check pass
 *  trivially rather than racing a live `savedAt` stamp. */
export async function runStartPackProject(get: Get, set: Set, approvedManifest: PortableManifest): Promise<void> {
  const preview = get().preview;
  if (preview === null || approvedManifest !== preview.manifest) {
    noteFailed(set, [packError("stale_preview", "the reviewed plan is no longer current — preview again")]);
    return;
  }
  // Review finding #1: `serializeCurrentWorkspaceForPack` below awaits a
  // book fetch just like `runPreviewPackProject`'s own resolve step does,
  // and this continuation needs the same protection against a cancel/reset
  // that races it -- captured BEFORE the await, alongside `preview` above
  // (also captured before it). Unlike `runCancelPackProject`/
  // `runResetPackProject`/`runPreviewPackProject`, Start does NOT bump the
  // counter itself: it isn't starting or ending an attempt from the state
  // machine's point of view, it only needs to know whether ONE OF THOSE did
  // while it was waiting.
  const myGeneration = generation;
  const serialized = await serializeCurrentWorkspaceForPack();
  // A cancel/reset while the book fetch was in flight bumps `generation`
  // (and a reset also clears `preview`) -- either means this continuation
  // is answering a question nobody is asking any more: it must touch
  // neither the store nor the bridge, exactly like the two checks in
  // `runPreviewPackProject` above guard ITS awaits.
  if (generation !== myGeneration || get().preview !== preview) return;
  if (!serialized.ok) {
    refusePack(set, serialized.message);
    return;
  }
  const fresh = serialized.content;
  if (contentFingerprint(fresh) !== contentFingerprint(preview.content)) {
    noteFailed(set, [packError("stale_preview", "the project changed since preview — preview again")]);
    return;
  }

  set({ phase: "packing" });
  const result = await packStart(preview.token, preview.content);
  if (result === null) {
    noteFailed(set, [packError("bridge_unavailable", "the desktop bridge is unavailable")]);
    return;
  }
  if (!result.ok) {
    const code = result.error?.code ?? "pack_failed";
    noteFailed(set, [packError(code, result.error?.message ?? code)]);
    return;
  }
  startPolling(get, set);
}

// -- cancel / reset -------------------------------------------------------

export async function runCancelPackProject(set: Set, phase: PackProjectPhase): Promise<void> {
  // Review finding #3: invalidate any `runPreviewPackProject` continuation
  // still awaiting the folder dialog or `packPreview` — see the generation
  // counter's own doc above.
  bumpGeneration();
  if (phase === "selecting_destination" || phase === "scanning" || phase === "awaiting_confirmation") {
    // Round 3 finding #2: this is `cancelled`'s OWN branch -- it never goes
    // through `pollOnce`'s poll-driven terminal handling below, so it needs
    // its own `notePackOutcome` call to close the same stale-status hole.
    noteCancelled(set);
    return;
  }
  // "packing" or already "cancelling" -- `pack_cancel` is idempotent
  // backend-side, so re-issuing it from "cancelling" is harmless.
  set({ phase: "cancelling" });
  const result = await packCancel();
  if (result === null) {
    stopPolling();
    noteFailed(set, [packError("bridge_unavailable", "the desktop bridge is unavailable")]);
    return;
  }
  // The final phase (cancelled, or a completion that raced the cancel)
  // resolves through the ALREADY-RUNNING poll loop -- nothing more here.
}

export async function runResetPackProject(set: Set): Promise<void> {
  // Review finding #3: same invalidation as `runCancelPackProject` — a
  // reset ends the current attempt just as definitively as a cancel does.
  bumpGeneration();
  stopPolling();
  resetThrottle();
  resetPollSequencing();
  await packReset(); // best-effort: a terminal LOCAL phase means nothing backend-side needs protecting
  set({
    phase: "idle",
    progress: EMPTY_PACK_PROGRESS,
    warnings: [],
    errors: [],
    resultPath: null,
    cleanupOk: null,
    preview: null,
    lastRejected: null,
  });
}
