// "Save workspace" native-vs-browser branch (P1.1 C3). Mocks
// `window.pywebview.api` the same way lib/importEntry.test.ts does for the
// import flow (`setShell`) — the subtlety here is the same one that file's
// header calls out: a native CANCEL must be a no-op, never a fallback to the
// browser download, or backing out of the native "Save As" dialog would pop
// a surprise download in the user's face.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveBlob } from "../lib/download";
import type { DataStruct } from "../lib/types";
import { useApp } from "./useApp";
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

beforeEach(() => {
  vi.clearAllMocks();
  setShell(null);
  localStorage.clear();
  useRecentProjects.setState({ recentProjects: [] });
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
    useProjectLock.setState({ status: "held-by-me", path: "/proj/workspace.dwk", openedAsCopy: false });

    await useApp.getState().saveWorkspace();

    expect(write).toHaveBeenCalledWith("/proj/workspace.dwk", expect.any(String));
  });
});
