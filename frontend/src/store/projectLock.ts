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
// (P2, 2026-08-19; UPDATED by the coordinator review round that landed
// `lib/browserLockProvider.ts` AND wired it up — M4, 2026-08-23. Two
// browser tabs collide on TWO surfaces, not one fix):
//  (1) THE SHARED AUTOSAVE SLOT — NOW COVERED. `useWorkspaceAutosave.ts`'s
//  restore/debounced-save loop reads/writes ONE shared IndexedDB/
//  localStorage slot per origin regardless of an explicit project —
//  the surface two tabs ACTUALLY collide on (see that module's scouted
//  header). `App.tsx`'s install effect installs the browser `LockProvider`
//  AND engages this store (`openProject`, unchanged) against a synthetic,
//  stable path naming that slot (`BROWSER_AUTOSAVE_LOCK_PATH`); the
//  debounced save gates on `canWriteNow()` for that exact path
//  (`runSaveWorkspace`'s own "only ever more cautious" discipline). No new
//  verbs, no `lib/lockState.ts` change — red-first coverage in
//  useWorkspaceAutosave.test.ts's "browser autosave lock" tests.
//  (2) AN EXPLICIT NAMED `.dwk` — STILL UNGATED. `hasDesktopShell()` still
//  gates `runSaveWorkspace` (falls to blob-download before any lock check)
//  and `registerWithLockStateMachine` (fires only on a `native` identity, a
//  browser-picker open never has — no durable key). Two tabs picking "the
//  same" file can still clobber each other — L0.47's scenario, on a
//  surface out of this round's scope (a durable cross-tab identity for a
//  picked file is materially larger). Honest named gap: "PR I2 cross-tab
//  lock provider for an explicit browser file" — ungated until it lands.
// Neither is the filesystem provider's to close — two tabs share no
// filesystem access; both are `lib/browserLockProvider.ts`'s domain.

import { create } from "zustand";
import {
  canRelease,
  canTakeOver,
  classifyLock,
  isReadOnly,
  UNVERIFIABLE_DEMOTE_AFTER,
  type LockRecord,
  type LockStatus,
} from "../lib/lockState";
import { useApp } from "./useApp";
import { beginProjectLockOperation, DETACHED_LOCK, isCurrentProjectLockOperation } from "./projectLockEpoch";
import { normalizeCasResult, statusFromRefusal, type LockCasResult, type LockProvider } from "./lockProvider";
export { statusFromRefusal, type LockCasResult, type LockProvider };

// `createInMemoryLockProvider` lives in its own sibling module
// (store/inMemoryLockProvider.ts) — extracted under the 500-line
// god-module ceiling (F1's post-await re-validation pushed this file
// over); imported (for the default provider below) AND re-exported so
// every existing `from "./projectLock"` import site is unaffected — see
// that file's header for why the type-only edge back creates no cycle.
import { createInMemoryLockProvider } from "./inMemoryLockProvider";
export { createInMemoryLockProvider };

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

const SUPERSEDED_OPEN: OpenResult = { status: "unlocked", readOnly: false };
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
   *  no identity). Never touches ANOTHER party's lock record (`canRelease`
   *  gates the best-effort release attempt below). F5 (code review
   *  follow-up): when `record` still names THIS instance — the
   *  unverifiable-demotion recovery path, `heartbeat()`'s own doc — this
   *  DOES clear the local claim (path/record/streak) and best-effort
   *  releases the real lock, so a later successful heartbeat can never
   *  silently re-promote the session onto a path the user just explicitly
   *  relinquished. */
  openAsCopy: () => void;
  /** Refresh this instance's own heartbeat — the false-positive safety net
   *  in practice. Two outcomes, in order of how much they trust the result
   *  (see the implementation's own comments for the full reasoning): a
   *  DEFINITE loss (a real CAS mismatch) demotes to read-only IMMEDIATELY;
   *  an UNVERIFIABLE tick (R4: no bridge / thrown / malformed / a bounded
   *  contention refusal — R1's landed contract folds that into this SAME
   *  outcome) proves nothing, so it only demotes after
   *  `UNVERIFIABLE_DEMOTE_AFTER` consecutive misses, and recovers straight
   *  back to `held-by-me` (same token, not a fresh acquire) the moment a
   *  later tick verifies again. A SOFT SUCCESS (`acquired: true` with
   *  `contended: true` — R1's contract) is just an ordinary success; it
   *  needs no special handling and flows through the same success path.
   *  `useProjectLockHeartbeat.ts` keeps polling past an unverifiable
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
    const myEpoch = beginProjectLockOperation();
    const { provider, instanceId } = get();
    const now = Date.now();
    // Every non-acquiring outcome: never assume success, and always zero the streak (a PRIOR
    // path's leftover count must not keep the heartbeat alive against a record that isn't ours).
    const failClosed = (status: LockStatus, record: LockRecord | null): OpenResult => {
      if (!isCurrentProjectLockOperation(myEpoch)) return SUPERSEDED_OPEN;
      set({ ...DETACHED_LOCK, status, record, path });
      return { status, readOnly: isReadOnly(status) };
    };
    let current: LockRecord | null;
    try {
      current = await provider.read(path);
    } catch {
      return failClosed("held-by-other-live", null);
    }
    if (!isCurrentProjectLockOperation(myEpoch)) return SUPERSEDED_OPEN;
    const status = classifyLock(current, instanceId, now);
    if (status !== "unlocked" && status !== "held-by-me") {
      return failClosed(status, current); // read-only (live OR stale): a stale lock is taken over only via explicit takeOverEditing (L0.47)
    }
    let result: LockCasResult;
    try {
      result = normalizeCasResult(await provider.tryAcquire(path)); // F1
    } catch {
      return failClosed("held-by-other-live", current);
    }
    if (!isCurrentProjectLockOperation(myEpoch)) {
      if (result.acquired && result.record !== null) {
        void provider.release(path, result.record.token ?? "").catch(() => false);
      }
      return SUPERSEDED_OPEN;
    }
    if (!result.acquired) {
      return failClosed(statusFromRefusal(result, instanceId, Date.now()), result.record); // lost the read->acquire race: report what the CAS saw
    }
    set({
      status: "held-by-me",
      record: result.record,
      path,
      openedAsCopy: false,
      unverifiableHeartbeats: 0, // F3: a fresh acquire starts a clean streak, never a PRIOR path's
      instanceId: result.record?.instanceId ?? instanceId, // identity adoption — see INSTANCE_ID's doc
    });
    return { status: "held-by-me", readOnly: false };
  },

  takeOverEditing: async () => {
    const { provider, instanceId, path, record } = get();
    if (path === null || record === null || !canTakeOver(get().status)) return false;
    const myEpoch = beginProjectLockOperation(); // a takeover is an acquisition: it supersedes, and is superseded
    let result: LockCasResult;
    try {
      result = normalizeCasResult(await provider.takeOver(path, record.token ?? "")); // F1
    } catch {
      return false;
    }
    if (!isCurrentProjectLockOperation(myEpoch)) {
      // Closed or switched while the CAS ran: never re-attach, and free a won lock.
      if (result.acquired && result.record !== null) void provider.release(path, result.record.token ?? "").catch(() => false);
      return false;
    }
    if (!result.acquired) {
      // No longer stale by the time the CAS actually ran (the original
      // holder heartbeat, or a third instance already took over) — report
      // the CURRENT truth, never pretend the takeover happened.
      set({ status: statusFromRefusal(result, instanceId, Date.now()), record: result.record, unverifiableHeartbeats: 0 });
      return false;
    }
    // F3: same reset as openProject's success branch — a won takeover is
    // also a fresh session, never demoted by a streak from before it won.
    set({
      status: "held-by-me",
      record: result.record,
      unverifiableHeartbeats: 0,
      instanceId: result.record?.instanceId ?? instanceId,
    });
    return true;
  },

  openAsCopy: () => {
    beginProjectLockOperation();
    // `canRelease` refuses unless `record` actually names THIS instance,
    // so an ordinary "someone else holds it" case is unaffected. When it
    // DOES name us (the unverifiable-demotion recovery path — `heartbeat()`
    // deliberately keeps record/token through a demotion so a returning
    // bridge can re-verify), Open as Copy is the user EXPLICITLY declining
    // that claim: clear path/record/streak/status (F5 round 2+3 — leaving
    // ANY of them would let a later successful heartbeat silently
    // re-promote this session, or leave `status` a PHANTOM lock the
    // status-gated Take Over command would still act on) and best-effort
    // release the real lock so a genuinely-still-held token is freed
    // rather than left to expire only via staleness.
    const { provider, path, record, instanceId } = get();
    if (path !== null && record !== null && canRelease(record, instanceId)) {
      void provider.release(path, record.token ?? "").catch(() => false);
    }
    useApp.getState().setCurrentProject(null);
    set({ ...DETACHED_LOCK, openedAsCopy: true, status: "unlocked" });
  },

  heartbeat: async () => {
    const { provider, path, record, instanceId } = get();
    if (path === null || record === null) return false;
    // F4 (round 3): bail BEFORE calling provider.refresh at all when the
    // snapshot record no longer names THIS instance — a real CAS validates
    // by token match, not caller identity, so sending a foreign token can
    // legitimately succeed, bumping the INTRUDER's heartbeatAt on disk and
    // delaying its legitimate stale-takeover. The post-await re-validation
    // below only ever protected this session's own LOCAL state, never
    // that remote side-effect of the call itself.
    if (record.instanceId !== instanceId) return false;
    const token = record.token ?? "";
    // A thrown call is the SAME "unverifiable" shape a provider that
    // catches its own exceptions already reports (R4) — one failure mode.
    let result: LockCasResult;
    try {
      result = await provider.refresh(path, token);
    } catch {
      result = { acquired: false, record: null, unverifiable: true };
    }
    result = normalizeCasResult(result); // F1 (round 3): a null-record "success" is not a success
    // F1 (round 2): re-validate against the LIVE store before any set()
    // below — a straggler tick resolving after the session switched
    // projects, or CAS-succeeding on ANOTHER holder's own currently-valid
    // token (a real backend accepts by token match, not caller identity),
    // must never write. Token AND instanceId both still matching the LIVE
    // record (mirrors releaseLock's guard) is exactly "still the SAME
    // identity this call started with" — a definite-loss/other-holder
    // record never satisfies it, since only OUR OWN acquire/takeover ever
    // adopts `instanceId` to match a record.
    const live = get();
    if (live.path !== path || live.record === null || live.record.token !== token || live.record.instanceId !== live.instanceId) {
      return false; // stale tick — drop the write entirely, touch nothing
    }
    // R1's landed contract: a `contended` SUCCESS (`result.acquired` true)
    // needs no special handling — it falls straight through to the
    // ordinary success branch below like any other. Only a bounded
    // contention refusal (`unverifiable: true`) reaches the branch here.
    if (result.unverifiable) {
      // R4: proves nothing either way — never demote on the first miss (a
      // single transient glitch must not flicker read-only). Count
      // consecutive misses instead (read LIVE — an overlapping tick may
      // already have bumped it), leaving `record`/`status` untouched below
      // the threshold so a later successful refresh has the same token to
      // re-verify against (see `UNVERIFIABLE_DEMOTE_AFTER`'s doc).
      const streak = live.unverifiableHeartbeats + 1;
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
      set({ status: statusFromRefusal(result, live.instanceId, Date.now()), record: result.record, unverifiableHeartbeats: 0 });
      return false;
    }
    // Success — RECOVERY included: unconditionally restores
    // `status: "held-by-me"` so a session demoted by the branch above
    // promotes back, rather than assuming its pre-demotion state.
    set({ record: result.record, status: "held-by-me", unverifiableHeartbeats: 0 });
    return true;
  },

  releaseLock: async () => {
    beginProjectLockOperation();
    const { provider, path, record, instanceId } = get();
    if (path === null || record === null || record.instanceId !== instanceId) return;
    set({ ...DETACHED_LOCK, status: "unlocked" });
    await provider.release(path, record.token ?? "").catch(() => false);
  },

  canWriteNow: () => {
    const s = get();
    return s.openedAsCopy || s.status === "held-by-me";
  },
}));
