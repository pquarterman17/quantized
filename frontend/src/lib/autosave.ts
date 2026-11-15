// Workspace autosave (MAIN_PLAN #32) — durable, multi-generation recovery.
//
// Was: one localStorage slot, overwritten in place, whose own header warned a
// large library "can exceed the ~5 MB quota". One generation deep, so a bad
// write cost the work and there was nothing to fall back to.
//
// Now: several rotating generations on IndexedDB where the engine has it, with
// the old localStorage slot as a one-generation fallback. The API is ASYNC —
// IndexedDB has no synchronous mode. Callers await.
//
// This module is only the EAGER surface (bundle headroom, soak-fix lane): the
// backend and health every caller shares, and thin wrappers over
// ./autosaveCore.ts — a lazy chunk the startup restore brings in, which holds
// the generation rules, the backends and the on-hide stash. The one
// synchronous entry point, `stashAutosave`, uses the core only once it is
// here; a page left before then simply has no stash, and its async save
// starts as it always did.

import type { AutosaveBackend } from "./autosaveBackend";
import type { AutosaveHealth, Generation } from "./autosaveGenerations";
import type { LoadedWorkspace, WorkspaceState } from "./workspace";
import { workspaceCodec } from "./workspaceCodecLazy";

/** Shared with the lazy core: the backend (resolved on first use, so the
 *  backend code stays in the core chunk) and the persistent health readout. */
export interface AutosaveState {
  backend: AutosaveBackend | null;
  health: AutosaveHealth;
}
const autosaveState: AutosaveState = { backend: null, health: { savedAt: null, error: null, count: 0 } };

type Core = typeof import("./autosaveCore");
let core: Core | null = null;
let coreLoad: Promise<Core> | null = null;

/** The core chunk, fetched once and bound to this module's state and codec
 *  seam; a load that fails is not cached. */
function autosaveCore(): Promise<Core> {
  coreLoad ??= import("./autosaveCore").then(
    (m) => (m.bindAutosave({ state: autosaveState, codec: workspaceCodec }), (core = m)),
    (e: unknown) => {
      coreLoad = null;
      throw e;
    },
  );
  return coreLoad;
}

const failure = (e: unknown): string => (e instanceof Error ? e.message : "storage unavailable");

/** Swap the backing store. Tests use `memoryBackend()`; production never calls
 *  this. Resets health so one test cannot inherit another's state. */
export function setAutosaveBackend(next: AutosaveBackend): void {
  autosaveState.backend = next;
  autosaveState.health = { savedAt: null, error: null, count: 0 };
}

export function autosaveHealth(): AutosaveHealth {
  return autosaveState.health;
}

/** Persist the workspace as a new generation (empty library → clear the slot).
 *  Resolves false on any failure — a core chunk that will not load included —
 *  leaving `autosaveHealth().error` set for the persistent warning. */
export async function saveAutosave(ws: WorkspaceState, now = Date.now()): Promise<boolean> {
  try {
    return (await autosaveCore()).saveAutosave(ws, now);
  } catch (e) {
    autosaveState.health = { ...autosaveState.health, error: failure(e) };
    return false;
  }
}

/** The newest restorable generation and its `at`, or null. REJECTS when the
 *  code to read it will not load — never "nothing to restore" over a good
 *  autosave (the caller reports the rejection). */
export async function loadAutosaveGeneration(): Promise<{ workspace: LoadedWorkspace; at: number } | null> {
  workspaceCodec().catch(() => undefined); // fetch the codec alongside the core chunk; the core reports failure
  return (await autosaveCore()).loadAutosaveGeneration();
}

export async function loadAutosave(): Promise<LoadedWorkspace | null> {
  return (await loadAutosaveGeneration())?.workspace ?? null;
}

/** Every retained generation (the stash included), newest first. */
export async function listAutosaveGenerations(): Promise<Generation[]> {
  try {
    return await (await autosaveCore()).listAutosaveGenerations();
  } catch {
    return [];
  }
}

/** Wipe every autosaved copy; null on success, else the reason. */
export async function clearAutosave(): Promise<string | null> {
  try {
    return await (await autosaveCore()).clearAutosave();
  } catch (e) {
    return failure(e);
  }
}

/** Synchronously stash `ws` for a page being left; false when it did not
 *  (the core chunk is not here yet, or the stash declined). */
export function stashAutosave(ws: WorkspaceState, now = Date.now()): boolean {
  return core?.stashAutosave(ws, now) ?? false;
}

/** Test seam: a fresh page, before the core chunk has loaded. */
export function resetAutosaveStashState(): void {
  core?.resetStashMemo();
  core = coreLoad = null;
}
