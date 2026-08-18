// Workspace autosave (MAIN_PLAN #32) — durable, multi-generation recovery.
//
// Was: one localStorage slot, overwritten in place, whose own header warned a
// large library "can exceed the ~5 MB quota". One generation deep, so a bad
// write cost the work and there was nothing to fall back to.
//
// Now: several rotating generations on a backend that is IndexedDB where the
// engine has it (see ./autosaveBackend.ts), with the old localStorage slot as a
// one-generation fallback so no browser ends up worse off than before. The
// rules deciding what to keep and what to restore are pure and tested in
// ./autosaveGenerations.ts; this module is the seam wiring them to a store and
// reporting health.
//
// The API is now ASYNC — IndexedDB has no synchronous mode. Callers await.

import {
  capByAge,
  capBySize,
  pickRestorable,
  rotate,
  totalSize,
  type AutosaveHealth,
  type Generation,
} from "./autosaveGenerations";
import { defaultBackend, LEGACY_KEY, type AutosaveBackend } from "./autosaveBackend";
import {
  parseWorkspace,
  serializeWorkspace,
  type LoadedWorkspace,
  type WorkspaceState,
} from "./workspace";

/** Total retained bytes across all generations. Generous next to localStorage's
 *  ~5 MB because IndexedDB can take it, but still bounded — #32 wants recovery
 *  storage that cannot grow forever. */
export const AUTOSAVE_BUDGET_BYTES = 64 * 1024 * 1024;

let backend: AutosaveBackend = defaultBackend();
let health: AutosaveHealth = { savedAt: null, error: null, count: 0 };

/** Swap the backing store. Tests use `memoryBackend()`; production never calls
 *  this. Resets health so one test cannot inherit another's state. */
export function setAutosaveBackend(next: AutosaveBackend): void {
  backend = next;
  health = { savedAt: null, error: null, count: 0 };
}

export function autosaveHealth(): AutosaveHealth {
  return health;
}

export function autosaveBackendKind(): AutosaveBackend["kind"] {
  return backend.kind;
}

function isRestorable(text: string): boolean {
  try {
    return parseWorkspace(text).datasets.length > 0;
  } catch {
    return false;
  }
}

/** Persist the workspace as a new generation (empty library → clear the slot).
 *
 *  Resolves false on any storage failure, leaving `autosaveHealth().error` set
 *  so the UI can show a PERSISTENT warning instead of a status line that
 *  scrolls away — the transient message was the pre-#32 weakness. */
export async function saveAutosave(ws: WorkspaceState, now = Date.now()): Promise<boolean> {
  try {
    if (ws.datasets.length === 0) {
      await backend.clear();
      health = { savedAt: health.savedAt, error: null, count: 0 };
      return true;
    }
    const existing = await backend.read();
    // Three bounds, applied in sequence, each preserving the newest
    // generation on its own axis (count / age / size) — see
    // autosaveGenerations.ts's docs on rotate/capByAge/capBySize.
    const kept = capBySize(
      capByAge(rotate(existing, { at: now, text: serializeWorkspace(ws) }), now),
      AUTOSAVE_BUDGET_BYTES,
    );
    await backend.write(kept);
    health = { savedAt: now, error: null, count: kept.length };
    return true;
  } catch (e: unknown) {
    health = { ...health, error: e instanceof Error ? e.message : "storage unavailable" };
    return false;
  }
}

/** Restore the newest RESTORABLE generation, or null when none is usable.
 *
 *  Skipping past a corrupt newest snapshot to a good older one is the entire
 *  reason several generations are kept. */
export async function loadAutosave(): Promise<LoadedWorkspace | null> {
  const picked = await loadAutosaveGeneration();
  return picked ? picked.workspace : null;
}

/** Same restore rule as `loadAutosave`, but also returns the generation's
 *  `at` timestamp — P1.2 box "explain crash recovery source/time/choices"
 *  needs the candidate's age to decide whether it is newer than the last-
 *  opened project, which the workspace content alone can't say. */
export async function loadAutosaveGeneration(): Promise<
  { workspace: LoadedWorkspace; at: number } | null
> {
  try {
    const generations = await readAllWithMigration();
    const pick = pickRestorable(generations, isRestorable);
    health = { ...health, count: generations.length };
    return pick ? { workspace: parseWorkspace(pick.text), at: pick.at } : null;
  } catch {
    return null; // never block startup on a bad autosave
  }
}

/** Every retained generation, newest first — for diagnostics and a future
 *  recovery picker, so the UI can show which recovery points exist. */
export async function listAutosaveGenerations(): Promise<Generation[]> {
  try {
    return (await readAllWithMigration()).sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

export async function autosaveBytes(): Promise<number> {
  return totalSize(await listAutosaveGenerations());
}

/** Read generations, importing the pre-#32 localStorage slot the first time.
 *
 *  Without this, upgrading would strand whatever was autosaved before the
 *  switch — a data-loss bug introduced BY the data-loss fix. Migration only
 *  READS the legacy key: it is copied, never deleted, so a downgrade still
 *  finds it. */
async function readAllWithMigration(): Promise<Generation[]> {
  const generations = await backend.read();
  if (generations.length > 0 || backend.kind === "localstorage") return generations;
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_KEY);
  } catch {
    return generations; // storage unavailable — nothing to migrate
  }
  if (!legacy || !isRestorable(legacy)) return generations;
  // `at: 0` marks it the oldest possible snapshot; any real save outranks it.
  return [{ at: 0, text: legacy }];
}

/** Wipe every autosaved generation ("Clear autosaved workspace"). */
export async function clearAutosave(): Promise<void> {
  try {
    await backend.clear();
    health = { savedAt: null, error: null, count: 0 };
  } catch {
    /* storage unavailable — nothing to clear */
  }
}
