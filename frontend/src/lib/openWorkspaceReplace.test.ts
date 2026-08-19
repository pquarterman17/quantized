// PR I2 (L0.47): a genuine native workspace open registers with the lock
// state machine — the wiring this file adds to replaceWorkspace/
// replaceWorkspaceSafely, exercised against the real store (loadWorkspace,
// setCurrentProject) and the real useProjectLock (its default in-memory
// provider, per its own module doc).

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LoadedWorkspace } from "./workspace";
import { replaceWorkspace, replaceWorkspaceSafely } from "./openWorkspaceReplace";
import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";
import { useProjectLock } from "../store/projectLock";

vi.mock("../store/toasts", () => ({ toast: vi.fn() }));

function emptyWorkspace(): LoadedWorkspace {
  return {
    datasets: [],
    folders: [],
    workbooks: [],
    activeId: null,
    selectedIds: [],
    expandedFolders: [],
    originFigures: [],
    originFidelity: [],
    smartFolders: [],
    reports: [],
    macroSteps: [],
    recalcMode: "auto",
    figureDocs: [],
    editableFigures: [],
    pages: [],
    migrationWarnings: [],
    plotWindows: [],
    focusedWindowId: null,
    toolWindowLayout: {},
    savedPlotSpecs: [],
    techniqueViewMemory: {},
    savedRois: [],
    quickPlotTemplates: [],
    librarySelection: null,
    workbookLastChild: {},
    expandedWorkbookIds: [],
    collections: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useProjectLock.setState({
    status: "unlocked",
    record: null,
    path: null,
    openedAsCopy: false,
    provider: {
      read: async () => null,
      write: async () => true,
      clear: async () => true,
    },
  });
});

describe("replaceWorkspace — PR I2 lock registration", () => {
  it("registers the native path with useProjectLock and acquires it (unlocked -> held-by-me)", async () => {
    replaceWorkspace(() => useApp.getState(), emptyWorkspace(), { name: "demo.dwk", path: "/p/demo.dwk" });
    // registerWithLockStateMachine is fire-and-forget — flush microtasks.
    await new Promise((r) => setTimeout(r, 0));
    expect(useProjectLock.getState().path).toBe("/p/demo.dwk");
    expect(useProjectLock.getState().status).toBe("held-by-me");
  });

  it("does nothing to the lock store for a browser-picker open (no native identity)", async () => {
    replaceWorkspace(() => useApp.getState(), emptyWorkspace());
    await Promise.resolve();
    expect(useProjectLock.getState().path).toBeNull();
  });

  it("toasts an honest read-only notice when the project is already locked by another live instance", async () => {
    useProjectLock.setState({
      provider: {
        read: async () => ({ instanceId: "other", acquiredAt: 1, heartbeatAt: Date.now() }),
        write: async () => true,
        clear: async () => true,
      },
    });
    replaceWorkspaceSafely(() => useApp.getState(), emptyWorkspace(), { name: "demo.dwk", path: "/p/demo.dwk" });
    await new Promise((r) => setTimeout(r, 0));
    expect(useProjectLock.getState().status).toBe("held-by-other-live");
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/read-only/i), "info");
  });

  it("releases a PREVIOUS project's lock this instance held before acquiring the newly opened one", async () => {
    const store = new Map<string, { instanceId: string; acquiredAt: number; heartbeatAt: number }>();
    useProjectLock.setState({
      provider: {
        read: async (p) => store.get(p) ?? null,
        write: async (p, r) => {
          store.set(p, r);
          return true;
        },
        clear: async (p) => {
          store.delete(p);
          return true;
        },
      },
    });
    replaceWorkspace(() => useApp.getState(), emptyWorkspace(), { name: "a.dwk", path: "/p/a.dwk" });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.has("/p/a.dwk")).toBe(true);

    replaceWorkspace(() => useApp.getState(), emptyWorkspace(), { name: "b.dwk", path: "/p/b.dwk" });
    await new Promise((r) => setTimeout(r, 0));

    expect(store.has("/p/a.dwk")).toBe(false); // released, not stranded
    expect(store.has("/p/b.dwk")).toBe(true);
    expect(useProjectLock.getState().path).toBe("/p/b.dwk");
  });
});
