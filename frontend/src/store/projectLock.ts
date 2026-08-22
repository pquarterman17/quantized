// Single-writer project locking — the store orchestrator (PR I2, L0.47).
// A standalone Zustand store (the store/relink.ts precedent — see that
// module's header): lock/read-only status is ambient SESSION state, not
// part of the saved workspace document, so it must never ride HistorySnapshot
// or count against useApp.ts's size-ratchet pin. Calls `useApp.getState()`/
// `setState()` directly for the one place it touches the main store
// (`openAsCopy` clearing `currentProject` — see below), the same shape
// store/reimport.ts and store/relink.ts already use.
//
// PURE LOGIC lives in lib/lockState.ts (exhaustively tested there); this
// module is the thin async orchestrator around an injectable `LockProvider`
// — read the current record, classify it, and either acquire/refresh
// directly or surface the read-only + Open-as-Copy / guarded Take Over
// Editing choice L0.47 requires. `heartbeat()`'s own CAS (`provider.refresh`,
// keyed on the held token — see "ATOMIC VERBS" below) is this module's
// realization of lib/lockState.ts's "FALSE-POSITIVE RISK" safety net: a
// heartbeat whose token no longer matches what's on record demotes the
// session to read-only immediately, rather than letting a resumed-from-
// suspension instance believe it can still write.
//
// FILESYSTEM PROVIDER — LANDED (I2 audit fix, P0-3/P1-1; see
// `plans/ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md`'s "Independent Day-6 audit"
// section). This module used to default to an IN-MEMORY, process-local
// provider even in the desktop shell — its own prior header admitted two
// SEPARATE `qz --desktop` processes each got their own empty Map, so the
// "single writer" release claim was false for the one case it existed to
// protect. `createDesktopLockProvider()` (lib/desktopLockProvider.ts) is
// the real fix: a lock file beside the project (`desktop_project_lock.py`),
// mutated ONLY via true cross-process compare-and-swap (an exclusive
// OS-level file lock — `fcntl.flock`/`msvcrt.locking` — around every
// read-compare-write), reached through the same write-consent discipline
// `desktop_bridge.py`'s `save_file_dialog`/`write_project_file` pair
// already established. `App.tsx` selects it over the in-memory default the
// moment a desktop shell is detected (`hasDesktopShell()`) — see that
// module for the wiring; nothing in THIS file needs to know which provider
// is live, since both satisfy the exact same `LockProvider` shape below.
//
// The in-memory provider remains the default (and the only one in a
// browser tab, and in every test that doesn't call `setProvider`) —
// it exercises the full state machine (acquire/read-only/stale/takeover/
// heartbeat) but is still honestly process-local, which is the CORRECT
// scope for it: nothing durable backs a browser tab's lock, and pretending
// otherwise across a reload would be worse than the documented gap below.
//
// ATOMIC VERBS, NOT read-then-write (P1-1's other half): every mutation —
// `tryAcquire`/`refresh`/`takeOver`/`release` — is now a SINGLE provider
// call that performs its own compare-and-swap, in-process for the in-memory
// provider (trivially atomic — one JS turn, no `await` between the read and
// the write) and via the OS-lock CAS primitive for the desktop provider.
// The store below never separately reads a record and then unconditionally
// writes a new one; every place that needs "read current, THEN act" (an
// explicit takeover, a heartbeat, Save As's destination-lock acquisition in
// `store/workspaceIO.ts`) passes what it already knows (a token, or nothing)
// into the atomic verb and trusts the verb's own return value for the truth,
// never a separately-cached belief.
//
// Deliberately NOT touched, per the explicit instruction: `desktop_consent.py`
// is not weakened, duplicated, or reached into by this slice at all — the
// in-memory provider below never calls into it, and the filesystem
// provider's OWN write goes through the real module unmodified (the SAME
// `consented_write_path` gate `write_project_file` uses — see
// `desktop_bridge.py`'s "PR I2" section).
//
// TWO-BROWSER-TABS-ONE-BACKEND — STATED EXPLICITLY, NOT SILENTLY GAPPED
// (P2, adversarial review, 2026-08-19; this was the platform-boundary
// question item 9b's own booking asked to be answered, and the first
// version of this slice answered only the `qz --desktop` process-pair half
// of it). Running `qz` (no `--desktop`) serves the API + SPA over HTTP;
// nothing stops opening the SAME project in two ordinary browser TABS
// against that one server. Today that pair gets ZERO protection from this
// module: `hasDesktopShell()` gates every call site that would register
// with the lock machine at all (`store/workspaceIO.ts`'s `runSaveWorkspace`
// short-circuits to Save-As before ever reaching the lock check;
// `lib/openWorkspaceReplace.ts`'s `registerWithLockStateMachine` only fires
// on a `native` identity, which a browser tab never has), so two tabs can
// quick-save the same project and silently clobber each other exactly the
// way L0.47 exists to prevent for two DESKTOP instances. This is not the
// same gap the filesystem provider above closes and is NOT automatically
// fixed by it: a filesystem-backed `LockProvider` gives two separate OS
// PROCESSES a shared record, but two tabs in the SAME browser
// share no filesystem access at all — closing this gap needs a different
// mechanism entirely (an in-browser cross-tab channel, e.g.
// `BroadcastChannel`/a `localStorage` "storage" event listener, backed by
// the SAME `LockProvider` interface so `classifyLock`/`takeOver`/
// `verifyBeforeWrite` stay the single source of truth either way). Named
// home: "PR I2 cross-tab lock provider" — until it lands, browser/multi-tab
// mode is honestly ungated, and this paragraph is the record of that, not a
// promise the code doesn't keep.

import { create } from "zustand";

import {
  acquire,
  canTakeOver,
  classifyLock,
  isReadOnly,
  UNVERIFIABLE_DEMOTE_AFTER,
  type LockRecord,
  type LockStatus,
} from "../lib/lockState";
import { useApp } from "./useApp";

/** What every mutating verb below resolves to: did THIS call's own
 *  compare-and-swap land, and what does the provider now believe is on
 *  record (the freshly-written record on success, or whatever it found
 *  instead on refusal — never stale/cached, always what the provider just
 *  observed doing the CAS). `record: null` on a refusal means "nothing is
 *  there at all" (e.g. a takeover whose target was released out from under
 *  it), distinct from "something else is there" (a populated record). */
export interface LockCasResult {
  acquired: boolean;
  record: LockRecord | null;
  /** True when the provider found a lock file it could NOT verify at all
   *  (corrupt/unparseable — `desktop_project_lock.py`'s `UnverifiableLock`,
   *  never an exception). Distinct from `record: null`'s ordinary "nothing
   *  is there": `record` is ALSO `null` here (there is genuinely no
   *  trustworthy record to report), but a caller deriving a `LockStatus`
   *  from a refused result must check this FIRST — `classifyLock(null,
   *  ...)` alone would report `"unlocked"`, which is exactly the "assume
   *  free" guess this flag exists to prevent (lib/lockState.ts's own doc:
   *  "read-only, never assume free"). Optional so the in-memory provider,
   *  which has no unverifiable state to report, never needs to set it. */
  unverifiable?: boolean;
  /** R4/R1 coordination: true when the OS-level lock was momentarily busy
   *  with another process's OWN CAS — transient, benign, "ask again next
   *  tick", distinct from `unverifiable` (content isn't untrustworthy) and
   *  from a definite refusal (nothing was positively observed). Only
   *  `heartbeat()` treats this as strictly benign (see its doc); one-shot
   *  callers fold it into `unverifiable`'s placeholder via
   *  `statusFromRefusal`. Optional — unset for any provider that hasn't
   *  landed contention detection. */
  contended?: boolean;
}

/** The I2 fix's actual seam (P0-3/P1-1): every mutation is ONE atomic call —
 *  no provider implementation may compose "read, decide, write" out of
 *  separate `read`+something-else calls with a gap an outside process could
 *  land in between; each verb below performs its own compare-and-swap
 *  in whatever way its backing store actually supports one (in-process,
 *  same-turn ordering for the in-memory provider; an exclusive OS-level
 *  file lock for the desktop filesystem provider — see
 *  `desktop_project_lock.py`). `read` is the one non-mutating, best-effort
 *  member — for display/classification only, never itself a basis for a
 *  write decision (every mutating verb re-verifies against the CURRENT
 *  record under its own CAS, regardless of what a prior `read` believed). */
export interface LockProvider {
  read: (projectPath: string) => Promise<LockRecord | null>;
  /** Acquire directly when the path is unlocked or already held by THIS
   *  provider's own identity; refuse (with the CURRENT record) otherwise —
   *  including a live OTHER holder, which this deliberately never takes
   *  over (that is `takeOver`'s job, gated by `canTakeOver` at the call
   *  site — see `lib/lockState.ts`'s L0.47 doc). */
  tryAcquire: (projectPath: string) => Promise<LockCasResult>;
  /** CAS heartbeat bump for the holder of `token`. A mismatch (including
   *  "no record at all") resolves `{ acquired: false, record }` — the
   *  caller LOST the lock and must drop to read-only. */
  refresh: (projectPath: string, token: string) => Promise<LockCasResult>;
  /** CAS replace — succeeds only when `expectedToken` still matches what's
   *  on record RIGHT NOW; mints an entirely new identity/token on success,
   *  same as `lib/lockState.ts`'s pure `takeOver`. */
  takeOver: (projectPath: string, expectedToken: string) => Promise<LockCasResult>;
  /** CAS delete — resolves `false` on a token mismatch OR a provider-side
   *  failure to actually remove the record (e.g. the desktop provider's
   *  Windows delete-while-open case — see `desktop_project_lock.py`'s
   *  `release` doc); never throws, never assumes success. */
  release: (projectPath: string, token: string) => Promise<boolean>;
}

/** The default, process-local provider. Genuinely atomic (same-turn, no
 *  `await` between its own read and write), but still honestly scoped to
 *  ONE process/tab — see this module's header. `App.tsx` swaps this out
 *  for `createDesktopLockProvider()` (lib/desktopLockProvider.ts) the
 *  moment a desktop shell is detected. */
export function createInMemoryLockProvider(instanceId: string): LockProvider {
  const store = new Map<string, LockRecord>();
  let tokenSeq = 0;
  const mintRecord = (pid?: string): LockRecord => ({
    ...acquire(instanceId, Date.now(), pid),
    token: `mem-${instanceId}-${++tokenSeq}`,
  });

  return {
    read: async (path) => store.get(path) ?? null,

    tryAcquire: async (path) => {
      const now = Date.now();
      const current = store.get(path) ?? null;
      const status = classifyLock(current, instanceId, now);
      if (status !== "unlocked" && status !== "held-by-me") {
        return { acquired: false, record: current };
      }
      const record = mintRecord();
      store.set(path, record);
      return { acquired: true, record };
    },

    refresh: async (path, token) => {
      const current = store.get(path) ?? null;
      if (current === null || current.token !== token) {
        return { acquired: false, record: current };
      }
      const updated: LockRecord = { ...current, heartbeatAt: Date.now() };
      store.set(path, updated);
      return { acquired: true, record: updated };
    },

    takeOver: async (path, expectedToken) => {
      const now = Date.now();
      const current = store.get(path) ?? null;
      if (current === null || current.token !== expectedToken) {
        return { acquired: false, record: current };
      }
      if (!canTakeOver(classifyLock(current, instanceId, now))) {
        return { acquired: false, record: current }; // no longer stale — refuse, don't clobber
      }
      const record = mintRecord();
      store.set(path, record);
      return { acquired: true, record };
    },

    release: async (path, token) => {
      const current = store.get(path) ?? null;
      if (current === null || current.token !== token) return false;
      store.delete(path);
      return true;
    },
  };
}

let _instanceSeq = 0;
/** One id per running process/tab, minted once at module load — every
 *  `LockRecord` the IN-MEMORY provider writes carries the SAME id, so a
 *  reopen/refresh is recognizably "still me" to `classifyLock`.
 *
 *  **Identity adoption (desktop provider):** the filesystem provider's
 *  instance id is minted SERVER-side, once per process, by
 *  `desktop_bridge.py`'s `DesktopApi.__init__` — the frontend never
 *  supplies it (a compromised page could otherwise just claim to BE a
 *  different instance) and so cannot know it in advance. The store below
 *  ADOPTS whatever `instanceId` a successful `tryAcquire`/`takeOver`/
 *  `refresh` reports as `state.instanceId` from that point on, so every
 *  later `classifyLock` call correctly recognizes this process's own
 *  records as `held-by-me`. This constant remains the seed value (what the
 *  in-memory provider always agrees with, so browser/test behavior is
 *  byte-identical to before) and the ever-adopted fallback if a desktop
 *  session somehow never completes a single successful acquisition. */
const INSTANCE_ID = `qz-${Date.now().toString(36)}-${++_instanceSeq}-${Math.random().toString(36).slice(2, 8)}`;

export interface OpenResult {
  status: LockStatus;
  readOnly: boolean;
}

interface ProjectLockState {
  status: LockStatus;
  record: LockRecord | null;
  path: string | null;
  /** True after an explicit "Open as Copy" — the session is writable, but
   *  deliberately holds NO lock on the original path (see `openAsCopy`). */
  openedAsCopy: boolean;
  /** R4: consecutive `heartbeat()` ticks in a row that came back
   *  UNVERIFIABLE (never a definite CAS loss, which demotes immediately —
   *  see `heartbeat()`'s doc). Reset to 0 by any successful verification;
   *  read by `useProjectLockHeartbeat.ts` to keep polling PAST a demotion
   *  so a returning bridge can still be discovered. */
  unverifiableHeartbeats: number;
  /** See `INSTANCE_ID`'s doc above — adopted from the provider on a
   *  successful acquisition, not permanently fixed at store creation. */
  instanceId: string;
  provider: LockProvider;
  /** The filesystem/in-memory provider seam — `App.tsx` calls this once,
   *  at startup, to swap in `createDesktopLockProvider()` when a desktop
   *  shell is detected; tests call it to inject a fake. */
  setProvider: (provider: LockProvider) => void;
  /** Open `path`: acquire directly when possible, else surface the
   *  read-only + Open-as-Copy / Take Over Editing choice. Never throws — a
   *  provider read/write failure is treated as "could not verify a lock",
   *  which conservatively reports read-only rather than guessing writable. */
  openProject: (path: string) => Promise<OpenResult>;
  /** L0.47's guarded takeover — re-verifies staleness against a FRESH read
   *  right before writing (a preview-then-commit TOCTOU guard, the same
   *  shape store/relink.ts's `commit` re-probes before trusting its own
   *  earlier preview). Returns `false` (and updates `status` to whatever the
   *  fresh read actually shows) when the other holder is no longer stale by
   *  the time this runs — e.g. it wrote its own heartbeat in the interim, or
   *  a THIRD instance already took over. */
  takeOverEditing: () => Promise<boolean>;
  /** The user explicitly chose to keep working without the original lock —
   *  a writable session bound to no durable path (the browser-download
   *  precedent store/project.ts's own header already documents: no path,
   *  no identity). Never touches the lock record itself, so the original
   *  holder is completely unaffected. */
  openAsCopy: () => void;
  /** Refresh this instance's own heartbeat — the false-positive safety net
   *  in practice. Three outcomes, in order of how much they trust the
   *  result (see the implementation's own comments for the full reasoning):
   *  a DEFINITE loss (a real CAS mismatch) demotes to read-only IMMEDIATELY;
   *  an UNVERIFIABLE tick (R4: no bridge / thrown / malformed) proves
   *  nothing, so it only demotes after `UNVERIFIABLE_DEMOTE_AFTER`
   *  consecutive misses, and recovers straight back to `held-by-me` (same
   *  token, not a fresh acquire) the moment a later tick verifies again; a
   *  CONTENDED tick (R4/R1 coordination — the OS lock was momentarily busy
   *  with someone else's own CAS) is strictly benign and touches nothing at
   *  all. `useProjectLockHeartbeat.ts` keeps polling past an unverifiable
   *  demotion (so recovery can happen) but not past a definite loss. */
  heartbeat: () => Promise<boolean>;
  /** Release this instance's own lock (e.g. on project close). No-op when
   *  this instance isn't the current holder. */
  releaseLock: () => Promise<void>;
  /** May a write proceed RIGHT NOW, per the store's last-known status? A
   *  cheap synchronous check for UI gating — `heartbeat()`/`openProject()`
   *  are what actually keep `status` honest against the provider. */
  canWriteNow: () => boolean;
}

/** The `LockStatus` a REFUSED `LockCasResult` implies. `unverifiable` wins
 *  over everything else — reused rather than adding a fifth `LockStatus`
 *  just for this, the exact same "read-only placeholder" convention
 *  `lib/openWorkspaceReplace.ts`'s `reserveLockForSwitch` already uses for
 *  its own conservative-by-default gap. Without this check, deriving
 *  status straight from `classifyLock(result.record, ...)` would see
 *  `record: null` and report `"unlocked"` — precisely the "assume free"
 *  guess an unverifiable lock file must never produce. */
function statusFromRefusal(result: LockCasResult, instanceId: string, now: number): LockStatus {
  // `contended` folds into the SAME placeholder as `unverifiable` here —
  // a one-shot caller (openProject/takeOverEditing) has no "retry next
  // tick" to fall back to, so a transient OS-lock contention is reported
  // exactly like "couldn't verify" (read-only, safe to retry the whole
  // action). Only `heartbeat()`'s own ongoing-tick nature makes `contended`
  // worth treating as strictly benign — see that function's doc.
  if (result.unverifiable || result.contended) return "held-by-other-live";
  return classifyLock(result.record, instanceId, now);
}

export const useProjectLock = create<ProjectLockState>((set, get) => ({
  status: "unlocked",
  record: null,
  path: null,
  openedAsCopy: false,
  unverifiableHeartbeats: 0,
  instanceId: INSTANCE_ID,
  provider: createInMemoryLockProvider(INSTANCE_ID),

  setProvider: (provider) => set({ provider }),

  openProject: async (path) => {
    const { provider, instanceId } = get();
    const now = Date.now();
    // Shared by every non-acquiring outcome below (a thrown read, a live/
    // stale other holder, a thrown acquire, or a lost race) — always resets
    // `unverifiableHeartbeats` (a leftover streak from a PRIOR path/session
    // must never keep the heartbeat interval alive against a record/token
    // that no longer belongs to this attempt) and never assumes success.
    const failClosed = (status: LockStatus, record: LockRecord | null): OpenResult => {
      set({ status, record, path, openedAsCopy: false, unverifiableHeartbeats: 0 });
      return { status, readOnly: isReadOnly(status) };
    };
    let current: LockRecord | null;
    try {
      current = await provider.read(path);
    } catch {
      return failClosed("held-by-other-live", null);
    }
    const status = classifyLock(current, instanceId, now);
    if (status !== "unlocked" && status !== "held-by-me") {
      // Read-only (live OR stale) — never auto-acquire; a stale lock is
      // only ever taken over via the EXPLICIT `takeOverEditing()` below,
      // L0.47's hard gate.
      return failClosed(status, current);
    }
    let result: LockCasResult;
    try {
      result = await provider.tryAcquire(path);
    } catch {
      return failClosed("held-by-other-live", current);
    }
    if (!result.acquired) {
      // Lost a race between the read above and the provider's own atomic
      // acquire (another process/tab won it in between) — report the
      // TRUTH the CAS just observed, never pretend we still won.
      return failClosed(statusFromRefusal(result, instanceId, Date.now()), result.record);
    }
    set({
      status: "held-by-me",
      record: result.record,
      path,
      openedAsCopy: false,
      instanceId: result.record?.instanceId ?? instanceId, // identity adoption — see INSTANCE_ID's doc
    });
    return { status: "held-by-me", readOnly: false };
  },

  takeOverEditing: async () => {
    const { provider, instanceId, path, record } = get();
    if (path === null || record === null || !canTakeOver(get().status)) return false;
    let result: LockCasResult;
    try {
      result = await provider.takeOver(path, record.token ?? "");
    } catch {
      return false;
    }
    if (!result.acquired) {
      // No longer stale by the time the CAS actually ran (the original
      // holder heartbeat, or a third instance already took over) — report
      // the CURRENT truth, never pretend the takeover happened.
      set({ status: statusFromRefusal(result, instanceId, Date.now()), record: result.record, unverifiableHeartbeats: 0 });
      return false;
    }
    set({ status: "held-by-me", record: result.record, instanceId: result.record?.instanceId ?? instanceId });
    return true;
  },

  openAsCopy: () => {
    // Deliberately does NOT touch the lock record — the original holder
    // (live or stale) is completely unaffected; this session simply stops
    // treating the original path as its own project identity, mirroring
    // store/project.ts's "no durable path, no identity" rule for a browser
    // download.
    useApp.getState().setCurrentProject(null);
    set({ openedAsCopy: true });
  },

  heartbeat: async () => {
    const { provider, instanceId, path, record, unverifiableHeartbeats } = get();
    if (path === null || record === null) return false;
    // A thrown call is the SAME "unverifiable" shape a provider that
    // catches its own exceptions already reports (R4) — one failure mode.
    let result: LockCasResult;
    try {
      result = await provider.refresh(path, record.token ?? "");
    } catch {
      result = { acquired: false, record: null, unverifiable: true };
    }
    if (result.contended) {
      // R4/R1: CONTENDED is strictly benign (another process's own CAS
      // held the OS lock for this one instant) — touch NOTHING, not even
      // the unverifiable streak; the next scheduled tick just retries.
      return false;
    }
    if (result.unverifiable) {
      // R4: proves nothing either way — never demote on the first miss (a
      // single transient glitch must not flicker read-only). Count
      // consecutive misses instead, leaving `record`/`status` untouched
      // below the threshold so a later successful refresh has the same
      // token to re-verify against (see `UNVERIFIABLE_DEMOTE_AFTER`'s doc).
      const streak = unverifiableHeartbeats + 1;
      if (streak >= UNVERIFIABLE_DEMOTE_AFTER) {
        // Threshold reached — demote rather than leave a stale "held-by-me"
        // banner up indefinitely. `record` is intentionally KEPT (not
        // nulled): this is a demotion pending RECOVERY, not a loss — the
        // success branch below promotes straight back using the SAME
        // token the moment a later tick verifies again.
        set({ status: "held-by-other-live", unverifiableHeartbeats: streak });
      } else {
        set({ unverifiableHeartbeats: streak });
      }
      return false;
    }
    if (!result.acquired) {
      // A DEFINITE loss — the CAS positively confirmed someone/something
      // else (or nothing) is on record now, real information rather than a
      // guess. Demote immediately (the false-positive safety net,
      // lib/lockState.ts's module doc) and reset the unverifiable streak.
      set({ status: statusFromRefusal(result, instanceId, Date.now()), record: result.record, unverifiableHeartbeats: 0 });
      return false;
    }
    // Success — RECOVERY included: unconditionally restores
    // `status: "held-by-me"` so a session demoted by the branch above
    // promotes back, rather than assuming its pre-demotion state.
    set({ record: result.record, status: "held-by-me", unverifiableHeartbeats: 0 });
    return true;
  },

  releaseLock: async () => {
    const { provider, path, record, instanceId } = get();
    if (path === null || record === null || record.instanceId !== instanceId) return;
    await provider.release(path, record.token ?? "").catch(() => false);
    set({ status: "unlocked", record: null, unverifiableHeartbeats: 0 });
  },

  canWriteNow: () => {
    const s = get();
    return s.openedAsCopy || s.status === "held-by-me";
  },
}));
