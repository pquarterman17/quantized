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
