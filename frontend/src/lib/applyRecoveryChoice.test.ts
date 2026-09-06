// The three crash-recovery choices (P1.2 box 5): Recover / Keep last
// project / Cancel. Exercised at the action level (not through the dialog
// component) so the store-mutation logic is covered independently of
// rendering — mirrors commands/recentProjectsCommands.test.ts's own split.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { askConfirm } from "../components/overlays/ConfirmDialog";
import { CANCELLED, openProject, pathState, readProject } from "./desktopBridge";
import { WORKSPACE_FORMAT, parseWorkspace } from "./workspace";
import { useRecoveryChoice, type RecoveryPrompt } from "../store/recoveryChoice";
import { useApp } from "../store/useApp";
import { useToasts } from "../store/toasts";
import {
  applyCancelRecovery,
  applyKeepLastProject,
  applyRecoverAutosave,
} from "./applyRecoveryChoice";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("./desktopBridge", async (orig) => ({
  ...(await orig<typeof import("./desktopBridge")>()),
  pathState: vi.fn(),
  readProject: vi.fn(),
  openProject: vi.fn(),
}));

const WS = JSON.stringify({
  format: WORKSPACE_FORMAT,
  version: 4,
  datasets: [
    {
      id: "r1",
      name: "recovered.dat",
      data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} },
    },
  ],
});

function prompt(): RecoveryPrompt {
  return {
    workspace: parseWorkspace(WS),
    autosaveAt: 200,
    datasetCount: 1,
    lastProject: { name: "project.dwk", path: "/p/project.dwk", at: 100 },
  };
}

beforeEach(() => {
  vi.mocked(askConfirm).mockReset();
  vi.mocked(pathState).mockReset();
  vi.mocked(readProject).mockReset();
  vi.mocked(openProject).mockReset();
  vi.mocked(openProject).mockResolvedValue(null);
  useToasts.setState({ toasts: [] });
  useApp.setState({ datasets: [], activeId: null, currentProject: null, projectDirty: false });
  useRecoveryChoice.setState({ pending: null });
});

describe("applyRecoverAutosave", () => {
  it("loads the recovered workspace and adopts the last project's identity, marked dirty", () => {
    applyRecoverAutosave(prompt());
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["recovered.dat"]);
    expect(useApp.getState().currentProject).toEqual({ name: "project.dwk", path: "/p/project.dwk" });
    expect(useApp.getState().projectDirty).toBe(true);
  });

  it("clears the pending prompt", () => {
    useRecoveryChoice.setState({ pending: prompt() });
    applyRecoverAutosave(prompt());
    expect(useRecoveryChoice.getState().pending).toBeNull();
  });
});

describe("applyKeepLastProject", () => {
  it("reopens the last project from disk (never applies the autosave content)", async () => {
    vi.mocked(pathState).mockResolvedValue("ok");
    vi.mocked(readProject).mockResolvedValue({
      path: "/p/project.dwk",
      content: JSON.stringify({ format: WORKSPACE_FORMAT, version: 4, datasets: [] }),
    });
    await applyKeepLastProject(prompt());
    expect(readProject).toHaveBeenCalledWith("/p/project.dwk");
    expect(useApp.getState().datasets.map((d) => d.name)).not.toContain("recovered.dat");
  });

  it("clears the pending prompt", async () => {
    vi.mocked(pathState).mockResolvedValue("missing");
    useRecoveryChoice.setState({ pending: prompt() });
    await applyKeepLastProject(prompt());
    expect(useRecoveryChoice.getState().pending).toBeNull();
  });

  // P1.1: after a relaunch consent has lapsed, so "Keep" goes through a
  // native dialog; cancelling it must not leave an unexplained empty
  // session with the prompt already gone.
  it("says so when the reopen dialog is cancelled — the prompt is gone and nothing loaded", async () => {
    vi.mocked(pathState).mockResolvedValue("ok");
    vi.mocked(readProject).mockResolvedValue(null);
    vi.mocked(openProject).mockResolvedValue(CANCELLED);
    await applyKeepLastProject(prompt());
    expect(useApp.getState().datasets).toEqual([]);
    expect(useToasts.getState().toasts.some((t) => /was not reopened/.test(t.msg))).toBe(true);
  });

  it("does not double up on a reason already toasted (offline)", async () => {
    vi.mocked(pathState).mockResolvedValue("offline");
    await applyKeepLastProject(prompt());
    const msgs = useToasts.getState().toasts.map((t) => t.msg);
    expect(msgs.some((m) => /not available right now/.test(m))).toBe(true);
    expect(msgs.some((m) => /was not reopened/.test(m))).toBe(false);
  });
});

describe("applyCancelRecovery", () => {
  it("clears the pending prompt and touches nothing else — keeps both", () => {
    useRecoveryChoice.setState({ pending: prompt() });
    applyCancelRecovery();
    expect(useRecoveryChoice.getState().pending).toBeNull();
    expect(useApp.getState().datasets).toEqual([]);
    expect(useApp.getState().currentProject).toBeNull();
  });
});
