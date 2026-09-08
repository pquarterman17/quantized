// Recent Projects palette commands (P1.1 C4) — the registry publish/
// re-publish behavior (mirrors useHistoryCommands.test.ts's pattern) plus
// the reopen decision (mirrors lib/reopenRecent.test.ts's missing/offline/
// ok split, applied to a project path instead of a dataset path).

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { askConfirm } from "../components/overlays/ConfirmDialog";
import { CANCELLED, openProject, pathState, readProject } from "../lib/desktopBridge";
import { WORKSPACE_FORMAT } from "../lib/workspace";
import { useCommands } from "../store/commands";
import { useRecentProjects } from "../store/recentProjects";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";
import { useWorkingPaths } from "../store/workingPaths";
import { useRecentProjectsCommands } from "./recentProjectsCommands";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../lib/desktopBridge", async (orig) => ({
  ...(await orig<typeof import("../lib/desktopBridge")>()),
  pathState: vi.fn(),
  readProject: vi.fn(),
  openProject: vi.fn(),
}));

function action(id: string) {
  const a = useCommands.getState().menuCommands.find((c) => c.id === id);
  if (!a) throw new Error(`no published action ${id}`);
  return a;
}

const WS = JSON.stringify({ format: WORKSPACE_FORMAT, version: 3, datasets: [], folders: [] });

// P1.7 PR 3 (Pack Project, frontend half): a packed project's dataset
// carries a `kind: "bundle"` source, resolvable only once the reopen knows
// the `.dwk`'s own directory.
const WS_WITH_BUNDLE_SOURCE = JSON.stringify({
  format: WORKSPACE_FORMAT,
  version: 4,
  datasets: [
    {
      id: "r1",
      name: "r1.dat",
      data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
      source: { kind: "bundle", path: "sources/r1.dat" },
    },
  ],
  folders: [],
});

beforeEach(() => {
  vi.mocked(askConfirm).mockReset();
  vi.mocked(pathState).mockReset();
  vi.mocked(readProject).mockReset();
  vi.mocked(openProject).mockReset();
  vi.mocked(openProject).mockResolvedValue(null);
  useWorkingPaths.setState({ paths: [], current: "" });
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

  // P1.7 PR 3: a reopen knows the `.dwk`'s own directory (`opened.path`), so
  // a packed project's `kind: "bundle"` source resolves to a real absolute
  // path under it, same as a fresh native open.
  it("resolves a packed project's bundle-relative source under the project's own directory", async () => {
    vi.mocked(pathState).mockResolvedValue("ok");
    vi.mocked(readProject).mockResolvedValue({ path: "/p/workspace.dwk", content: WS_WITH_BUNDLE_SOURCE });
    useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/workspace.dwk");
    renderHook(() => useRecentProjectsCommands());
    await act(async () => { action("recent-project-/p/workspace.dwk").run(); });
    const ds = useApp.getState().datasets.find((d) => d.id === "r1");
    expect(ds?.source).toEqual({ kind: "path", path: "/p/sources/r1.dat" });
  });

  it("resolves a packed project's bundle-relative source under a Windows-style project directory", async () => {
    vi.mocked(pathState).mockResolvedValue("ok");
    vi.mocked(readProject).mockResolvedValue({
      path: "C:\\Users\\me\\proj\\workspace.dwk",
      content: WS_WITH_BUNDLE_SOURCE,
    });
    useRecentProjects.getState().pushRecentProject("workspace.dwk", "C:\\Users\\me\\proj\\workspace.dwk");
    renderHook(() => useRecentProjectsCommands());
    await act(async () => { action("recent-project-C:\\Users\\me\\proj\\workspace.dwk").run(); });
    const ds = useApp.getState().datasets.find((d) => d.id === "r1");
    expect(ds?.source).toEqual({
      kind: "path",
      path: "C:\\Users\\me\\proj\\sources\\r1.dat",
    });
  });

  // PR 3 review finding #3: an `opened.path` with NO directory separator
  // (the `parentDirectory` "no directory" sentinel) must degrade a bundle
  // source exactly like an unknown projectDir — never resolve against a
  // bogus root-anchored path.
  it("degrades a packed project's bundle-relative source when opened.path has no directory separator", async () => {
    vi.mocked(pathState).mockResolvedValue("ok");
    vi.mocked(readProject).mockResolvedValue({ path: "workspace.dwk", content: WS_WITH_BUNDLE_SOURCE });
    useRecentProjects.getState().pushRecentProject("workspace.dwk", "workspace.dwk");
    renderHook(() => useRecentProjectsCommands());
    await act(async () => { action("recent-project-workspace.dwk").run(); });
    const ds = useApp.getState().datasets.find((d) => d.id === "r1");
    expect(ds?.source).toBeUndefined();
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

  it("permission denied: says the file is present but unreadable — never 'not found', no read, no dialog", async () => {
    vi.mocked(pathState).mockResolvedValue("permission_denied");
    useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/workspace.dwk");
    renderHook(() => useRecentProjectsCommands());
    await act(async () => { action("recent-project-/p/workspace.dwk").run(); });
    expect(readProject).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts.some((t) => /permission denied/.test(t.msg))).toBe(true);
    expect(useToasts.getState().toasts.some((t) => /not found/.test(t.msg))).toBe(false);
  });

  // P1.1 (project reopen completion): missing/invalid offer LOCATE — the
  // native dialog seeded at the OLD folder — instead of a dead-end toast.
  describe("missing: offers to locate (P1.1)", () => {
    it("asks before opening any dialog and does NOT attempt a read; declining does nothing", async () => {
      vi.mocked(pathState).mockResolvedValue("missing");
      vi.mocked(askConfirm).mockResolvedValue(false);
      useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/workspace.dwk");
      renderHook(() => useRecentProjectsCommands());
      await act(async () => { action("recent-project-/p/workspace.dwk").run(); });
      expect(readProject).not.toHaveBeenCalled();
      expect(askConfirm).toHaveBeenCalledWith(expect.stringMatching(/not found at its saved location/), expect.stringContaining("/p/workspace.dwk"), "Locate…");
      expect(openProject).not.toHaveBeenCalled();
      expect(useRecentProjects.getState().recentProjects).toHaveLength(1); // nothing cleaned up
    });

    it("accepting opens the native dialog in the entry's own folder", async () => {
      vi.mocked(pathState).mockResolvedValue("missing");
      vi.mocked(askConfirm).mockResolvedValue(true);
      vi.mocked(openProject).mockResolvedValue(CANCELLED);
      useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/old/workspace.dwk");
      renderHook(() => useRecentProjectsCommands());
      await act(async () => { action("recent-project-/p/old/workspace.dwk").run(); });
      expect(openProject).toHaveBeenCalledWith("/p/old");
      // A cancelled locate is silent and leaves the entry alone.
      expect(useToasts.getState().toasts).toHaveLength(0);
      expect(useRecentProjects.getState().recentProjects).toHaveLength(1);
    });

    it("a located file replaces the stale entry, adopts the new identity, and becomes the working path", async () => {
      vi.mocked(pathState).mockResolvedValue("missing");
      vi.mocked(askConfirm).mockResolvedValue(true);
      vi.mocked(openProject).mockResolvedValue({ path: "/p/new/renamed.dwk", content: WS });
      useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/old/workspace.dwk");
      renderHook(() => useRecentProjectsCommands());
      await act(async () => { action("recent-project-/p/old/workspace.dwk").run(); });
      expect(useApp.getState().currentProject).toEqual({ name: "renamed.dwk", path: "/p/new/renamed.dwk" });
      expect(useRecentProjects.getState().recentProjects.map((r) => r.path)).toEqual(["/p/new/renamed.dwk"]);
      expect(useWorkingPaths.getState().current).toBe("/p/new");
    });

    it("invalid: same locate offer, with its own explanation", async () => {
      vi.mocked(pathState).mockResolvedValue("invalid");
      vi.mocked(askConfirm).mockResolvedValue(false);
      useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/workspace.dwk");
      renderHook(() => useRecentProjectsCommands());
      await act(async () => { action("recent-project-/p/workspace.dwk").run(); });
      expect(askConfirm).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/not usable/), "Locate…");
      expect(readProject).not.toHaveBeenCalled();
    });

    it("a located file that the user then declines to load leaves the recents list untouched (DEFECT A)", async () => {
      vi.mocked(pathState).mockResolvedValue("missing");
      vi.mocked(askConfirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      vi.mocked(openProject).mockResolvedValue({ path: "/p/new/renamed.dwk", content: WS });
      useApp.setState({ datasets: [{ id: "a", name: "a.dat", data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} } }] });
      useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/old/workspace.dwk");
      renderHook(() => useRecentProjectsCommands());
      await act(async () => { action("recent-project-/p/old/workspace.dwk").run(); });
      expect(askConfirm).toHaveBeenCalledTimes(2);
      expect(useRecentProjects.getState().recentProjects.map((r) => r.path)).toEqual(["/p/old/workspace.dwk"]);
      expect(useApp.getState().currentProject).toBeNull();
    });
  });

  // Consent is per-process, so the FIRST reopen after a relaunch always
  // fails the direct read — that must degrade to the dialog, seeded at the
  // file's own folder, never dead-end (read_project_file's contract).
  describe("a failed read (lapsed consent after a relaunch) degrades to the dialog (P1.1)", () => {
    it("opens the native dialog in the project's folder and reopens the re-picked file with the same identity", async () => {
      vi.mocked(pathState).mockResolvedValue("ok");
      vi.mocked(readProject).mockResolvedValue(null);
      vi.mocked(openProject).mockResolvedValue({ path: "/p/workspace.dwk", content: WS });
      useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/workspace.dwk");
      renderHook(() => useRecentProjectsCommands());
      await act(async () => { action("recent-project-/p/workspace.dwk").run(); });
      expect(openProject).toHaveBeenCalledWith("/p");
      expect(useApp.getState().currentProject).toEqual({ name: "workspace.dwk", path: "/p/workspace.dwk" });
      expect(useRecentProjects.getState().recentProjects).toHaveLength(1);
      expect(useToasts.getState().toasts.some((t) => /could not be reopened/.test(t.msg))).toBe(false);
    });

    it("a DIFFERENT file picked in that dialog opens it but keeps the original (present, fine) entry", async () => {
      vi.mocked(pathState).mockResolvedValue("ok");
      vi.mocked(readProject).mockResolvedValue(null);
      vi.mocked(openProject).mockResolvedValue({ path: "/p/b.dwk", content: WS });
      useRecentProjects.getState().pushRecentProject("a.dwk", "/p/a.dwk");
      renderHook(() => useRecentProjectsCommands());
      await act(async () => { action("recent-project-/p/a.dwk").run(); });
      expect(useApp.getState().currentProject).toEqual({ name: "b.dwk", path: "/p/b.dwk" });
      expect(useRecentProjects.getState().recentProjects.map((r) => r.path).sort()).toEqual(["/p/a.dwk", "/p/b.dwk"]);
    });

    it("cancelling that dialog is silent", async () => {
      vi.mocked(pathState).mockResolvedValue("ok");
      vi.mocked(readProject).mockResolvedValue(null);
      vi.mocked(openProject).mockResolvedValue(CANCELLED);
      useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/workspace.dwk");
      renderHook(() => useRecentProjectsCommands());
      await act(async () => { action("recent-project-/p/workspace.dwk").run(); });
      expect(useToasts.getState().toasts).toHaveLength(0);
      expect(useApp.getState().currentProject).toBeNull();
    });

    it("with no usable dialog either, toasts rather than throwing", async () => {
      vi.mocked(pathState).mockResolvedValue("ok");
      vi.mocked(readProject).mockResolvedValue(null);
      vi.mocked(openProject).mockResolvedValue(null);
      useRecentProjects.getState().pushRecentProject("workspace.dwk", "/p/workspace.dwk");
      renderHook(() => useRecentProjectsCommands());
      await act(async () => { action("recent-project-/p/workspace.dwk").run(); });
      expect(useToasts.getState().toasts.some((t) => /could not be reopened/.test(t.msg))).toBe(true);
    });
  });
});
