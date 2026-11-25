// "Confirm before replacing the workspace" (owner decision 2026-11-25, ON by
// default): an open over a non-empty workspace asks; Accept replaces, Cancel
// keeps everything, an empty workspace never prompts, and the pref turns the
// prompt off for every open path.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { askConfirm, replaceWorkspace, replaceWorkspaceSafely } = vi.hoisted(() => ({
  askConfirm: vi.fn<(...a: unknown[]) => Promise<boolean>>(),
  replaceWorkspace: vi.fn(() => true),
  replaceWorkspaceSafely: vi.fn(() => true),
}));
vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm }));
vi.mock("../lib/openWorkspaceReplace", async (orig) => ({
  ...(await orig<typeof import("../lib/openWorkspaceReplace")>()),
  replaceWorkspace,
  replaceWorkspaceSafely,
}));

import { needsReplaceConfirm } from "../lib/openWorkspaceReplace";
import { setWorkflowPrefs } from "../lib/workflowPrefsEdit";
import type { LoadedWorkspace } from "../lib/workspace";
import { useApp } from "../store/useApp";
import { confirmReplaceWorkspace, confirmReplaceWorkspaceSafely } from "./fileCommandsLazy";

const ws = {} as LoadedWorkspace;
const s = useApp.getState;
const ds = { id: "a", name: "a", data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} } };
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  askConfirm.mockReset().mockResolvedValue(true);
  replaceWorkspace.mockClear();
  replaceWorkspaceSafely.mockClear();
  useApp.setState({ datasets: [] });
});
afterEach(() => useApp.setState({ datasets: [] }));

describe("replace-workspace confirm", () => {
  it("is on by default and asks over a non-empty workspace; Accept replaces", async () => {
    useApp.setState({ datasets: [ds] });
    expect(needsReplaceConfirm(s)).toBe(true);
    await confirmReplaceWorkspace(s, ws);
    await tick();
    expect(askConfirm).toHaveBeenCalledWith("Replace the current workspace?", expect.any(String), "Replace", true);
    expect(replaceWorkspace).toHaveBeenCalledTimes(1);
  });

  it("Cancel keeps the workspace (nothing replaced), for open and open-without-layout", async () => {
    askConfirm.mockResolvedValue(false);
    useApp.setState({ datasets: [ds] });
    await confirmReplaceWorkspace(s, ws);
    await confirmReplaceWorkspaceSafely(s, ws);
    await tick();
    expect(askConfirm).toHaveBeenCalledTimes(2);
    expect(replaceWorkspace).not.toHaveBeenCalled();
    expect(replaceWorkspaceSafely).not.toHaveBeenCalled();
  });

  it("an empty workspace gets no prompt and opens straight away", async () => {
    expect(needsReplaceConfirm(s)).toBe(false);
    await confirmReplaceWorkspace(s, ws);
    await confirmReplaceWorkspaceSafely(s, ws);
    expect(askConfirm).not.toHaveBeenCalled();
    expect(replaceWorkspace).toHaveBeenCalledTimes(1);
    expect(replaceWorkspaceSafely).toHaveBeenCalledTimes(1);
  });

  it("pref off: a non-empty workspace is replaced without asking", async () => {
    setWorkflowPrefs({ confirmReplaceWorkspace: false });
    useApp.setState({ datasets: [ds] });
    expect(needsReplaceConfirm(s)).toBe(false);
    await confirmReplaceWorkspace(s, ws);
    await confirmReplaceWorkspaceSafely(s, ws);
    expect(askConfirm).not.toHaveBeenCalled();
    expect(replaceWorkspace).toHaveBeenCalledTimes(1);
    expect(replaceWorkspaceSafely).toHaveBeenCalledTimes(1);
  });
});
