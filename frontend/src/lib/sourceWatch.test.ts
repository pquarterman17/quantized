// "Auto-update from source" (gap audit 5 lane J, item 10): the watcher's
// debounce, the never-pausing file, unreachable / hung / deleted files, failed
// reads, the hidden-tab pause and the reopen baseline -- over fake effects, no
// timers (`tick()` is the poll). The undo/redo contract runs over the real
// store in store/reimportLive.test.ts.

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { SourceStat } from "./api/sourceWatch";
import { canAutoUpdate, createWatcher, MAX_ATTEMPTS, MAX_WAIT_POLLS, PENDING_POLLS, type WatchDeps } from "./sourceWatch";
import type { Dataset } from "./types";
import type { LiveReimport } from "../store/reimportLive";

const PATH = "/data/ppms.dat";
const IMPORTED = Date.parse("2026-11-16T10:00:00Z");
const ds = (over: Partial<Dataset> = {}): Dataset => ({
  id: "d1",
  name: "ppms.dat",
  data: { time: [0], values: [[0]], labels: ["x"], units: [""], metadata: {} },
  // The baseline an earlier read (or the desktop probe) recorded: it matches OLD below.
  source: { kind: "path", path: PATH, mtime: (IMPORTED - 3_600_000) / 1000, size: 100 },
  importedAt: new Date(IMPORTED).toISOString(),
  ...over,
});
/** A stamp with mtime `ms` (epoch ms) and `size`. */
const stamp = (ms: number, size: number): string => `${BigInt(ms) * 1_000_000n}:${size}:7:1`;
const ok = (ms: number, size: number): SourceStat => ({ path: PATH, state: "ok", stamp: stamp(ms, size) });
const OLD = ok(IMPORTED - 3_600_000, 100);

let state: { dataset: Dataset | undefined; visible: boolean; next: SourceStat | Error };
let reimport: Mock<WatchDeps["reimport"]>;
let status: Mock<WatchDeps["status"]>;
let notify: Mock<WatchDeps["notify"]>;
let deps: WatchDeps;

beforeEach(() => {
  state = { dataset: ds(), visible: true, next: OLD };
  reimport = vi.fn<WatchDeps["reimport"]>(async (): Promise<LiveReimport> => {
    const st = state.next as SourceStat;
    return { ok: true, rows: 7, reshaped: false, labelled: false, stamp: st.stamp!, held: false, data: state.dataset!.data };
  });
  status = vi.fn<WatchDeps["status"]>();
  notify = vi.fn<WatchDeps["notify"]>();
  deps = {
    stat: vi.fn(async () => {
      if (state.next instanceof Error) throw state.next;
      return [state.next];
    }),
    dataset: () => state.dataset,
    reimport,
    status,
    notify,
    visible: () => state.visible,
    now: () => 0,
  };
});
const watcher = () => {
  const w = createWatcher(deps, { timers: false });
  w.enable("d1");
  return w;
};

describe("debounce", () => {
  it("reads a change only once the same stamp repeats", async () => {
    const w = watcher();
    await w.tick(); // the file matches the recorded baseline
    state.next = ok(IMPORTED + 60_000, 150);
    await w.tick();
    expect(reimport).not.toHaveBeenCalled();
    expect(w.phase("d1")).toBe("waiting");
    await w.tick();
    expect(reimport).toHaveBeenCalledTimes(1);
    expect(reimport).toHaveBeenCalledWith("d1", expect.any(Map), { hold: true, installed: null, base: null });
    await w.tick();
    expect(reimport).toHaveBeenCalledTimes(1);
  });

  it("a file that never pauses is still read every MAX_WAIT_POLLS polls", async () => {
    const w = watcher();
    await w.tick();
    for (let i = 1; i < MAX_WAIT_POLLS; i++) {
      state.next = ok(IMPORTED + i * 1000, 100 + i);
      await w.tick();
    }
    expect(reimport).not.toHaveBeenCalled();
    state.next = ok(IMPORTED + 99_000, 999);
    await w.tick();
    expect(reimport).toHaveBeenCalledTimes(1);
  });
});

describe("first sight", () => {
  it("a reopened worksheet whose recorded baseline matches the file is not re-read", async () => {
    const mtime = 1_731_000_000.123456; // the probe's st_mtime float
    state.dataset = ds({ source: { kind: "path", path: PATH, mtime, size: 100 }, importedAt: undefined });
    state.next = { path: PATH, state: "ok", stamp: "1731000000123456000:100:7:1" };
    const w = watcher();
    for (let i = 0; i < 3; i++) await w.tick();
    expect(reimport).not.toHaveBeenCalled();
    state.next = { path: PATH, state: "ok", stamp: "1731000009000000000:120:7:2" };
    await w.tick();
    await w.tick();
    expect(reimport).toHaveBeenCalledTimes(1);
  });

  it("a file newer than its baseline is read once it settles, with no further change needed", async () => {
    state.dataset = ds({ source: { kind: "path", path: PATH, mtime: 1_700_000_000, size: 100 } });
    state.next = ok(IMPORTED + 60_000, 150);
    const w = watcher();
    await w.tick();
    await w.tick();
    expect(reimport).toHaveBeenCalledTimes(1);
  });
});

describe("no recorded baseline", () => {
  it("is read once, even when the file was appended to right after its import", async () => {
    state.dataset = ds({ source: { kind: "path", path: PATH } });
    state.next = ok(IMPORTED + 200, 120); // 0.2 s after the import: no clock rule can tell
    const w = watcher();
    await w.tick();
    await w.tick();
    expect(reimport).toHaveBeenCalledTimes(1);
  });
});

describe("files that cannot be read", () => {
  it("a deleted file is reported once, the worksheet left alone, and its return noticed", async () => {
    const w = watcher();
    await w.tick();
    state.next = { path: PATH, state: "missing" };
    await w.tick();
    await w.tick();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatch(/missing.*unchanged/);
    expect(w.phase("d1")).toBe("missing");
    state.next = OLD;
    await w.tick();
    expect(notify).toHaveBeenLastCalledWith(expect.stringMatching(/back and unchanged/), "info");
    expect(reimport).not.toHaveBeenCalled();
  });

  it("a stat with no answer yet (pending) is not 'unreachable' until it stays so for PENDING_POLLS polls", async () => {
    const w = watcher();
    await w.tick();
    state.next = { path: PATH, state: "pending" };
    for (let i = 1; i < PENDING_POLLS; i++) await w.tick();
    expect(notify).not.toHaveBeenCalled();
    expect(w.phase("d1")).toBe("watching");
    await w.tick();
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/not answering/), "danger");
    state.next = OLD;
    await w.tick();
    expect(w.phase("d1")).toBe("watching");
  });

  it("gives up on one file state after MAX_ATTEMPTS failed reads, until it changes", async () => {
    reimport.mockResolvedValue({ ok: false, stale: false, error: "bad row" });
    const w = watcher();
    await w.tick();
    state.next = ok(IMPORTED + 60_000, 150);
    for (let i = 0; i < MAX_ATTEMPTS + 3; i++) await w.tick();
    expect(reimport).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(w.phase("d1")).toBe("error");
  });

  it("a backend that cannot be reached is reported once", async () => {
    const w = watcher();
    state.next = new Error("down");
    await w.tick();
    await w.tick();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("the toggle", () => {
  it("is paused while the app is hidden", async () => {
    const w = watcher();
    state.visible = false;
    await w.tick();
    expect(deps.stat).not.toHaveBeenCalled();
  });

  it("off and on again does not re-read a file installed here and unchanged since", async () => {
    const w = watcher();
    await w.tick();
    state.next = ok(IMPORTED + 60_000, 150);
    await w.tick();
    await w.tick();
    expect(reimport).toHaveBeenCalledTimes(1);
    w.disable("d1");
    w.enable("d1");
    for (let i = 0; i < 3; i++) await w.tick();
    expect(reimport).toHaveBeenCalledTimes(1);
  });

  it("needs a source path; a relinked worksheet stops being watched", async () => {
    expect(canAutoUpdate(ds({ source: undefined }))).toEqual({ ok: false, reason: expect.stringMatching(/browser upload/) });
    const w = watcher();
    state.dataset = ds({ source: { kind: "path", path: "/elsewhere.dat" } });
    await w.tick();
    expect(w.has("d1")).toBe(false);
    expect(status).toHaveBeenLastCalledWith(expect.stringMatching(/relinked/), true);
  });

  it("keeps the eager menu's watched set in step", () => {
    const watched = new Set<string>();
    const w = createWatcher({ ...deps, watched }, { timers: false });
    w.enable("d1");
    expect([...watched]).toEqual(["d1"]);
    w.disable("d1");
    expect(watched.size).toBe(0);
  });
});
