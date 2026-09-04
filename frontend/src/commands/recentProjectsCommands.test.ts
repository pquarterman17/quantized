// Recent Projects palette commands (P1.1 C4) — the registry publish/
// re-publish behavior (mirrors useHistoryCommands.test.ts's pattern) plus
// the reopen decision (mirrors lib/reopenRecent.test.ts's missing/offline/
// ok split, applied to a project path instead of a dataset path).

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { askConfirm } from "../components/overlays/ConfirmDialog";
import { pathState, readProject } from "../lib/desktopBridge";
import { WORKSPACE_FORMAT } from "../lib/workspace";
import { useCommands } from "../store/commands";
import { useRecentProjects } from "../store/recentProjects";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";
import { useRecentProjectsCommands } from "./recentProjectsCommands";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../lib/desktopBridge", async (orig) => ({
  ...(await orig<typeof import("../lib/desktopBridge")>()),
  pathState: vi.fn(),
  readProject: vi.fn(),
}));

function action(id: string) {
  const a = useCommands.getState().menuCommands.find((c) => c.id === id);
  if (!a) throw new Error(`no published action ${id}`);
  return a;
}

const WS = JSON.stringify({ format: WORKSPACE_FORMAT, version: 3, datasets: [], folders: [] });

beforeEach(() => {
  vi.mocked(askConfirm).mockReset();
  vi.mocked(pathState).mockReset();
  vi.mocked(readProject).mockReset();
  useCommands.setState({ menuCommands: [] });
  useToasts.setState({ toasts: [] });
  useRecentProjects.setState({ recentProjects: [] });
  useApp.setState({
    datasets: [],
    activeId: null,
    selectedIds: [],
    folders: [],
    workbooks: [],
    currentProject: null,
    projectDirty: false,
  });
});
afterEach(() => useCommands.setState({ menuCommands: [] }));

describe("useRecentProjectsCommands — published registry entries", () => {
  it("publishes nothing on an empty list", () => {
    renderHook(() => useRecentProjectsCommands());
    expect(useCommands.getState().menuCommands).toEqual([]);
  });

  it("publishes one command per entry, in File ▸ Recent Projects", () => {
    useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/workspace.dwk");
    renderHook(() => useRecentProjectsCommands());
    const a = action("recent-project-/p/workspace.dwk");
    expect(a.label).toBe("Open recent project: workspace.dwk");
    expect(a.group).toBe("File");
    expect(a.section).toBe("Recent Projects");
  });

  it("re-publishes when the list changes", () => {
    renderHook(() => useRecentProjectsCommands());
    expect(useCommands.getState().menuCommands).toHaveLength(0);
    act(() => useRecentProjects.getState().pushRecentProject("a", "/a.dwk"));
    expect(useCommands.getState().menuCommands).toHaveLength(1);
  });

  it("coexists with another registry publisher", () => {
    useCommands.getState().setMenuCommands("windows", [
      { id: "window-new", group: "Window", label: "New Graph Window", run: () => {} },
    ]);
    useRecentProjects.getState().pushRecentProject("a", "/a.dwk");
    renderHook(() => useRecentProjectsCommands());
    const ids = useCommands.getState().menuCommands.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["window-new", "recent-project-/a.dwk"]));
  });
});

describe("useRecentProjectsCommands — reopening an entry", () => {
  it("ok: reads the project and loads it straight away on an empty session", async () => {
    vi.mocked(pathState).mockResolvedValue("ok");
    vi.mocked(readProject).mockResolvedValue({ path: "/p/workspace.dwk", content: WS });
    useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/workspace.dwk");
    renderHook(() => useRecentProjectsCommands());
    await act(async () => { action("recent-project-/p/workspace.dwk").run(); });
    expect(readProject).toHaveBeenCalledWith("/p/workspace.dwk");
    expect(askConfirm).not.toHaveBeenCalled();
  });

  it("records the project identity on a successful reopen (P1.2 box 1)", async () => {
    vi.mocked(pathState).mockResolvedValue("ok");
    vi.mocked(readProject).mockResolvedValue({ path: "/p/workspace.dwk", content: WS });
    useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/workspace.dwk");
    renderHook(() => useRecentProjectsCommands());
    await act(async () => { action("recent-project-/p/workspace.dwk").run(); });
    expect(useApp.getState().currentProject).toEqual({ name: "workspace.dwk", path: "/p/workspace.dwk" });
    expect(useApp.getState().projectDirty).toBe(false);
  });

  it("ok + non-empty session: confirms before replacing, same as Open workspace", async () => {
    vi.mocked(pathState).mockResolvedValue("ok");
    vi.mocked(readProject).mockResolvedValue({ path: "/p/workspace.dwk", content: WS });
    vi.mocked(askConfirm).mockResolvedValue(false);
    useApp.setState({ datasets: [{ id: "a", name: "a.dat", data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} } }] });
    useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/workspace.dwk");
    renderHook(() => useRecentProjectsCommands());
    await act(async () => { action("recent-project-/p/workspace.dwk").run(); });
    expect(askConfirm).toHaveBeenCalledOnce();
  });

  // DEFECT A (Sol audit P1-6): reopening a Recent Projects entry now flows
  // through the SAME replaceWorkspace chokepoint the native-open command
  // uses, so it picks up that chokepoint's Recent Projects push for free —
  // and, symmetrically, must NOT push when the replace confirm is declined.
  it("refreshes (not duplicates) the Recent Projects entry on a successful reopen (DEFECT A)", async () => {
    vi.mocked(pathState).mockResolvedValue("ok");
    vi.mocked(readProject).mockResolvedValue({ path: "/p/workspace.dwk", content: WS });
    useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/workspace.dwk");
    renderHook(() => useRecentProjectsCommands());
    await act(async () => { action("recent-project-/p/workspace.dwk").run(); });
    const recent = useRecentProjects.getState().recentProjects;
    expect(recent).toHaveLength(1); // deduped by path — refreshed, not doubled
    expect(recent[0].path).toBe("/p/workspace.dwk");
  });

  it("does NOT refresh the Recent Projects entry when the replace confirm is declined (DEFECT A)", async () => {
    vi.mocked(pathState).mockResolvedValue("ok");
    vi.mocked(readProject).mockResolvedValue({ path: "/p/workspace.dwk", content: WS });
    vi.mocked(askConfirm).mockResolvedValue(false);
    useApp.setState({
      datasets: [{ id: "a", name: "a.dat", data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} } }],
    });
    useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/workspace.dwk");
    const before = useRecentProjects.getState().recentProjects[0].at;
    renderHook(() => useRecentProjectsCommands());
    await act(async () => { action("recent-project-/p/workspace.dwk").run(); });
    expect(askConfirm).toHaveBeenCalledOnce();
    expect(useRecentProjects.getState().recentProjects[0].at).toBe(before); // untouched
  });

  it("offline: toasts and does NOT attempt a read", async () => {
    vi.mocked(pathState).mockResolvedValue("offline");
    useRecentProjects.getState().pushRecentProject("workspace.dwk", "/mnt/share/workspace.dwk");
    renderHook(() => useRecentProjectsCommands());
    await act(async () => { action("recent-project-/mnt/share/workspace.dwk").run(); });
    expect(readProject).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts.some((t) => /not available right now/.test(t.msg))).toBe(true);
  });

  it("missing: toasts and does NOT attempt a read", async () => {
    vi.mocked(pathState).mockResolvedValue("missing");
    useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/workspace.dwk");
    renderHook(() => useRecentProjectsCommands());
    await act(async () => { action("recent-project-/p/workspace.dwk").run(); });
    expect(readProject).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts.some((t) => /not found at its saved location/.test(t.msg))).toBe(true);
  });

  it("a failed read (e.g. a lapsed consent grant) toasts rather than throwing", async () => {
    vi.mocked(pathState).mockResolvedValue("ok");
    vi.mocked(readProject).mockResolvedValue(null);
    useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/workspace.dwk");
    renderHook(() => useRecentProjectsCommands());
    await act(async () => { action("recent-project-/p/workspace.dwk").run(); });
    expect(useToasts.getState().toasts.some((t) => /could not be reopened/.test(t.msg))).toBe(true);
  });
});
