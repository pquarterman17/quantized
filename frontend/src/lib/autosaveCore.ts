// The workspace autosave's working half (MAIN_PLAN #32) — a LAZY chunk.
//
// `lib/autosave.ts` keeps the eager surface (the backend and health it
// hands in through `bindAutosave`, thin async wrappers, and the one
// synchronous entry point, `stashAutosave`) and loads this with the startup
// restore. Everything here was already async — IndexedDB has no synchronous
// mode, and the `.dwk` codec is itself lazy — so moving it out of the entry
// chunk costs nothing at boot (bundle headroom, soak-fix lane).
//
// Several rotating generations on a backend that is IndexedDB where the
// engine has it (./autosaveBackend.ts), with the old localStorage slot as a
// one-generation fallback. The rules deciding what to keep and what to restore
// are pure and tested in ./autosaveGenerations.ts.
//
// THE ON-HIDE STASH (soak test: edits inside the 800 ms debounce were lost on
// a tab close). A closing page does not live to finish an IndexedDB write, so
// a page being left ALSO writes one generation to localStorage synchronously.
// It is a generation like any other: a restore weighs it with the rest
// (newest wins), and the next real save folds it into the rotation and only
// then removes it — never a stash newer than the state that save wrote.

import type { AutosaveState } from "./autosave";
import { defaultBackend, LEGACY_KEY, type AutosaveBackend } from "./autosaveBackend";
import { workflowPrefsSlot } from "./workflowPrefs";
import { capByAge, capBySize, pickRestorable, rotate, totalSize, type Generation } from "./autosaveGenerations";
import type { LoadedWorkspace, WorkspaceState } from "./workspace";
import type { workspaceCodec } from "./workspaceCodecLazy";

type Codec = Awaited<ReturnType<typeof workspaceCodec>>;
type ParseWorkspace = Codec["parseWorkspace"];

/** Total retained bytes across all generations. Generous next to localStorage's
 *  ~5 MB because IndexedDB can take it, but still bounded — #32 wants recovery
 *  storage that cannot grow forever. */
export const AUTOSAVE_BUDGET_BYTES = 64 * 1024 * 1024;

export const STASH_KEY = "qz.autosave.stash";
/** ~4 MB of UTF-16 at most: leaves room for every other `qz.*` key. */
export const STASH_MAX_CHARS = 2_000_000;

const SERIALIZE = { fitModelLibrary: false, compact: true } as const;

/** What the eager module hands this chunk on load (`bindAutosave`): its
 *  shared state and its codec loader. Passed in rather than imported, so the
 *  core always works on the SAME state and codec seam as its caller. */
export interface AutosaveContext {
  state: AutosaveState;
  codec: typeof workspaceCodec;
}
let ctx: AutosaveContext;

export function bindAutosave(next: AutosaveContext): void {
  ctx = next;
}

/** The codec once some save or restore has loaded it: the stash serializes
 *  synchronously, so it can only run after that. */
let codecNow: Codec | null = null;
/** The last serialized size, so an oversized workspace is declined BEFORE a
 *  synchronous serialize on every hide. */
let lastChars = 0;

const backend = (): AutosaveBackend => (ctx.state.backend ??= defaultBackend());

async function codec(): Promise<Codec> {
  return (codecNow = await ctx.codec());
}

/** Synchronously stash `ws` for a page being left; false when it did not (the
 *  async save covers it): no codec yet, the localStorage backend (already
 *  synchronous, and the two would share one quota), or over the size cap. An
 *  empty library removes any stash instead: Remove all must not come back.
 *  Stored as `<at>\n<text>`, so the text is not escaped a second time. */
export function stashAutosave(ws: WorkspaceState, now: number): boolean {
  try {
    if (ws.datasets.length === 0) return (localStorage.removeItem(STASH_KEY), false);
    if (!codecNow || backend().kind === "localstorage" || lastChars > STASH_MAX_CHARS) return false;
    const text = codecNow.serializeWorkspace(ws, SERIALIZE);
    lastChars = text.length;
    if (lastChars > STASH_MAX_CHARS) return false;
    localStorage.setItem(STASH_KEY, `${now}\n${text}`);
    return true;
  } catch {
    return false;
  }
}

function readStash(): Generation[] {
  try {
    const raw = localStorage.getItem(STASH_KEY) ?? "";
    const cut = raw.indexOf("\n");
    const at = cut > 0 ? Number(raw.slice(0, cut)) : Number.NaN;
    return Number.isFinite(at) ? [{ at, text: raw.slice(cut + 1) }] : [];
  } catch {
    return [];
  }
}

/** Remove the stash when it is no newer than `upTo` (default: always). */
function dropStash(upTo = Infinity): void {
  try {
    const g = readStash()[0];
    if (g && g.at <= upTo) localStorage.removeItem(STASH_KEY);
  } catch {
    /* storage blocked: there is no stash either */
  }
}

/** Every `.dwk` text carries its own write time (`savedAt`), so two writes of
 *  one state differ only there: compare with it blanked. Returns a matcher
 *  for `text`, normalising it once. */
const SAVED_AT = /"savedAt":"[^"]*"/;
function sameState(text: string): (other: string) => boolean {
  const key = text.replace(SAVED_AT, "");
  return (other) => other.length === text.length && other.replace(SAVED_AT, "") === key;
}

/** Test seam: a fresh page's codec pointer and size memo. */
export function resetStashMemo(): void {
  codecNow = null;
  lastChars = 0;
  tail = Promise.resolve(); // and an empty queue (a test may leave a save hanging)
}

function isRestorable(parseWorkspace: ParseWorkspace, text: string): boolean {
  try {
    return parseWorkspace(text).datasets.length > 0;
  } catch {
    return false;
  }
}

/** The end of the save queue: every save (and clear) runs after the one
 *  before it has settled, so two never interleave a read and a write — a
 *  hide during a slow save starts another (review N5), and the earlier write
 *  landing last would otherwise put back its own older read. */
let tail: Promise<unknown> = Promise.resolve();

/** How long one queued job may take before the queue moves on (review R4: a
 *  storage call that never settles — a blocked or hung IndexedDB open — used
 *  to stall every later save and Clear for the session, silently). */
export const QUEUE_TIMEOUT_MS = 15_000;

/** Run `job` after every earlier one. A job still running after
 *  QUEUE_TIMEOUT_MS settles as `timedOut()` and the queue continues; the job
 *  is told through `live()` that it no longer owns the store, and must check
 *  it before every write, so its late write can never land over a newer one. */
function queued<T>(job: (live: () => boolean) => Promise<T>, timedOut: () => T): Promise<T> {
  const run = tail.then(
    () =>
      new Promise<T>((resolve, reject) => {
        let owned = true;
        const timer = setTimeout(() => {
          owned = false;
          resolve(timedOut());
        }, QUEUE_TIMEOUT_MS);
        const settle = (finish: () => void) => {
          if (!owned) return;
          owned = false;
          clearTimeout(timer);
          finish();
        };
        job(() => owned).then(
          (v) => settle(() => resolve(v)),
          (e: unknown) => settle(() => reject(e instanceof Error ? e : new Error(String(e)))),
        );
      }),
  );
  tail = run.catch(() => undefined);
  return run;
}

const TIMED_OUT = "the browser's storage did not answer (timed out) — the next autosave tries again";
/** Clear's own wording: nothing retries it by itself (review F7). */
const CLEAR_TIMED_OUT = "the browser's storage did not answer (timed out) — nothing was cleared; try again";

/** Persist the workspace as a new generation (empty library → clear the slot).
 *
 *  Resolves false on any storage failure, leaving `autosaveHealth().error` set
 *  so the UI can show a PERSISTENT warning instead of a status line that
 *  scrolls away — the transient message was the pre-#32 weakness. */
export function saveAutosave(ws: WorkspaceState, now: number): Promise<boolean> {
  return queued(
    (live) => writeGeneration(ws, now, live),
    () => ((ctx.state.health = { ...ctx.state.health, error: TIMED_OUT }), false),
  );
}

async function writeGeneration(ws: WorkspaceState, now: number, live: () => boolean): Promise<boolean> {
  const be = backend();
  const pin = ctx.state.pinBefore;
  try {
    if (ws.datasets.length === 0) {
      // An empty library clears the slot — except, while the startup restore
      // is pending, the generations from before this session and that
      // session's stash: they are the work not yet given back (review R1).
      const keep = pin === null ? [] : (await be.read()).filter((g) => g.at < pin);
      if (!live()) return false;
      await (keep.length ? be.write(keep) : be.clear());
      // A job the watchdog gave up on touches nothing more — not the stash,
      // not the health line (review F7): a later job owns both now.
      if (!live()) return false;
      if (pin === null) dropStash(now);
      else if ((readStash()[0]?.at ?? -Infinity) >= pin) dropStash(now);
      ctx.state.health = { savedAt: ctx.state.health.savedAt, error: null, count: keep.length };
      return true;
    }
    // Inside the try: a codec chunk that will not load is reported like any
    // other failed save (persistent health warning), and the next save retries.
    const { serializeWorkspace } = await codec();
    const text = serializeWorkspace(ws, SERIALIZE);
    lastChars = text.length;
    // The stash joins the rotation (read AFTER the await, so a stash written
    // while this save waited is seen) — unless it holds the very state being
    // saved or one already stored (review N1: a hide stashes, then saves the
    // same state, and two of the three slots went to one recovery point).
    // By CONTENT, not time: another tab's older stash is a distinct state.
    const read = await be.read();
    const stash = readStash();
    const same = sameState(stash[0]?.text ?? "");
    const fresh = stash.filter(() => !same(text) && !read.some((r) => same(r.text)));
    // Until the startup restore has succeeded or been declined, the
    // generations from before this session are pinned (review N2): a restore
    // that failed must not be rotated out by the session that replaced it.
    // Exempt from the count cap only — age and bytes still bound them.
    const all = [...fresh, ...read];
    const pinned = pin === null ? [] : all.filter((g) => g.at < pin);
    const rotating = pin === null ? all : all.filter((g) => g.at >= pin);
    // Three bounds, applied in sequence, each preserving the newest
    // generation on its own axis (count / age / size) — see
    // autosaveGenerations.ts's docs on rotate/capByAge/capBySize.
    const wf = workflowPrefsSlot.load(); // Preferences ▸ General (lib/workflowPrefs.ts)
    const kept = capBySize(
      // P2.7: the fit-model CARRY only, not the library — a restore happens
      // on this machine, whose library is newer (lib/fitModelsProject.ts).
      capByAge([...rotate(rotating, { at: now, text }, wf.autosaveGenerations), ...pinned], now, wf.autosaveRetentionDays * 86_400_000),
      AUTOSAVE_BUDGET_BYTES,
    );
    if (!live()) return false; // timed out: a later save owns the store now
    await be.write(kept);
    // Only the stash this save wrote out (or found duplicated), or one older
    // than it: a stash written while the write was in flight is newer, and
    // waits for the next save. (No drop on a failed save, quota included —
    // review N3: the stash may be the only copy newer than IndexedDB.)
    if (!live()) return false; // given up on while writing: see above
    dropStash(Math.max(now, stash[0]?.at ?? now));
    ctx.state.health = { savedAt: now, error: null, count: kept.length };
    return true;
  } catch (e: unknown) {
    ctx.state.health = { ...ctx.state.health, error: e instanceof Error ? e.message : "storage unavailable" };
    return false;
  }
}

/** Restore the newest RESTORABLE generation, or null when none is usable.
 *  Skipping past a corrupt newest snapshot to a good older one is the entire
 *  reason several generations are kept. Also returns the generation's `at`
 *  timestamp — P1.2 box "explain crash recovery source/time/choices" needs
 *  the candidate's age to decide whether it is newer than the last-opened
 *  project, which the workspace content alone can't say. */
export interface RestoredGeneration {
  workspace: LoadedWorkspace;
  at: number;
  /** A recovery the previous page left unanswered (the pending-recovery
   *  marker, review F2): its newest generation, to be OFFERED again — never
   *  applied silently. Equal to the pick itself when that is all there is. */
  carried?: { workspace: LoadedWorkspace; at: number };
}

export async function loadAutosaveGeneration(): Promise<RestoredGeneration | null> {
  const be = backend();
  // The codec chunk is fetched alongside the storage read, and awaited OUTSIDE
  // the try below: a chunk that will not load must REJECT, never read as
  // "nothing to restore" — that would show an empty library over a perfectly
  // good autosave. The caller (useWorkspaceAutosave) reports the rejection.
  const [loaded, read] = await Promise.allSettled([codec(), (async () => be.read())()]);
  if (loaded.status === "rejected") throw loaded.reason;
  const { parseWorkspace, autosaveRestoreFitModels } = loaded.value;
  try {
    if (read.status === "rejected") return null;
    // When RETRYING a failed startup restore, only what predates this session is a
    // candidate: a retry must bring back the unrestored work, not this
    // session's own saves (review N2).
    const pin = (ctx.state.restoreError && ctx.state.pinBefore) || Infinity;
    const generations = [...(await withLegacyGeneration(be, read.value, parseWorkspace)), ...readStash()].filter((g) => g.at < pin);
    const pick = pickRestorable(generations, (text) => isRestorable(parseWorkspace, text));
    ctx.state.health = { ...ctx.state.health, count: generations.length };
    // P2.7: an autosave embeds the fit-model CARRY only (above), so a
    // restore merges nothing into the library — merging would resurrect
    // deletions and pin stale versions — and puts every record it holds back
    // in the carry (lib/fitModelsProject.ts).
    if (!pick) return null;
    const load = (g: { text: string; at: number }) => {
      const ws = parseWorkspace(g.text);
      return { workspace: { ...ws, ...autosaveRestoreFitModels(ws) }, at: g.at };
    };
    const picked = load(pick);
    const before = ctx.state.restoreError ? null : ctx.state.carried;
    const old = before === null ? null : pickRestorable(generations.filter((g) => g.at < before), (text) => isRestorable(parseWorkspace, text));
    return old ? { ...picked, carried: old.at === pick.at ? picked : load(old) } : picked;
  } catch {
    return null; // never block startup on a bad autosave
  }
}

/** Every retained generation (the stash included), newest first — for
 *  diagnostics and a future recovery picker. */
export async function listAutosaveGenerations(): Promise<Generation[]> {
  try {
    const be = backend();
    const { parseWorkspace } = await codec();
    return [...(await withLegacyGeneration(be, await be.read(), parseWorkspace)), ...readStash()].sort((a, b) => b.at - a.at);
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
async function withLegacyGeneration(
  be: AutosaveBackend,
  generations: Generation[],
  parseWorkspace: ParseWorkspace,
): Promise<Generation[]> {
  if (generations.length > 0 || be.kind === "localstorage") return generations;
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

/** Wipe every autosaved generation, the stash included ("Clear autosaved
 *  workspace" means every copy). Resolves null on success, else the failure's
 *  reason — the snapshot is then still there, so the caller must say so
 *  (silent-failure audit 2026-10-01). */
export function clearAutosave(): Promise<string | null> {
  return queued(wipe, () => CLEAR_TIMED_OUT);
}

async function wipe(live: () => boolean): Promise<string | null> {
  try {
    if (!live()) return CLEAR_TIMED_OUT;
    await backend().clear();
    dropStash();
    ctx.state.health = { savedAt: null, error: null, count: 0 };
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "storage unavailable";
  }
}
