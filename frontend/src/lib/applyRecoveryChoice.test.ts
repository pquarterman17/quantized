// The three crash-recovery choices (P1.2 box 5): Recover / Keep last
// project / Cancel. Exercised at the action level (not through the dialog
// component) so the store-mutation logic is covered independently of
// rendering — mirrors commands/recentProjectsCommands.test.ts's own split.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { askConfirm } from "../components/overlays/ConfirmDialog";
import { pathState, readProject } from "./desktopBridge";
import { WORKSPACE_FORMAT, parseWorkspace } from "./workspace";
import { useRecoveryChoice, type RecoveryPrompt } from "../store/recoveryChoice";
import { useApp } from "../store/useApp";
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
