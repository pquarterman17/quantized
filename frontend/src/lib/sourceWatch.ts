// "Auto-update from source" (gap audit 5 lane J, item 10): Origin's Data
// Connector re-imports when its file changes, which is how people watch a
// running PPMS measurement. Here a worksheet with the toggle ON is polled (one
// POST to `/api/source-watch/stat` per interval for every watched file --
// poll-based like the job queue, no WebSocket) and, when its file has changed
// and settled, re-read through `/api/parsers/import`'s live mode and installed
// by the existing re-import path (store/reimportLive.ts), so plots, fits,
// formulas and corrections stay bound.
//
// The rules that keep it honest:
//  * DEBOUNCE: a change is read when the same stamp was seen on two consecutive
//    polls, or after MAX_WAIT_POLLS polls of continuous change (a file written
//    every second never pauses; it stays at most that many polls behind).
//  * NO HALF ROWS: the server cuts an unfinished last line out of the bytes it
//    actually read (UTF-16, CRLF and CR-only aware) and refuses a read during
//    which the file changed (409 -> retried next poll). A held tail is read in
//    full once the file has held still for STABLE_PARTIAL_POLLS polls, so a file
//    whose last line simply lacks a newline is not starved.
//  * UNDO / REDO (store/reimportLive.ts has the full argument): a live update
//    never clears redo; a growing update is quiet and rebases the undo and redo
//    snapshots that hold the installed rows; the worksheet differing from what
//    was installed -- a hand edit, an undo or a redo -- is DIVERGED: the watcher
//    leaves it alone (an undo is a deliberate choice: no re-read until the file
//    really changes), and the file's next change replaces it as one labelled,
//    undoable step. Returning to the installed rows (undoing the edit) clears it.
//  * A missing, unreadable or unreachable file is reported ONCE per episode and
//    the data is left untouched; watching continues. A stat that has not
//    answered (`pending`, a slow or hung share) is reported only after
//    PENDING_POLLS polls in a row; a whole stat call is abandoned after
//    STAT_TIMEOUT_MS. Polling pauses while the app is hidden.
//  * Each update records the read's own baseline as the worksheet's source
//    (`mtime` = the desktop probe's float, `size`, `checksum`), so Relink and
//    Pack keep comparing like with like. The first look compares the file's
//    stamp with that baseline; without a match the file is read once.
//  * The toggle is per worksheet and per SESSION: never saved in the project, so
//    opening a project never starts overwriting data from a file that changed
//    while it was closed. It needs a source PATH, which a browser upload lacks.
//
// Lazy: reached only from the Library row menu registry
// (lib/datasetContextActions.ts) through lib/sourceWatchMenu.ts's dynamic import.

import { statSources, type SourceStat } from "./api/sourceWatch";
import type { DataStruct, Dataset } from "./types";
import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";
import type { ImportCache, LiveOpts, LiveReimport } from "../store/reimportLive";
import { canAutoUpdate, watchedIds, type CanAutoUpdate } from "./sourceWatchMenu";

export { canAutoUpdate, type CanAutoUpdate };

/** Modest on purpose: a stat per watched file, no file reads. */
export const POLL_MS = 2000;
/** Failed reads of one settled file state before giving up on it. */
export const MAX_ATTEMPTS = 3;
/** Polls of continuous change before a file that never pauses is read anyway. */
export const MAX_WAIT_POLLS = 4;
/** One stat call that has not answered by now is abandoned. */
export const STAT_TIMEOUT_MS = 10_000;
/** Polls (~30 s) a file must hold still before a held, unterminated last line is read: long
 *  enough that a buffered logger's pause mid-line rarely gets in, short enough that a finished
 *  file without a final newline is not starved. A row read this way and then completed by the
 *  writer is corrected quietly at the next read (the append test leaves that row out). */
export const STABLE_PARTIAL_POLLS = 15;
/** Consecutive `pending` answers before a file is reported unreachable. */
export const PENDING_POLLS = 3;
/** Backoff after a failed stat: the poll interval doubles per failure, up to 2**this. */
const MAX_BACKOFF_STEPS = 4;
const MAX_WATCHED = 64;

export type WatchPhase = "watching" | "waiting" | "updating" | "missing" | "unavailable" | "error";

interface Entry {
  id: string;
  path: string;
  importedAt: string | undefined;
  /** Stamp of the file content the worksheet holds ("" = behind the file; null = not looked yet). */
  applied: string | null;
  /** A differing stamp seen, waiting to settle. */
  pending: string | null;
  /** The stamp whose read failed MAX_ATTEMPTS times: not retried until it changes. */
  failedStamp: string | null;
  attempts: number;
  /** The stamp of the previous poll, and how many polls in a row have seen the current one. */
  last: string | null;
  same: number;
  /** Polls this change has been seen without being read. */
  waited: number;
  /** Consecutive `pending` stat answers. */
  silent: number;
  /** The `data` this watcher last installed, and its file rows. */
  installed: DataStruct | null;
  base: DataStruct | null;
  /** The worksheet no longer holds `installed` (edit, undo or redo). */
  diverged: boolean;
  /** The last read held back an unfinished last line. */
  held: boolean;
  phase: WatchPhase;
}

export interface WatchDeps {
  stat(paths: string[]): Promise<SourceStat[]>;
  dataset(id: string): Dataset | undefined;
  reimport(id: string, shared: ImportCache, opts: LiveOpts): Promise<LiveReimport>;
  status(message: string, danger?: boolean): void;
  notify(message: string, kind: "ok" | "info" | "danger"): void;
  visible(): boolean;
  now(): number;
  /** Mirrored with the watched ids (the eager menu's check mark), when given. */
  watched?: Set<string>;
}

const WHY: Record<Exclude<SourceStat["state"], "ok">, string> = {
  missing: "is missing (deleted or moved)",
  denied: "cannot be read (permission denied)",
  outside: "is outside the folders this app may read",
  not_file: "is no longer a file",
  offline: "is unreachable (its drive or share is not connected)",
  pending: "is not answering (its drive or share may be hung)",
  invalid: "has an unusable path",
};

/** Does a reopened worksheet's recorded baseline still describe the file with this stamp? */
function matchesBaseline(ds: Dataset | undefined, stamp: string): boolean {
  const [ns, size] = stamp.split(":");
  const { mtime, size: recorded } = ds?.source ?? {};
  if (mtime === undefined || recorded === undefined) return false;
  return Math.abs(Number(ns) / 1e9 - mtime) <= 1e-6 && Number(size) === recorded;
}

export interface Watcher {
  enable(id: string): CanAutoUpdate;
  disable(id: string): void;
  has(id: string): boolean;
  phase(id: string): WatchPhase | null;
  /** One poll round; resolves when every due re-import has settled. */
  tick(): Promise<void>;
  stop(): void;
}

/** The watcher, over injectable effects (the module's own instance wires the
 *  real ones). `timers: false` leaves scheduling to the caller (`tick()`). */
export function createWatcher(deps: WatchDeps, opts: { pollMs?: number; timers?: boolean } = {}): Watcher {
  const pollMs = opts.pollMs ?? POLL_MS;
  const timers = opts.timers ?? true;
  const entries = new Map<string, Entry>();
  /** What was installed per worksheet+path, kept across a toggle off/on while the worksheet
   *  still holds the very `data` installed (a reopened project's copy does not). */
  const remembered = new Map<string, Pick<Entry, "applied" | "installed" | "base" | "held">>();
  let busy = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let backendDown = false;

  const nameOf = (e: Entry): string => deps.dataset(e.id)?.name ?? e.id;
  const clock = (): string => new Date(deps.now()).toLocaleTimeString();
  const sync = (): void => {
    if (!deps.watched) return;
    deps.watched.clear();
    for (const id of entries.keys()) deps.watched.add(id);
  };
  const settle = (e: Entry): void => {
    e.pending = null;
    e.waited = 0;
    e.attempts = 0;
  };

  function schedule(): void {
    if (!timers || timer !== null || entries.size === 0 || !deps.visible()) return;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, pollMs * 2 ** Math.min(failures, MAX_BACKOFF_STEPS));
  }

  /** Report an unusable file once per episode, not per poll. */
  function unusable(e: Entry, state: Exclude<SourceStat["state"], "ok">): void {
    const phase: WatchPhase = state === "missing" ? "missing" : "unavailable";
    if (e.phase !== phase) {
      const why = WHY[state];
      deps.status(`auto-update: source of "${nameOf(e)}" ${why}`, true);
      deps.notify(`The source file of "${nameOf(e)}" ${why} — auto-update is paused; the worksheet is unchanged and will update when the file is back.`, "danger");
    }
    e.phase = phase;
    e.pending = null;
  }

  /** Track whether the worksheet still holds what this watcher installed. */
  function checkDivergence(e: Entry, ds: Dataset | undefined): void {
    if (!e.installed || !ds) return;
    const now = ds.data !== e.installed;
    if (now && !e.diverged) {
      deps.status(`auto-update: "${nameOf(e)}" now differs from its file (an edit, undo or redo) — kept as it is; the file's next change replaces it as one undoable step`);
    } else if (!now && e.diverged) {
      deps.status(`auto-update: "${nameOf(e)}" matches its file again — updates resume`);
    }
    e.diverged = now;
  }

  async function read(e: Entry, shared: ImportCache, hold: boolean, stamp: string): Promise<void> {
    e.phase = "updating";
    const r = await deps.reimport(e.id, shared, { hold, installed: e.installed, base: e.base });
    if (r.ok) {
      const after = deps.dataset(e.id);
      e.applied = r.stamp;
      e.installed = after?.data ?? r.data;
      e.base = after?.corrections && after.raw ? after.raw : e.installed;
      // A read that did not hold may have taken a writer's pause mid-line as a row: the next
      // read compares only the rows before it, so completing that row is still an append.
      if (!hold && e.base && e.base.time.length > 0) e.base = { ...e.base, time: e.base.time.slice(0, -1), values: e.base.values.slice(0, -1) };
      e.diverged = false;
      e.held = r.held;
      e.failedStamp = null;
      settle(e);
      e.phase = "watching";
      if (after) remembered.set(`${e.id}\0${e.path}`, { applied: e.applied, installed: e.installed, base: e.base, held: e.held });
      const tail = r.held ? ` (its last line has no line ending yet: read when it does, or after ${Math.round((STABLE_PARTIAL_POLLS * pollMs) / 1000)} s without change)` : r.reshaped ? " (the file's shape changed)" : "";
      deps.status(`auto-updated "${nameOf(e)}" — ${r.rows} rows at ${clock()}${tail}`);
    } else if (r.stale) {
      e.phase = "waiting"; // the file or the worksheet moved during the read: next poll
    } else if (++e.attempts >= MAX_ATTEMPTS) {
      e.failedStamp = stamp;
      e.attempts = 0;
      e.phase = "error";
      deps.notify(`Auto-update of "${nameOf(e)}" failed: ${r.error} — the worksheet is unchanged; it will try again when the file changes.`, "danger");
    } else {
      e.phase = "waiting";
    }
  }

  async function handle(e: Entry, st: SourceStat, shared: ImportCache): Promise<void> {
    if (st.state === "pending") {
      if (++e.silent >= PENDING_POLLS) unusable(e, "pending");
      return;
    }
    e.silent = 0;
    if (st.state !== "ok" || !st.stamp) return unusable(e, st.state === "ok" ? "invalid" : st.state);
    const stamp = st.stamp;
    e.same = stamp === e.last ? e.same + 1 : 1;
    e.last = stamp;
    const ds = deps.dataset(e.id);
    // First sight: only a recorded source baseline (from an earlier read or the desktop probe)
    // proves the worksheet holds this file state. Anything else is read once -- a first read
    // that finds the same rows adopts them quietly (store/reimportLive.ts). A clock comparison
    // with the import time is not proof: a file appended to just after its import passed it.
    if (e.applied === null) e.applied = matchesBaseline(ds, stamp) ? stamp : "";
    checkDivergence(e, ds);
    const back = e.phase === "missing" || e.phase === "unavailable";
    if (stamp === e.applied) {
      if (back) deps.notify(`The source file of "${nameOf(e)}" is back and unchanged.`, "info");
      if (back || e.phase === "waiting") e.phase = "watching";
      settle(e);
      // A held last line is read in full once the file has held still -- unless the worksheet
      // diverged: that waits for a real change of the file.
      if (e.held && !e.diverged && e.same >= STABLE_PARTIAL_POLLS) await read(e, shared, false, stamp);
      return;
    }
    if (stamp === e.failedStamp) return;
    e.waited = e.pending === null ? 1 : e.waited + 1;
    e.pending = stamp;
    if (e.same < 2 && e.waited < MAX_WAIT_POLLS) {
      e.phase = "waiting";
      deps.status(`auto-update: "${nameOf(e)}" changed — waiting for the file to settle…`);
      return;
    }
    await read(e, shared, e.same < STABLE_PARTIAL_POLLS, stamp);
  }

  async function tick(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      if (!deps.visible()) return; // paused while hidden; the visibility handler polls on return
      for (const e of [...entries.values()]) {
        const ds = deps.dataset(e.id);
        if (ds && ds.importedAt === e.importedAt && ds.source?.path !== e.path) {
          deps.status(`auto-update stopped for "${ds.name}": its source file changed (relinked) — turn auto-update on again to watch the new file`, true);
        }
        if (!ds || ds.source?.path !== e.path || ds.importedAt !== e.importedAt) entries.delete(e.id);
      }
      sync();
      if (entries.size === 0) return;
      const paths = [...new Set([...entries.values()].map((e) => e.path))];
      let stats: SourceStat[];
      try {
        stats = await deps.stat(paths);
      } catch (err) {
        if (!backendDown) deps.notify(`Auto-update paused: the backend could not be reached (${err instanceof Error ? err.message : "error"}). It resumes by itself.`, "danger");
        backendDown = true;
        failures++;
        return;
      }
      backendDown = false;
      failures = 0;
      const byPath = new Map(stats.map((s) => [s.path, s]));
      const shared: ImportCache = new Map(); // worksheets of one file read it once per round
      for (const e of [...entries.values()]) {
        const st = byPath.get(e.path);
        if (st && entries.has(e.id)) await handle(e, st, shared);
      }
    } finally {
      busy = false;
      schedule();
    }
  }

  return {
    enable(id) {
      const ds = deps.dataset(id);
      if (!ds) return { ok: false, reason: "The worksheet no longer exists." };
      const can = canAutoUpdate(ds);
      if (!can.ok) return can;
      if (entries.size >= MAX_WATCHED && !entries.has(id)) return { ok: false, reason: `At most ${MAX_WATCHED} worksheets can be watched at once.` };
      if (!entries.has(id)) {
        const path = ds.source!.path;
        const known = remembered.get(`${id}\0${path}`);
        const mine = known && known.installed === ds.data ? known : null; // the very data installed here
        entries.set(id, {
          id, path, importedAt: ds.importedAt, applied: mine?.applied ?? null, pending: null, failedStamp: null, attempts: 0,
          last: null, same: 0, waited: 0, silent: 0, installed: mine?.installed ?? null, base: mine?.base ?? null, diverged: false, held: mine?.held ?? false, phase: "watching",
        });
        deps.status(`auto-update on for "${ds.name}" — checking its file every ${Math.round(pollMs / 1000)} s`);
        sync();
        if (timers) void tick(); // a first look now, not one interval from now
      }
      return { ok: true };
    },
    disable(id) {
      if (entries.delete(id)) deps.status(`auto-update off for "${deps.dataset(id)?.name ?? id}"`);
      sync();
    },
    has: (id) => entries.has(id),
    phase: (id) => entries.get(id)?.phase ?? null,
    tick,
    stop() {
      entries.clear();
      remembered.clear();
      sync();
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

let instance: Watcher | null = null;

function realWatcher(): Watcher {
  if (instance) return instance;
  const w = createWatcher({
    stat: async (paths) => {
      const abort = new AbortController();
      const t = setTimeout(() => abort.abort(), STAT_TIMEOUT_MS);
      try {
        return await statSources(paths, abort.signal);
      } catch (e) {
        if (abort.signal.aborted) throw new Error(`no answer within ${STAT_TIMEOUT_MS / 1000} s — a network drive may be hanging`);
        throw e;
      } finally {
        clearTimeout(t);
      }
    },
    dataset: (id) => useApp.getState().datasets.find((d) => d.id === id),
    reimport: async (id, shared, opts) => {
      try {
        const live = await import("../store/reimportLive");
        return await live.liveReimport(useApp.setState, useApp.getState, id, shared, opts);
      } catch (e) {
        return { ok: false, stale: false, error: e instanceof Error ? e.message : "error" };
      }
    },
    status: (m, danger) => useApp.getState().setStatus(m, danger ? "danger" : undefined),
    notify: (m, kind) => toast(m, kind),
    visible: () => typeof document === "undefined" || document.visibilityState !== "hidden",
    now: () => Date.now(),
    watched: watchedIds,
  });
  // Back from hidden: poll at once instead of waiting out the interval.
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void w.tick(); });
  instance = w;
  return w;
}


/** Flip the toggle for worksheet `id`; the result says why it could not turn on. */
export function toggleAutoUpdate(id: string): CanAutoUpdate {
  const w = realWatcher();
  if (w.has(id)) {
    w.disable(id);
    return { ok: true };
  }
  const r = w.enable(id);
  if (!r.ok) toast(r.reason, "danger");
  return r;
}
