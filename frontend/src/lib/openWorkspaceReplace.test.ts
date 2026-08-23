// PR I2 (L0.47): a genuine native workspace open registers with the lock
// state machine — the wiring this file adds to replaceWorkspace/
// replaceWorkspaceSafely, exercised against the real store (loadWorkspace,
// setCurrentProject) and the real useProjectLock (its default in-memory
// provider, per its own module doc). I2 (P0-3/P1-1): every fake provider
// below uses the ATOMIC-VERB shape (`tryAcquire`/`refresh`/`takeOver`/
// `release`) — no test composes a mutation out of a separate read followed
// by an unconditional write.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LoadedWorkspace } from "./workspace";
import { replaceWorkspace, replaceWorkspaceSafely } from "./openWorkspaceReplace";
import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";
import { useProjectLock, type LockProvider } from "../store/projectLock";
import type { LockRecord } from "./lockState";
import { useRecentProjects } from "../store/recentProjects";
import { useRelink } from "../store/relink";

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
    visibleDetailsColumns: [],
    plotRecipes: [],
  };
}

let tokenSeq = 0;
function withToken(record: Omit<LockRecord, "token">): LockRecord {
  return { ...record, token: `test-token-${++tokenSeq}` };
}

/** A genuinely path-keyed, atomic-verb fake provider backed by `store` —
 *  exposed so a test can seed a pre-existing record OR inspect what ended
 *  up on record after a switch. */
function pathKeyedProvider(): LockProvider & { store: Map<string, LockRecord> } {
  const store = new Map<string, LockRecord>();
  return {
    store,
    read: async (p) => store.get(p) ?? null,
    tryAcquire: async (p) => {
      const record = withToken({ instanceId: useProjectLock.getState().instanceId, acquiredAt: Date.now(), heartbeatAt: Date.now() });
      store.set(p, record);
      return { acquired: true, record };
    },
    refresh: async (p, token) => {
      const current = store.get(p) ?? null;
      if (current === null || current.token !== token) return { acquired: false, record: current };
      const updated = { ...current, heartbeatAt: Date.now() };
      store.set(p, updated);
      return { acquired: true, record: updated };
    },
    takeOver: async (p, expectedToken) => {
      const current = store.get(p) ?? null;
      if (current === null || current.token !== expectedToken) return { acquired: false, record: current };
      const record = withToken({ instanceId: useProjectLock.getState().instanceId, acquiredAt: Date.now(), heartbeatAt: Date.now() });
      store.set(p, record);
      return { acquired: true, record };
    },
    release: async (p, token) => {
      const current = store.get(p) ?? null;
      if (current === null || current.token !== token) return false;
      store.delete(p);
      return true;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useProjectLock.setState({
    status: "unlocked",
    record: null,
    path: null,
    openedAsCopy: false,
    provider: pathKeyedProvider(),
  });
  useRecentProjects.setState({ recentProjects: [] });
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
    const provider = useProjectLock.getState().provider as ReturnType<typeof pathKeyedProvider>;
    provider.store.set("/p/demo.dwk", withToken({ instanceId: "other", acquiredAt: 1, heartbeatAt: Date.now() }));
    replaceWorkspaceSafely(() => useApp.getState(), emptyWorkspace(), { name: "demo.dwk", path: "/p/demo.dwk" });
    await new Promise((r) => setTimeout(r, 0));
    expect(useProjectLock.getState().status).toBe("held-by-other-live");
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/read-only/i), "info");
  });

  it("releases a PREVIOUS project's lock this instance held before acquiring the newly opened one", async () => {
    const store = (useProjectLock.getState().provider as ReturnType<typeof pathKeyedProvider>).store;
    replaceWorkspace(() => useApp.getState(), emptyWorkspace(), { name: "a.dwk", path: "/p/a.dwk" });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.has("/p/a.dwk")).toBe(true);

    replaceWorkspace(() => useApp.getState(), emptyWorkspace(), { name: "b.dwk", path: "/p/b.dwk" });
    await new Promise((r) => setTimeout(r, 0));

    expect(store.has("/p/a.dwk")).toBe(false); // released, not stranded
    expect(store.has("/p/b.dwk")).toBe(true);
    expect(useProjectLock.getState().path).toBe("/p/b.dwk");
  });

  // P3 (adversarial review, 2026-08-19): `setCurrentProject` inside
  // `replaceWorkspace` is SYNCHRONOUS, but the old `registerWithLockStateMachine`
  // only pointed `useProjectLock.path` at the new project INSIDE an async
  // IIFE — so there was a real window, observable with zero `await`, where
  // `useApp.currentProject.path` already named the new project while
  // `useProjectLock.path` still named the old one (or nothing at all). Any
  // save gate that compares the two (`lock.path === project.path`) sees a
  // manufactured mismatch and skips its own check entirely — ungated.
  it("closes the ungated micro-window: useProjectLock.path already matches the new project the INSTANT currentProject flips, no await needed (P3)", () => {
    const s = () => useApp.getState();
    replaceWorkspace(s, emptyWorkspace(), { name: "demo.dwk", path: "/p/demo.dwk" });
    // Deliberately NO await above — these assertions run in the exact
    // micro-window a same-tick Ctrl+S could land in.
    expect(s().currentProject?.path).toBe("/p/demo.dwk");
    expect(useProjectLock.getState().path).toBe("/p/demo.dwk");
    // Conservative-by-default placeholder: a write is refused until the
    // real check resolves, never silently allowed through the gap.
    expect(useProjectLock.getState().canWriteNow()).toBe(false);
  });

  it("the placeholder resolves to the real, accurate status once the async check completes", async () => {
    const s = () => useApp.getState();
    replaceWorkspace(s, emptyWorkspace(), { name: "demo.dwk", path: "/p/demo.dwk" });
    await new Promise((r) => setTimeout(r, 0));
    // An unlocked project settles to genuinely writable, not stuck on the
    // conservative placeholder forever.
    expect(useProjectLock.getState().status).toBe("held-by-me");
    expect(useProjectLock.getState().canWriteNow()).toBe(true);
  });

  it("still releases the OLD project's lock across a switch even though the placeholder now occupies `path` first (P3 regression guard)", async () => {
    const store = (useProjectLock.getState().provider as ReturnType<typeof pathKeyedProvider>).store;
    const s = () => useApp.getState();
    replaceWorkspace(s, emptyWorkspace(), { name: "a.dwk", path: "/p/a.dwk" });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.has("/p/a.dwk")).toBe(true);

    replaceWorkspace(s, emptyWorkspace(), { name: "b.dwk", path: "/p/b.dwk" });
    await new Promise((r) => setTimeout(r, 0));

    expect(store.has("/p/a.dwk")).toBe(false); // still released, not stranded by the placeholder
    expect(store.has("/p/b.dwk")).toBe(true);
  });
});

// DEFECT A (Sol audit P1-6): the Recent Projects push moved here from
// lib/openWorkspaceCommand.ts's native-open READ, so it fires exactly once
// the replace is actually applied — see recordNativeOpen's doc.
describe("replaceWorkspace / replaceWorkspaceSafely — Recent Projects push (DEFECT A)", () => {
  it("replaceWorkspace records a Recent Projects entry for a native identity", () => {
    replaceWorkspace(() => useApp.getState(), emptyWorkspace(), { name: "demo.dwk", path: "/p/demo.dwk" });
    const recent = useRecentProjects.getState().recentProjects;
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ name: "demo.dwk", path: "/p/demo.dwk" });
  });

  it("replaceWorkspaceSafely records a Recent Projects entry for a native identity too", () => {
    replaceWorkspaceSafely(() => useApp.getState(), emptyWorkspace(), { name: "demo.dwk", path: "/p/demo.dwk" });
    expect(useRecentProjects.getState().recentProjects).toHaveLength(1);
  });

  it("neither records anything for a browser-picker open (no native identity)", () => {
    replaceWorkspace(() => useApp.getState(), emptyWorkspace());
    expect(useRecentProjects.getState().recentProjects).toHaveLength(0);
  });
});

// C1 (review F4): the backend independently revokes relink directory grants
// at the native project-open moment, but the STORE's `newRootConsented`
// flag would survive an open relink panel across a project switch — the
// one state the flag exists to label ("this root was really picked and is
// really granted") would then be false. Both replace chokepoints close the
// panel, which resets the flag and revokes frontend-side too.
describe("replaceWorkspace / replaceWorkspaceSafely — relink panel close (C1 F4)", () => {
  it("replaceWorkspace closes an open relink panel and drops its consent flag", () => {
    useRelink.setState({ open: true, newRoot: "/granted/root", newRootConsented: true });
    replaceWorkspace(() => useApp.getState(), emptyWorkspace(), { name: "demo.dwk", path: "/p/demo.dwk" });
    expect(useRelink.getState().open).toBe(false);
    expect(useRelink.getState().newRootConsented).toBe(false);
  });

  it("replaceWorkspaceSafely does the same", () => {
    useRelink.setState({ open: true, newRootConsented: true });
    replaceWorkspaceSafely(() => useApp.getState(), emptyWorkspace(), { name: "demo.dwk", path: "/p/demo.dwk" });
    expect(useRelink.getState().open).toBe(false);
    expect(useRelink.getState().newRootConsented).toBe(false);
  });
});
