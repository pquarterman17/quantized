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
// Editing choice L0.47 requires. `verifyBeforeWrite` (lib/lockState.ts) is
// re-checked on every `heartbeat()` tick, which is this module's realization
// of that module's "FALSE-POSITIVE RISK" safety net: a heartbeat that finds
// the lock record no longer names this instance demotes the session to
// read-only immediately, rather than letting a resumed-from-suspension
// instance believe it can still write.
//
// FILESYSTEM PROVIDER — BOOKED DEFER (frozen-scope item 8's explicit
// escape hatch): the default provider below is IN-MEMORY, process-local —
// it exercises the full state machine (acquire/read-only/stale/takeover/
// heartbeat) in every environment (browser tab, test, and a desktop app
// that hasn't wired persistence yet), but it is NOT genuinely cross-process:
// two SEPARATE `qz --desktop` processes each get their own empty Map, so
// today this always classifies as `unlocked` the first time either one
// opens a given project path. Making it real needs a lock record that
// SURVIVES outside any one process — a file beside the project, written
// through the exact write-consent discipline `desktop_bridge.py`'s
// `save_file_dialog`/`write_project_file` pair already established
// (backend-verifiable, never caller-asserted; CLAUDE.md's read-first
// section is explicit that no new filesystem authority may skip this). That
// is new js_api surface (an `acquire_lock`/`refresh_lock`/`release_lock`
// triple deriving a sibling `.qzlock` path from an ALREADY write-consented
// project path — the same "derive from, don't invent, an existing consent"
// shape `grant_source_paths`'s P1.7 ruling used for declared sources) which
// this slice's budget does not allow to design and adversarially review
// responsibly. Booked home: `desktop_bridge.py`'s next slice, "PR I2
// filesystem lock provider" — this store's `LockProvider` interface is
// exactly the seam that slice plugs into; nothing here needs to change
// shape when it lands, only `setProvider`'s argument.
//
// Deliberately NOT touched, per the explicit instruction: `desktop_consent.py`
// is not weakened, duplicated, or reached into by this slice at all — the
// in-memory provider below never calls into it, and the booked filesystem
// provider's OWN future write must go through the real module unmodified.

import { create } from "zustand";

import {
  acquire,
  canTakeOver,
  classifyLock,
  isReadOnly,
  refreshHeartbeat,
  takeOver,
  verifyBeforeWrite,
  type LockRecord,
  type LockStatus,
} from "../lib/lockState";
import { useApp } from "./useApp";

export interface LockProvider {
  read: (projectPath: string) => Promise<LockRecord | null>;
  /** Resolves `false` on a write failure/denial (e.g. a future filesystem
   *  provider hitting a permissions error) — the caller must treat that the
   *  same as "could not acquire", never assume success. */
  write: (projectPath: string, record: LockRecord) => Promise<boolean>;
  clear: (projectPath: string) => Promise<boolean>;
}

/** The default, process-local provider — see this module's header for why
 *  it is NOT a cross-process implementation yet. */
function createInMemoryLockProvider(): LockProvider {
  const store = new Map<string, LockRecord>();
  return {
    read: async (path) => store.get(path) ?? null,
    write: async (path, record) => {
      store.set(path, record);
      return true;
    },
    clear: async (path) => {
      store.delete(path);
      return true;
    },
  };
}

let _instanceSeq = 0;
/** One id per running process/tab, minted once at module load — every
 *  `LockRecord` this instance ever writes carries the SAME id, so a
 *  reopen/refresh is recognizably "still me" to `classifyLock`. */
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
  readonly instanceId: string;
  provider: LockProvider;
  /** Test/future-filesystem-provider seam — see this module's header. */
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
   *  in practice: a fresh read runs FIRST, and if the record no longer
   *  names this instance (a stale-takeover raced ahead of this tick), the
   *  session demotes to read-only and this resolves `false` instead of
   *  silently claiming the refresh succeeded. */
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
  instanceId: INSTANCE_ID,
  provider: createInMemoryLockProvider(),

  setProvider: (provider) => set({ provider }),

  openProject: async (path) => {
    const { provider, instanceId } = get();
    const now = Date.now();
    let current: LockRecord | null;
    try {
      current = await provider.read(path);
    } catch {
      // A read failure is NOT "unlocked" — conservatively treat it as
      // unknowable-but-unwritable rather than guessing this instance is
      // free to acquire (see this module's doc: never assume success).
      set({ status: "held-by-other-live", record: null, path, openedAsCopy: false });
      return { status: "held-by-other-live", readOnly: true };
    }
    const status = classifyLock(current, instanceId, now);
    if (status === "unlocked" || status === "held-by-me") {
      const fresh = acquire(instanceId, now);
      const wrote = await provider.write(path, fresh).catch(() => false);
      if (!wrote) {
        set({ status: "held-by-other-live", record: current, path, openedAsCopy: false });
        return { status: "held-by-other-live", readOnly: true };
      }
      set({ status: "held-by-me", record: fresh, path, openedAsCopy: false });
      return { status: "held-by-me", readOnly: false };
    }
    set({ status, record: current, path, openedAsCopy: false });
    return { status, readOnly: isReadOnly(status) };
  },

  takeOverEditing: async () => {
    const { provider, instanceId, path } = get();
    if (path === null || !canTakeOver(get().status)) return false;
    const now = Date.now();
    let current: LockRecord | null;
    try {
      current = await provider.read(path);
    } catch {
      return false;
    }
    const result = takeOver(current, instanceId, now);
    if (result === null) {
      // No longer stale by the time we checked again (the original holder
      // heartbeat, or a third instance already took over) — report the
      // CURRENT truth, never pretend the takeover happened.
      set({ status: classifyLock(current, instanceId, now), record: current });
      return false;
    }
    const wrote = await provider.write(path, result).catch(() => false);
    if (!wrote) return false;
    set({ status: "held-by-me", record: result });
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
    const { provider, instanceId, path, record } = get();
    if (path === null || record === null) return false;
    let current: LockRecord | null;
    try {
      current = await provider.read(path);
    } catch {
      return false;
    }
    if (!verifyBeforeWrite(current, instanceId)) {
      // Lost the lock underneath us — demote honestly rather than keep
      // believing the last-known "held-by-me" status.
      set({ status: classifyLock(current, instanceId, Date.now()), record: current });
      return false;
    }
    const refreshed = refreshHeartbeat(current, instanceId, Date.now());
    if (refreshed === null) return false; // defensive; verifyBeforeWrite already guarantees this won't fire
    const wrote = await provider.write(path, refreshed).catch(() => false);
    if (!wrote) return false;
    set({ record: refreshed });
    return true;
  },

  releaseLock: async () => {
    const { provider, path, record, instanceId } = get();
    if (path === null || record === null || record.instanceId !== instanceId) return;
    await provider.clear(path).catch(() => false);
    set({ status: "unlocked", record: null });
  },

  canWriteNow: () => {
    const s = get();
    return s.openedAsCopy || s.status === "held-by-me";
  },
}));
