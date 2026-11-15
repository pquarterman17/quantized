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
import type { LoadedWorkspace, WorkspaceState } from "./workspace";
import { workspaceCodec } from "./workspaceCodecLazy";

/** The lazily loaded `.dwk` codec (bundle headroom slice 9): only its parser
 *  is needed here, and only once there is something to validate. */
type ParseWorkspace = Awaited<ReturnType<typeof workspaceCodec>>["parseWorkspace"];

/** Total retained bytes across all generations. Generous next to localStorage's
 *  ~5 MB because IndexedDB can take it, but still bounded — #32 wants recovery
 *  storage that cannot grow forever. */
export const AUTOSAVE_BUDGET_BYTES = 64 * 1024 * 1024;

let backend: AutosaveBackend = defaultBackend();
let health: AutosaveHealth = { savedAt: null, error: null, count: 0 };

/** The on-hide stash (soak test: edits inside the debounce were lost on a tab
 *  close). IndexedDB is async end to end, and a closing page does not live to
 *  finish it, so a page being left ALSO writes one generation here,
 *  synchronously. It is a generation like any other: a restore weighs it with
 *  the rest (newest wins), and the next real save folds it into the rotation
 *  and only then removes it — never a stash newer than the state it wrote.
 *  Declines (the async save still runs) without the codec loaded, on the
 *  localStorage backend (already synchronous, and the two would share one
 *  quota), or for a workspace over STASH_MAX_CHARS. Stored as `<at>\n<text>`
 *  so the text is not escaped a second time. */
export const STASH_KEY = "qz.autosave.stash";
/** ~4 MB of UTF-16 at most: leaves room for every other `qz.*` key. */
export const STASH_MAX_CHARS = 2_000_000;
let codecNow: Awaited<ReturnType<typeof workspaceCodec>> | null = null;
/** The last serialized size, so an oversized workspace is declined BEFORE a
 *  synchronous serialize on every hide. */
let lastChars = 0;

const SERIALIZE = { fitModelLibrary: false, compact: true } as const;

/** Synchronously stash `ws`; false when it did not (the async save covers it).
 *  An empty library removes any stash instead: Remove all must not come back. */
export function stashAutosave(ws: WorkspaceState, now = Date.now()): boolean {
  try {
    if (ws.datasets.length === 0) return (localStorage.removeItem(STASH_KEY), false);
    if (!codecNow || backend.kind === "localstorage" || lastChars > STASH_MAX_CHARS) return false;
    const text = codecNow.serializeWorkspace(ws, SERIALIZE);
    lastChars = text.length;
    if (lastChars > STASH_MAX_CHARS) return false;
    localStorage.setItem(STASH_KEY, `${now}\n${text}`);
    return true;
  } catch {
    return false;
  }
}

/** Remove the stash when it is no newer than `upTo` (default: always).
 *  Never fails the caller. */
function dropStash(upTo = Infinity): void {
  try {
    const g = stashed()[0];
    if (g && g.at <= upTo) localStorage.removeItem(STASH_KEY);
  } catch {
    /* storage blocked: there is no stash either */
  }
}

function stashed(): Generation[] {
  try {
    const raw = localStorage.getItem(STASH_KEY) ?? "";
    const cut = raw.indexOf("\n");
    const at = cut > 0 ? Number(raw.slice(0, cut)) : Number.NaN;
    return Number.isFinite(at) ? [{ at, text: raw.slice(cut + 1) }] : [];
  } catch {
    return [];
  }
}

/** Test seam: forget the loaded codec and size memo (a fresh page). */
export function resetAutosaveStashState(): void {
  codecNow = null;
  lastChars = 0;
}

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

function isRestorable(parseWorkspace: ParseWorkspace, text: string): boolean {
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
      dropStash(now);
      health = { savedAt: health.savedAt, error: null, count: 0 };
      return true;
    }
    // Inside the try: a codec chunk that will not load is reported like any
    // other failed save (persistent health warning), and the next save retries.
    const { serializeWorkspace } = (codecNow = await workspaceCodec());
    const text = serializeWorkspace(ws, SERIALIZE);
    lastChars = text.length;
    // The stash joins the rotation (read AFTER the await, so a stash written
    // while this save waited is seen); the newest generation wins either way.
    const read = await backend.read();
    const stash = stashed();
    // Three bounds, applied in sequence, each preserving the newest
    // generation on its own axis (count / age / size) — see
    // autosaveGenerations.ts's docs on rotate/capByAge/capBySize.
    const kept = capBySize(
      // P2.7: the fit-model CARRY only, not the library — a restore happens
      // on this machine, whose library is newer (lib/fitModelsProject.ts).
      capByAge(rotate([...stash, ...read], { at: now, text }), now),
      AUTOSAVE_BUDGET_BYTES,
    );
    await backend.write(kept);
    // Only the stash this save wrote out, or one older than it: a stash
    // written while the write was in flight is newer, and waits for the next.
    dropStash(Math.max(now, stash[0]?.at ?? now));
    health = { savedAt: now, error: null, count: kept.length };
    return true;
  } catch (e: unknown) {
    // A full store: an older stash only competes for the same quota.
    if (e instanceof DOMException && e.name === "QuotaExceededError") dropStash(now);
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
  // The codec chunk is fetched alongside the storage read, and awaited OUTSIDE
  // the try below: a chunk that will not load must REJECT, never read as
  // "nothing to restore" — that would show an empty library over a perfectly
  // good autosave. The caller (useWorkspaceAutosave) reports the rejection.
  const [codec, read] = await Promise.allSettled([workspaceCodec(), (async () => backend.read())()]);
  if (codec.status === "rejected") throw codec.reason;
  const { parseWorkspace, autosaveRestoreFitModels } = (codecNow = codec.value);
  try {
    if (read.status === "rejected") return null;
    const generations = [...(await withLegacyGeneration(read.value, parseWorkspace)), ...stashed()];
    const pick = pickRestorable(generations, (text) => isRestorable(parseWorkspace, text));
    health = { ...health, count: generations.length };
    // P2.7: an autosave embeds the fit-model CARRY only (above), so a
    // restore merges nothing into the library — merging would resurrect
    // deletions and pin stale versions — and puts every record it holds back
    // in the carry (lib/fitModelsProject.ts).
    if (!pick) return null;
    const ws = parseWorkspace(pick.text);
    return { workspace: { ...ws, ...autosaveRestoreFitModels(ws) }, at: pick.at };
  } catch {
    return null; // never block startup on a bad autosave
  }
}

/** Every retained generation, newest first — for diagnostics and a future
 *  recovery picker, so the UI can show which recovery points exist. */
export async function listAutosaveGenerations(): Promise<Generation[]> {
  try {
    const { parseWorkspace } = await workspaceCodec();
    return [...(await withLegacyGeneration(await backend.read(), parseWorkspace)), ...stashed()].sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

export async function autosaveBytes(): Promise<number> {
  return totalSize(await listAutosaveGenerations());
}

/** Import the pre-#32 localStorage slot the first time, given the generations
 *  just read (split from the read itself so that read can overlap the codec
 *  fetch — the legacy slot is validated with the lazily loaded parser).
 *
 *  Without this, upgrading would strand whatever was autosaved before the
 *  switch — a data-loss bug introduced BY the data-loss fix. Migration only
 *  READS the legacy key: it is copied, never deleted, so a downgrade still
 *  finds it. */
async function withLegacyGeneration(generations: Generation[], parseWorkspace: ParseWorkspace): Promise<Generation[]> {
  if (generations.length > 0 || backend.kind === "localstorage") return generations;
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_KEY);
  } catch {
    return generations; // storage unavailable — nothing to migrate
  }
  if (!legacy || !isRestorable(parseWorkspace, legacy)) return generations;
  // `at: 0` marks it the oldest possible snapshot; any real save outranks it.
  return [{ at: 0, text: legacy }];
}

/** Wipe every autosaved generation ("Clear autosaved workspace"). Resolves
 *  null on success, else the failure's reason — the snapshot is then still
 *  there, so the caller must say so (silent-failure audit 2026-10-01). */
export async function clearAutosave(): Promise<string | null> {
  try {
    await backend.clear();
    dropStash(); // "Clear autosaved workspace" means every copy
    health = { savedAt: null, error: null, count: 0 };
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "storage unavailable";
  }
}
