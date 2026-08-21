// "Save workspace" native-vs-browser branch (P1.1 C3). Mocks
// `window.pywebview.api` the same way lib/importEntry.test.ts does for the
// import flow (`setShell`) — the subtlety here is the same one that file's
// header calls out: a native CANCEL must be a no-op, never a fallback to the
// browser download, or backing out of the native "Save As" dialog would pop
// a surprise download in the user's face.
//
// I2 (P0-3/P1-1): the fake `write_project_file` below ACCEPTS a third
// `lockToken` argument and simulates the real backend's token-CAS check
// (`desktop_bridge.py`'s `write_project_file`) so these tests prove
// `runSaveWorkspace`/`runSaveWorkspaceToFile` actually THREAD the token
// through and handle a `"lock lost"` refusal correctly — the real
// enforcement itself is proven server-side, in
// `tests/test_desktop_bridge_lock.py`.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveBlob } from "../lib/download";
import type { DataStruct } from "../lib/types";
import type { LockRecord } from "../lib/lockState";
import { useApp } from "./useApp";
import { useProjectLock, type LockProvider } from "./projectLock";
import { useRecentProjects } from "./recentProjects";

vi.mock("../lib/download", () => ({ saveBlob: vi.fn() }));

interface FakeApi {
  save_file_dialog?: (name?: string) => Promise<Record<string, unknown>>;
  write_project_file?: (path: string, content: string, lockToken?: string) => Promise<Record<string, unknown>>;
}

function setShell(api: FakeApi | null): void {
  const g = globalThis as { pywebview?: { api?: FakeApi } };
  if (api === null) delete g.pywebview;
  else g.pywebview = { api };
}

const data: DataStruct = {
  time: [0, 1],
  values: [[1], [2]],
  labels: ["y"],
  units: [""],
  metadata: {},
};

let tokenSeq = 0;
function withToken(record: Omit<LockRecord, "token">): LockRecord {
  return { ...record, token: `test-token-${++tokenSeq}` };
}

/** A fresh, genuinely path-keyed in-memory lock provider, atomic-verb shape
 *  (the same shape store/projectLock.ts's own real default uses) — unlike a
 *  fixed-record fake, this correctly reports "unlocked" for any path
 *  nothing was ever written to, and its mutating verbs perform their own
 *  compare-and-swap rather than an unconditional write. Reset every test so
 *  a lock scenario one test sets up can never leak into the next. */
function freshLockProvider(): LockProvider & { store: Map<string, LockRecord> } {
  const store = new Map<string, LockRecord>();
  return {
    store,
    read: async (path) => store.get(path) ?? null,
    tryAcquire: async (path) => {
      const record = withToken({ instanceId: useProjectLock.getState().instanceId, acquiredAt: Date.now(), heartbeatAt: Date.now() });
      store.set(path, record);
      return { acquired: true, record };
    },
    refresh: async (path, token) => {
      const current = store.get(path) ?? null;
      if (current === null || current.token !== token) return { acquired: false, record: current };
      const updated = { ...current, heartbeatAt: Date.now() };
      store.set(path, updated);
      return { acquired: true, record: updated };
    },
    takeOver: async (path, expectedToken) => {
      const current = store.get(path) ?? null;
      if (current === null || current.token !== expectedToken) return { acquired: false, record: current };
      const record = withToken({ instanceId: useProjectLock.getState().instanceId, acquiredAt: Date.now(), heartbeatAt: Date.now() });
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

beforeEach(() => {
  vi.clearAllMocks();
  setShell(null);
  localStorage.clear();
  useRecentProjects.setState({ recentProjects: [] });
  useProjectLock.setState({
    status: "unlocked",
    record: null,
    path: null,
    openedAsCopy: false,
    provider: freshLockProvider(),
  });
  useApp.setState({
    datasets: [{ id: "a", name: "a.dat", data }],
    activeId: "a",
    plotWindows: [],
    focusedWindowId: null,
    currentProject: null,
    projectDirty: false,
  });
});

describe("saveWorkspaceToFile — browser (no desktop shell)", () => {
  it("downloads a blob, byte-identical to the pre-P1.1 behavior", async () => {
    await useApp.getState().saveWorkspaceToFile();
    expect(saveBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = vi.mocked(saveBlob).mock.calls[0];
    expect(name).toBe("workspace.dwk");
    expect(blob.type).toBe("application/json");
  });

  it("records no Recent Projects entry (no path was ever knowable)", async () => {
    await useApp.getState().saveWorkspaceToFile();
    expect(useRecentProjects.getState().recentProjects).toHaveLength(0);
  });
});

describe("saveWorkspaceToFile — desktop shell", () => {
  it("saves natively and never touches the browser download", async () => {
    const write = vi.fn(async () => ({ ok: true, path: "/proj/workspace.dwk" }));
    setShell({
      save_file_dialog: async () => ({ path: "/proj/workspace.dwk" }),
      write_project_file: write,
    });
    await useApp.getState().saveWorkspaceToFile();
    expect(write).toHaveBeenCalledWith("/proj/workspace.dwk", expect.any(String), expect.any(String));
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("records a Recent Projects entry on a successful native save", async () => {
    setShell({
      save_file_dialog: async () => ({ path: "/proj/workspace.dwk" }),
      write_project_file: async () => ({ ok: true, path: "/proj/workspace.dwk" }),
    });
    await useApp.getState().saveWorkspaceToFile();
    const recent = useRecentProjects.getState().recentProjects;
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ name: "workspace.dwk", path: "/proj/workspace.dwk" });
  });

  it("records the project identity and clears dirty (P1.2 box 1)", async () => {
    setShell({
      save_file_dialog: async () => ({ path: "/proj/workspace.dwk" }),
      write_project_file: async () => ({ ok: true, path: "/proj/workspace.dwk" }),
    });
    useApp.getState().markProjectDirty();
    await useApp.getState().saveWorkspaceToFile();
    expect(useApp.getState().currentProject).toEqual({
      name: "workspace.dwk",
      path: "/proj/workspace.dwk",
    });
    expect(useApp.getState().projectDirty).toBe(false);
  });

  it("does NOT fall back to the browser download when the user cancels the save dialog", async () => {
    setShell({
      save_file_dialog: async () => ({ path: null }),
      write_project_file: vi.fn(),
    });
    await useApp.getState().saveWorkspaceToFile();
    expect(saveBlob).not.toHaveBeenCalled();
    expect(useRecentProjects.getState().recentProjects).toHaveLength(0);
  });

  it("falls back to the browser download when the native write fails", async () => {
    setShell({
      save_file_dialog: async () => ({ path: "/proj/workspace.dwk" }),
      write_project_file: async () => ({ ok: false, error: "disk full" }),
    });
    await useApp.getState().saveWorkspaceToFile();
    expect(saveBlob).toHaveBeenCalledTimes(1);
    expect(useRecentProjects.getState().recentProjects).toHaveLength(0);
  });

  it("falls back to the browser download when the bridge exposes no save_file_dialog", async () => {
    setShell({});
    await useApp.getState().saveWorkspaceToFile();
    expect(saveBlob).toHaveBeenCalledTimes(1);
  });

  // P2 (adversarial review, 2026-08-19): "a fresh native dialog is a
  // deliberate destination pick" is not automatically a SAFE one — nothing
  // previously checked that the picked destination isn't the very path
  // another LIVE instance holds the write lock for. A read-only session
  // could Save As, navigate back to the original .dwk, and silently
  // overwrite it.
  it("refuses to overwrite a destination another LIVE instance holds the lock for — never writes, never downloads", async () => {
    const write = vi.fn(async () => ({ ok: true, path: "/proj/locked.dwk" }));
    setShell({
      save_file_dialog: async () => ({ path: "/proj/locked.dwk" }),
      write_project_file: write,
    });
    const provider = useProjectLock.getState().provider as ReturnType<typeof freshLockProvider>;
    provider.store.set(
      "/proj/locked.dwk",
      withToken({ instanceId: "intruder", acquiredAt: 1, heartbeatAt: Date.now() }),
    );

    await useApp.getState().saveWorkspaceToFile();

    expect(write).not.toHaveBeenCalled();
    expect(saveBlob).not.toHaveBeenCalled(); // a refusal, not a failure — no surprise download either
    expect(useApp.getState().status).toMatch(/refused|another instance/i);
    expect(useRecentProjects.getState().recentProjects).toHaveLength(0);
  });

  it("Save As onto a DIFFERENT, unheld destination still works normally", async () => {
    const write = vi.fn(async () => ({ ok: true, path: "/proj/elsewhere.dwk" }));
    setShell({
      save_file_dialog: async () => ({ path: "/proj/elsewhere.dwk" }),
      write_project_file: write,
    });

    await useApp.getState().saveWorkspaceToFile();

    expect(write).toHaveBeenCalledWith("/proj/elsewhere.dwk", expect.any(String), expect.any(String));
  });

  it("Save As onto a path with only a STALE other holder still proceeds (not blocked, per the P2 ruling)", async () => {
    const write = vi.fn(async () => ({ ok: true, path: "/proj/stale.dwk" }));
    setShell({
      save_file_dialog: async () => ({ path: "/proj/stale.dwk" }),
      write_project_file: write,
    });
    const provider = useProjectLock.getState().provider as ReturnType<typeof freshLockProvider>;
    provider.store.set("/proj/stale.dwk", withToken({ instanceId: "long-gone", acquiredAt: 1, heartbeatAt: 1 })); // ancient heartbeat

    await useApp.getState().saveWorkspaceToFile();

    expect(write).toHaveBeenCalledWith("/proj/stale.dwk", expect.any(String), expect.any(String));
  });

  // I2 (P0-3/P1-1): "Save As must acquire the new path and release the old
  // path" — both transfer legs.
  describe("Save As lock transfer (I2 P1-1)", () => {
    it("on a successful write, releases the OLD lock and adopts the NEW one", async () => {
      setShell({
        save_file_dialog: async () => ({ path: "/proj/new.dwk" }),
        write_project_file: async () => ({ ok: true, path: "/proj/new.dwk" }),
      });
      // This instance genuinely holds the OLD project's lock first.
      await useProjectLock.getState().openProject("/proj/old.dwk");
      const provider = useProjectLock.getState().provider as ReturnType<typeof freshLockProvider>;
      expect(provider.store.has("/proj/old.dwk")).toBe(true);

      await useApp.getState().saveWorkspaceToFile();

      expect(provider.store.has("/proj/old.dwk")).toBe(false); // released
      expect(provider.store.has("/proj/new.dwk")).toBe(true); // acquired
      expect(useProjectLock.getState().path).toBe("/proj/new.dwk");
      expect(useProjectLock.getState().status).toBe("held-by-me");
    });

    it("on a write FAILURE, releases the JUST-acquired new lock and leaves the OLD lock untouched", async () => {
      setShell({
        save_file_dialog: async () => ({ path: "/proj/new.dwk" }),
        write_project_file: async () => ({ ok: false, error: "disk full" }),
      });
      await useProjectLock.getState().openProject("/proj/old.dwk");
      const provider = useProjectLock.getState().provider as ReturnType<typeof freshLockProvider>;
      const oldRecordBefore = provider.store.get("/proj/old.dwk");

      await useApp.getState().saveWorkspaceToFile();

      expect(provider.store.has("/proj/new.dwk")).toBe(false); // released after the failed write
      expect(provider.store.get("/proj/old.dwk")).toEqual(oldRecordBefore); // completely untouched
      expect(useProjectLock.getState().path).toBe("/proj/old.dwk"); // still the OLD project
      expect(useProjectLock.getState().status).toBe("held-by-me");
    });
  });
});

// P1.2 box 1: "Save" (Ctrl+S) writes straight to a KNOWN project path with
// no dialog; "Save As" (the describe blocks above) always prompts. This is
// the ⌘S / Ctrl+S routing itself, exercised at the store-action level (the
// keyboard binding is covered separately).
describe("saveWorkspace — quick save to a known project (P1.2 box 1)", () => {
  it("writes directly to the known path — no save dialog", async () => {
    const dialog = vi.fn();
    const write = vi.fn(async () => ({ ok: true, path: "/proj/workspace.dwk" }));
    setShell({ save_file_dialog: dialog, write_project_file: write });
    useApp.getState().setCurrentProject({ name: "workspace.dwk", path: "/proj/workspace.dwk" });

    await useApp.getState().saveWorkspace();

    expect(dialog).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith("/proj/workspace.dwk", expect.any(String), expect.any(String));
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("clears the dirty flag on a successful quick save", async () => {
    setShell({
      save_file_dialog: vi.fn(),
      write_project_file: async () => ({ ok: true, path: "/proj/workspace.dwk" }),
    });
    useApp.getState().setCurrentProject({ name: "workspace.dwk", path: "/proj/workspace.dwk" });
    useApp.getState().markProjectDirty();

    await useApp.getState().saveWorkspace();

    expect(useApp.getState().projectDirty).toBe(false);
  });

  it("surfaces a clear error and does NOT fall back to a browser download when the write fails", async () => {
    setShell({
      save_file_dialog: vi.fn(),
      write_project_file: async () => ({ ok: false, error: "disk full" }),
    });
    useApp.getState().setCurrentProject({ name: "workspace.dwk", path: "/proj/workspace.dwk" });
    useApp.getState().markProjectDirty();

    await useApp.getState().saveWorkspace();

    // Unlike Save As's documented fallback, a quick-save failure must never
    // pop a surprise browser download — the user asked to save to a NAMED
    // project, and a silent substitute would be more confusing than an error.
    expect(saveBlob).not.toHaveBeenCalled();
    expect(useApp.getState().projectDirty).toBe(true);
    expect(useApp.getState().status).toMatch(/save failed/i);
  });

  it("falls back to Save-As behavior (prompts) when no project is known yet", async () => {
    const dialog = vi.fn(async () => ({ path: "/proj/first-save.dwk" }));
    const write = vi.fn(async () => ({ ok: true, path: "/proj/first-save.dwk" }));
    setShell({ save_file_dialog: dialog, write_project_file: write });
    expect(useApp.getState().currentProject).toBeNull();

    await useApp.getState().saveWorkspace();

    expect(dialog).toHaveBeenCalledTimes(1);
    expect(useApp.getState().currentProject).toEqual({
      name: "first-save.dwk",
      path: "/proj/first-save.dwk",
    });
  });

  it("falls back to Save-As behavior (download) in the browser, even with a known project", async () => {
    // A project identity can only ever have come from a native path, so this
    // is a defensive case (e.g. the bridge vanished mid-session) rather than
    // a realistic one — but it must still degrade safely, not throw.
    setShell(null);
    useApp.setState({ currentProject: { name: "workspace.dwk", path: "/proj/workspace.dwk" } });

    await useApp.getState().saveWorkspace();

    expect(saveBlob).toHaveBeenCalledTimes(1);
  });
});

// PR I2 (L0.47): "never permit silent concurrent writes to one project" —
// the quick-save (Ctrl+S) path is the one write that goes straight to a
// KNOWN project path with no fresh dialog, so it is the one this slice
// gates directly against the lock's last-known status for that exact path.
// Save As always goes through a NEW native dialog (a deliberate destination
// pick) and is left ungated — see store/workspaceIO.ts's comment.
describe("saveWorkspace — refuses when this instance does not hold the write lock (PR I2)", () => {
  it("refuses and leaves the project dirty when the lock is held read-only for this exact path", async () => {
    const write = vi.fn(async () => ({ ok: true, path: "/proj/workspace.dwk" }));
    setShell({ save_file_dialog: vi.fn(), write_project_file: write });
    useApp.getState().setCurrentProject({ name: "workspace.dwk", path: "/proj/workspace.dwk" });
    useApp.getState().markProjectDirty();
    useProjectLock.setState({ status: "held-by-other-live", path: "/proj/workspace.dwk", openedAsCopy: false });

    await useApp.getState().saveWorkspace();

    expect(write).not.toHaveBeenCalled();
    expect(useApp.getState().projectDirty).toBe(true);
    expect(useApp.getState().status).toMatch(/read-only|take over/i);
  });

  it("proceeds normally when the lock tracks a DIFFERENT path (the lock system hasn't opined on this project)", async () => {
    const write = vi.fn(async () => ({ ok: true, path: "/proj/workspace.dwk" }));
    setShell({ save_file_dialog: vi.fn(), write_project_file: write });
    useApp.getState().setCurrentProject({ name: "workspace.dwk", path: "/proj/workspace.dwk" });
    useProjectLock.setState({ status: "held-by-other-live", path: "/some/other/project.dwk", openedAsCopy: false });

    await useApp.getState().saveWorkspace();

    expect(write).toHaveBeenCalledWith("/proj/workspace.dwk", expect.any(String), "");
  });

  it("proceeds normally when this instance holds the lock (held-by-me)", async () => {
    const write = vi.fn(async () => ({ ok: true, path: "/proj/workspace.dwk" }));
    setShell({ save_file_dialog: vi.fn(), write_project_file: write });
    useApp.getState().setCurrentProject({ name: "workspace.dwk", path: "/proj/workspace.dwk" });
    // Genuinely acquire (not just poke the cached `status` field) — this
    // writes a real record into the provider naming THIS instance, which
    // the token this test asserts below actually came from.
    await useProjectLock.getState().openProject("/proj/workspace.dwk");
    expect(useProjectLock.getState().status).toBe("held-by-me");
    const token = useProjectLock.getState().record?.token;

    await useApp.getState().saveWorkspace();

    expect(write).toHaveBeenCalledWith("/proj/workspace.dwk", expect.any(String), token);
  });

  // I2 (P0-3/P1-1): the CACHED `status` field above is only refreshed by the
  // ~30s heartbeat tick (store/projectLock.ts's `heartbeat`) — it can be
  // stale. The REAL enforcement is the token threaded into
  // `write_project_file`, verified by the backend's own exclusive-OS-lock
  // CAS in the SAME round-trip as the write — this is the case the pre-fix
  // suite never exercised: cached status still says "held-by-me" while an
  // outside process has ALREADY taken over underneath this one.
  it("refuses (LOCK_LOST) when an outside process has ALREADY taken over — even though the cached status still says held-by-me", async () => {
    // Simulates the REAL backend's own token-CAS refusal
    // (`desktop_bridge.py`'s `write_project_file`) — the actual comparison
    // logic is proven server-side (`tests/test_desktop_bridge_lock.py`);
    // this fake just needs to return the SAME shape a real mismatch would.
    setShell({
      save_file_dialog: vi.fn(),
      write_project_file: vi.fn(async () => ({ ok: false, error: "lock lost" })),
    });
    useApp.getState().setCurrentProject({ name: "workspace.dwk", path: "/proj/workspace.dwk" });
    useApp.getState().markProjectDirty();
    await useProjectLock.getState().openProject("/proj/workspace.dwk"); // genuinely held-by-me

    // An outside process takes over — direct provider mutation, bypassing
    // every action on this store. The cached `status` field is untouched
    // by that direct mutation — this IS the stale-cache condition the I2
    // fix must catch, now enforced by the BACKEND's token check.
    const provider = useProjectLock.getState().provider as ReturnType<typeof freshLockProvider>;
    provider.store.set(
      "/proj/workspace.dwk",
      withToken({ instanceId: "intruder", acquiredAt: Date.now(), heartbeatAt: Date.now() }),
    );
    expect(useProjectLock.getState().status).toBe("held-by-me");

    await useApp.getState().saveWorkspace();

    expect(useApp.getState().status).toMatch(/lock.*lost|refused/i);
    expect(useApp.getState().projectDirty).toBe(true);
    // The store must drop to read-only after the refusal, not keep
    // believing it still holds the lock.
    expect(useProjectLock.getState().canWriteNow()).toBe(false);
  });
});
