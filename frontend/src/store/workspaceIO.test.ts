// "Save workspace" native-vs-browser branch (P1.1 C3). Mocks
// `window.pywebview.api` the same way lib/importEntry.test.ts does for the
// import flow (`setShell`) — the subtlety here is the same one that file's
// header calls out: a native CANCEL must be a no-op, never a fallback to the
// browser download, or backing out of the native "Save As" dialog would pop
// a surprise download in the user's face.

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
  write_project_file?: (path: string, content: string) => Promise<Record<string, unknown>>;
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

/** A fresh, genuinely path-keyed in-memory lock provider — the same shape
 *  store/projectLock.ts's own real default uses (unlike a fixed-record fake,
 *  this correctly reports "unlocked" for any path nothing was ever written
 *  to). Reset every test so a lock scenario one test sets up can never leak
 *  into the next (P2 review round: an earlier fixed-record fake here DID
 *  leak and corrupted unrelated tests' `openProject` results). */
function freshLockProvider(): LockProvider {
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
    expect(write).toHaveBeenCalledWith("/proj/workspace.dwk", expect.any(String));
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
    const { useProjectLock } = await import("./projectLock");
    useProjectLock.setState({
      status: "held-by-other-live",
      path: "/proj/locked.dwk",
      openedAsCopy: false,
      provider: {
        read: async () => ({ instanceId: "intruder", acquiredAt: 1, heartbeatAt: Date.now() }),
        write: async () => true,
        clear: async () => true,
      },
    });

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
    const { useProjectLock } = await import("./projectLock");
    useProjectLock.setState({
      status: "held-by-other-live",
      path: "/proj/locked.dwk", // a DIFFERENT path than the one just picked
      openedAsCopy: false,
    });

    await useApp.getState().saveWorkspaceToFile();

    expect(write).toHaveBeenCalledWith("/proj/elsewhere.dwk", expect.any(String));
  });

  it("Save As onto a path with only a STALE other holder still proceeds (not blocked, per the P2 ruling)", async () => {
    const write = vi.fn(async () => ({ ok: true, path: "/proj/stale.dwk" }));
    setShell({
      save_file_dialog: async () => ({ path: "/proj/stale.dwk" }),
      write_project_file: write,
    });
    const { useProjectLock } = await import("./projectLock");
    useProjectLock.setState({
      status: "held-by-other-stale",
      path: "/proj/stale.dwk",
      openedAsCopy: false,
      provider: {
        read: async () => ({ instanceId: "long-gone", acquiredAt: 1, heartbeatAt: 1 }), // ancient heartbeat
        write: async () => true,
        clear: async () => true,
      },
    });

    await useApp.getState().saveWorkspaceToFile();

    expect(write).toHaveBeenCalledWith("/proj/stale.dwk", expect.any(String));
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
    expect(write).toHaveBeenCalledWith("/proj/workspace.dwk", expect.any(String));
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
    const { useProjectLock } = await import("./projectLock");
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
    const { useProjectLock } = await import("./projectLock");
    useProjectLock.setState({ status: "held-by-other-live", path: "/some/other/project.dwk", openedAsCopy: false });

    await useApp.getState().saveWorkspace();

    expect(write).toHaveBeenCalledWith("/proj/workspace.dwk", expect.any(String));
  });

  it("proceeds normally when this instance holds the lock (held-by-me)", async () => {
    const write = vi.fn(async () => ({ ok: true, path: "/proj/workspace.dwk" }));
    setShell({ save_file_dialog: vi.fn(), write_project_file: write });
    useApp.getState().setCurrentProject({ name: "workspace.dwk", path: "/proj/workspace.dwk" });
    const { useProjectLock } = await import("./projectLock");
    // Genuinely acquire (not just poke the cached `status` field) — this
    // writes a real record into the provider naming THIS instance, which
    // the fresh re-verification below (P1) actually reads back.
    await useProjectLock.getState().openProject("/proj/workspace.dwk");
    expect(useProjectLock.getState().status).toBe("held-by-me");

    await useApp.getState().saveWorkspace();

    expect(write).toHaveBeenCalledWith("/proj/workspace.dwk", expect.any(String));
  });

  // P1 (adversarial review, 2026-08-19): the CACHED `status` field above is
  // only refreshed by the ~30s heartbeat tick (store/projectLock.ts's
  // `heartbeat`) — it can be stale. The actual guarantee runSaveWorkspace's
  // own doc claims ("the very next write attempt is refused") requires a
  // FRESH provider read immediately before the write itself, not a cached
  // flag. This is the case the pre-fix test suite never exercised: cached
  // status still says "held-by-me" while the provider's record has ALREADY
  // been overwritten by another instance underneath this one.
  it("re-verifies against a FRESH provider read immediately before writing — refuses even though the cached status still says held-by-me (P1)", async () => {
    const write = vi.fn(async () => ({ ok: true, path: "/proj/workspace.dwk" }));
    setShell({ save_file_dialog: vi.fn(), write_project_file: write });
    useApp.getState().setCurrentProject({ name: "workspace.dwk", path: "/proj/workspace.dwk" });
    const { useProjectLock } = await import("./projectLock");
    await useProjectLock.getState().openProject("/proj/workspace.dwk"); // genuinely held-by-me

    // Simulate a takeover from an OUTSIDE process — a direct provider write,
    // bypassing every action on this store (the same simulation
    // store/projectLock.test.ts's heartbeat tests already use).
    const provider = useProjectLock.getState().provider;
    await provider.write("/proj/workspace.dwk", {
      instanceId: "intruder",
      acquiredAt: Date.now(),
      heartbeatAt: Date.now(),
    });
    // The cached field is untouched by that direct provider write — this IS
    // the stale-cache condition the fix must catch.
    expect(useProjectLock.getState().status).toBe("held-by-me");

    await useApp.getState().saveWorkspace();

    expect(write).not.toHaveBeenCalled();
    expect(useApp.getState().status).toMatch(/refused|another instance/i);
  });
});
