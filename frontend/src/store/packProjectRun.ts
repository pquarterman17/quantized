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

import {
  packCancel,
  packPreview,
  packReset,
  packStart,
  packStatus,
  pickPackDestination,
  type PackStatus,
} from "../lib/desktopPackBridge";
import { serializeWorkspace } from "../lib/workspaceSerialize";
import {
  packError,
  EMPTY_PACK_PROGRESS,
  type PackProjectPhase,
  type PackProjectPreview,
  type PackProjectProgress,
  type PackProjectState,
} from "./packProject";
import { useApp } from "./useApp";

import type { PortableManifest } from "../lib/desktopPackBridge";

type Get = () => PackProjectState;
type Set = (partial: Partial<PackProjectState>) => void;

const POLL_INTERVAL_MS = 250;
const THROTTLE_MS = 200;

// -- workspace content (shared by preview + start, so they can only ever
// disagree because the project actually changed in between) --------------

function serializeCurrentWorkspaceForPack(): string {
  const s = useApp.getState();
  // No `projectDir` here on purpose: the content sent to the backend
  // always names its ORIGINAL absolute source paths (`kind: "path"`) —
  // `pack_project`'s own `rewrite_payload_for_bundle` is what turns the
  // packed sources into `kind: "bundle"` entries; this is a different
  // concern from a native Save's own bundle-relative round trip.
  return serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
}

function deriveProjectName(): string {
  const name = useApp.getState().currentProject?.name;
  if (!name) return "workspace";
  return name.replace(/\.(dwk|json)$/i, "") || "workspace";
}

/** A comparable fingerprint of serialized workspace content that ignores
 *  `serializeWorkspace`'s own `savedAt` stamp — `savedAt` is a FRESH
 *  timestamp on every single call, so a raw string compare between two
 *  serializations of the IDENTICAL workspace would always read as
 *  "changed" purely from the clock, never actually detecting a real edit.
 *  Never throws: malformed input (never produced by our own serializer,
 *  but defensive regardless) falls back to the raw string, which still
 *  degrades safely to "treat as different" rather than crashing. */
function contentFingerprint(content: string): string {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    delete parsed.savedAt;
    return JSON.stringify(parsed);
  } catch {
    return content;
  }
}

// -- preview ----------------------------------------------------------

export async function runPreviewPackProject(set: Set, destination?: string): Promise<void> {
  let destinationParent = destination;
  if (destinationParent === undefined) {
    set({ phase: "selecting_destination" });
    const picked = await pickPackDestination();
    if (picked === null) {
      set({ phase: "idle" }); // backed out of the dialog -- not a rejection
      return;
    }
    destinationParent = picked;
  }

  set({ phase: "scanning" });
  const content = serializeCurrentWorkspaceForPack();
  const projectName = deriveProjectName();
  const result = await packPreview(content, projectName, destinationParent);

  if (result === null) {
    set({ phase: "failed", errors: [packError("bridge_unavailable", "the desktop bridge is unavailable")] });
    return;
  }
  if (!result.ok) {
    set({ phase: "failed", errors: [packError(result.error.code, result.error.message ?? result.error.code)] });
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

async function pollOnce(get: Get, set: Set): Promise<void> {
  const status = await packStatus();
  if (status === null) {
    stopPolling();
    set({ phase: "failed", errors: [packError("bridge_unavailable", "the desktop bridge is unavailable")] });
    return;
  }
  scheduleStatusApply(get, set, status, Date.now());
  if (isTerminal(status.phase)) stopPolling();
}

function startPolling(get: Get, set: Set): void {
  stopPolling();
  resetThrottle();
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
 *  the store itself already knows is stale. When nothing changed, the
 *  EXACT `preview.content` string (not a fresh re-serialization) is what
 *  goes to `pack_start` — byte-identical to what `pack_preview` sent,
 *  which is what lets the backend's own `sha256(content)` check pass
 *  trivially rather than racing a live `savedAt` stamp. */
export async function runStartPackProject(get: Get, set: Set, approvedManifest: PortableManifest): Promise<void> {
  const preview = get().preview;
  if (preview === null || approvedManifest !== preview.manifest) {
    set({
      phase: "failed",
      errors: [packError("stale_preview", "the reviewed plan is no longer current — preview again")],
    });
    return;
  }
  const fresh = serializeCurrentWorkspaceForPack();
  if (contentFingerprint(fresh) !== contentFingerprint(preview.content)) {
    set({
      phase: "failed",
      errors: [packError("stale_preview", "the project changed since preview — preview again")],
    });
    return;
  }

  set({ phase: "packing" });
  const result = await packStart(preview.token, preview.content);
  if (result === null) {
    set({ phase: "failed", errors: [packError("bridge_unavailable", "the desktop bridge is unavailable")] });
    return;
  }
  if (!result.ok) {
    const code = result.error?.code ?? "pack_failed";
    set({ phase: "failed", errors: [packError(code, result.error?.message ?? code)] });
    return;
  }
  startPolling(get, set);
}

// -- cancel / reset -------------------------------------------------------

export async function runCancelPackProject(set: Set, phase: PackProjectPhase): Promise<void> {
  if (phase === "selecting_destination" || phase === "scanning" || phase === "awaiting_confirmation") {
    set({ phase: "cancelled" });
    return;
  }
  // "packing" or already "cancelling" -- `pack_cancel` is idempotent
  // backend-side, so re-issuing it from "cancelling" is harmless.
  set({ phase: "cancelling" });
  const result = await packCancel();
  if (result === null) {
    stopPolling();
    set({ phase: "failed", errors: [packError("bridge_unavailable", "the desktop bridge is unavailable")] });
    return;
  }
  // The final phase (cancelled, or a completion that raced the cancel)
  // resolves through the ALREADY-RUNNING poll loop -- nothing more here.
}

export async function runResetPackProject(set: Set): Promise<void> {
  stopPolling();
  resetThrottle();
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
