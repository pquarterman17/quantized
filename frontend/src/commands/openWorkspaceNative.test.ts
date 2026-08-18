// "Open workspace"/"Open without layout"/"Append workspace" — the NATIVE
// branch added by P1.1 C3. openWorkspaceConfirm.test.ts, openWorkspaceSafe.test.ts,
// and openWorkspaceBusy.test.ts already cover the pre-existing browser-picker
// path (byte-identical, still exercised with no bridge present — see
// fileCommands.ts's own doc comment on why that fallback stays synchronous).
// This file is the NEW half: a native pick bypasses the picker entirely, a
// cancel is a no-op (never a picker fallback), and a genuine native open
// records a Recent Projects entry.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileCommands } from "./fileCommands";
import { askConfirm } from "../components/overlays/ConfirmDialog";
import { openFilePicker } from "../lib/openFilePicker";
import { WORKSPACE_FORMAT } from "../lib/workspace";
import { useRecentProjects } from "../store/recentProjects";
import { useApp } from "../store/useApp";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../lib/openFilePicker", async (orig) => ({
  ...(await orig<typeof import("../lib/openFilePicker")>()),
  openFilePicker: vi.fn(),
}));

interface FakeApi {
  open_project_file?: (dir?: string) => Promise<Record<string, unknown>>;
}

function setShell(api: FakeApi | null): void {
  const g = globalThis as { pywebview?: { api?: FakeApi } };
  if (api === null) delete g.pywebview;
  else g.pywebview = { api };
}

const WS = JSON.stringify({ format: WORKSPACE_FORMAT, version: 3, datasets: [], folders: [] });

// One real dataset, so appendWorkspace's native-branch test can observe the
// merge actually happening rather than only that a no-op ran.
const WS_WITH_DATASET = JSON.stringify({
  format: WORKSPACE_FORMAT,
  version: 3,
  datasets: [
    {
      id: "r1",
      name: "r1.dat",
      data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
    },
  ],
  folders: [],
});

function run(id: string) {
  const cmd = buildFileCommands(useApp.getState).find((c) => c.id === id);
  if (!cmd) throw new Error(`${id} command not registered`);
  cmd.run();
}

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.mocked(askConfirm).mockReset();
  vi.mocked(openFilePicker).mockReset();
  setShell(null);
  localStorage.clear();
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

describe("open-workspace — native branch", () => {
  it("imports the natively picked workspace and never opens the browser picker", async () => {
    setShell({ open_project_file: async () => ({ path: "/p/workspace.dwk", content: WS }) });
    run("open-workspace");
    await settle();
    expect(openFilePicker).not.toHaveBeenCalled();
  });

  it("records a Recent Projects entry on a successful native open", async () => {
    setShell({ open_project_file: async () => ({ path: "/p/workspace.dwk", content: WS }) });
    run("open-workspace");
    await settle();
    const recent = useRecentProjects.getState().recentProjects;
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ name: "workspace.dwk", path: "/p/workspace.dwk" });
  });

  it("records the project identity on a successful native open (P1.2 box 1)", async () => {
    setShell({ open_project_file: async () => ({ path: "/p/workspace.dwk", content: WS }) });
    run("open-workspace");
    await settle();
    expect(useApp.getState().currentProject).toEqual({ name: "workspace.dwk", path: "/p/workspace.dwk" });
    expect(useApp.getState().projectDirty).toBe(false);
  });

  it("does NOT fall back to the browser picker when the user cancels the native dialog", async () => {
    setShell({ open_project_file: async () => ({ path: null }) });
    run("open-workspace");
    await settle();
    expect(openFilePicker).not.toHaveBeenCalled();
    expect(useRecentProjects.getState().recentProjects).toHaveLength(0);
  });

  it("falls back to the browser picker when the bridge is present but unusable", async () => {
    setShell({});
    run("open-workspace");
    await settle();
    expect(openFilePicker).toHaveBeenCalledTimes(1);
  });

  it("falls back to the browser picker when the bridge throws", async () => {
    setShell({
      open_project_file: async () => {
        throw new Error("no display");
      },
    });
    run("open-workspace");
    await settle();
    expect(openFilePicker).toHaveBeenCalledTimes(1);
  });

  it("a native pick still asks to confirm replacing a non-empty session, same as the picker path", async () => {
    setShell({ open_project_file: async () => ({ path: "/p/workspace.dwk", content: WS }) });
    vi.mocked(askConfirm).mockResolvedValue(false);
    useApp.setState({
      datasets: [{ id: "a", name: "a.dat", data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} } }],
    });
    run("open-workspace");
    await settle();
    expect(askConfirm).toHaveBeenCalledOnce();
    // Declined — the recent entry is still recorded (the FILE was opened and
    // read successfully; only loading it into the session was declined).
    expect(useRecentProjects.getState().recentProjects).toHaveLength(1);
    // But the project identity must NOT change — nothing was actually
    // loaded, so the session's existing project (if any) stays correct.
    expect(useApp.getState().currentProject).toBeNull();
  });
});

describe("open-workspace-safe — native branch", () => {
  it("shares the same native-open behavior as open-workspace", async () => {
    setShell({ open_project_file: async () => ({ path: "/p/workspace.dwk", content: WS }) });
    run("open-workspace-safe");
    await settle();
    expect(openFilePicker).not.toHaveBeenCalled();
    expect(useRecentProjects.getState().recentProjects).toHaveLength(1);
  });

  it("cancel is a no-op here too", async () => {
    setShell({ open_project_file: async () => ({ path: null }) });
    run("open-workspace-safe");
    await settle();
    expect(openFilePicker).not.toHaveBeenCalled();
  });
});

describe("append-workspace — native branch", () => {
  it("threads the natively picked workspace into appendWorkspace — no browser picker, no confirm, and the dataset actually merges in", async () => {
    setShell({ open_project_file: async () => ({ path: "/p/other.dwk", content: WS_WITH_DATASET }) });
    run("append-workspace");
    await settle();
    expect(openFilePicker).not.toHaveBeenCalled();
    // append-workspace never gates on askConfirm (unlike open/open-safe) —
    // it merges into the existing library rather than replacing it.
    expect(askConfirm).not.toHaveBeenCalled();
    expect(useApp.getState().datasets.some((d) => d.name === "r1.dat")).toBe(true);
  });

  it("records a Recent Projects entry on a successful native append", async () => {
    setShell({ open_project_file: async () => ({ path: "/p/other.dwk", content: WS_WITH_DATASET }) });
    run("append-workspace");
    await settle();
    const recent = useRecentProjects.getState().recentProjects;
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ name: "other.dwk", path: "/p/other.dwk" });
  });

  it("cancel is a no-op — no browser picker, no merge", async () => {
    setShell({ open_project_file: async () => ({ path: null }) });
    run("append-workspace");
    await settle();
    expect(openFilePicker).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toHaveLength(0);
  });

  it("falls back to the browser picker when there is no usable bridge", async () => {
    setShell({});
    run("append-workspace");
    await settle();
    expect(openFilePicker).toHaveBeenCalledTimes(1);
  });
});
