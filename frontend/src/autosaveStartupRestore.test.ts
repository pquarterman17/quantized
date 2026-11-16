// Soak-fix review 3: the startup restore never applies anything over the
// user's work (R3/R7), and only a real recovery settles the pin (R5).
//  - a restore that lands after a project was opened, or after the workspace
//    was replaced, goes to the Append / Replace / Discard prompt;
//  - an untouched startup still restores as before;
//  - in the startup recovery dialog, Recover settles the pin, while Cancel
//    and "Keep last project" keep it (both promise the autosave stays).
// (`restoreError` is set and cleared together with the pin, so it is the
// observable stand-in for it here.)

import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startAutosaveRestore } from "./autosaveStartupRestore";
import { applyCancelRecovery, applyKeepLastProject, applyRecoverAutosave } from "./lib/applyRecoveryChoice";
import { autosaveHealth, autosaveRestorePending, autosaveRestoreSettled, setAutosaveBackend } from "./lib/autosave";
import { memoryBackend } from "./lib/autosaveBackend";
import type { Dataset } from "./lib/types";
import { parseWorkspace, serializeWorkspace } from "./lib/workspace";
import { useRecoveryChoice } from "./store/recoveryChoice";
import { useApp } from "./store/useApp";

const { offerLateRestore } = vi.hoisted(() => ({ offerLateRestore: vi.fn() }));
vi.mock("./lib/lateRestore", () => ({ offerLateRestore }));
vi.mock("./commands/recentProjectReopen", () => ({ openRecentProject: vi.fn().mockResolvedValue("opened") }));
vi.mock("./lib/api", () => ({ fetchBookData: vi.fn() }));

const ds = (id: string, name: string): Dataset => ({
  id,
  name,
  data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
});
const saved = () => serializeWorkspace({ datasets: [ds("saved-1", "saved.dat")] });

async function settle(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

let stop: () => void = () => undefined;

beforeEach(() => {
  offerLateRestore.mockClear();
  setAutosaveBackend(memoryBackend([{ at: 100, text: saved() }]));
  useApp.setState(useApp.getInitialState(), true);
  useRecoveryChoice.getState().clearRecovery();
});

afterEach(() => {
  stop();
  autosaveRestoreSettled();
});

describe("the startup restore never applies over the user's work (R3/R7)", () => {
  it("restores an untouched startup as before", async () => {
    stop = startAutosaveRestore(vi.fn());
    await settle();
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["saved.dat"]);
    expect(offerLateRestore).not.toHaveBeenCalled();
  });

  it("offers instead when a project is open", async () => {
    useApp.setState({ currentProject: { name: "opened", path: "/w/opened.dwk" }, datasets: [ds("p-1", "project.dat")] });
    stop = startAutosaveRestore(vi.fn());
    await settle();
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["project.dat"]);
    expect(offerLateRestore).toHaveBeenCalledTimes(1);
  });

  it("offers instead when the workspace was replaced since startup", async () => {
    stop = startAutosaveRestore(vi.fn());
    act(() => useApp.getState().clearAll()); // e.g. File ▸ New before the restore lands
    await settle();
    expect(useApp.getState().datasets).toEqual([]);
    expect(offerLateRestore).toHaveBeenCalledTimes(1);
  });
});

describe("only Recover settles the pin in the startup recovery dialog (R5)", () => {
  const prompt = () => ({
    workspace: parseWorkspace(saved()),
    autosaveAt: 100,
    datasetCount: 1,
    lastProject: { name: "last", path: "/w/last.dwk", at: 50 },
  });

  beforeEach(() => {
    autosaveRestorePending("pending", 1000);
    useRecoveryChoice.getState().offerRecovery(prompt());
  });

  it("Cancel keeps it", () => {
    applyCancelRecovery();
    expect(autosaveHealth().restoreError).toBe("pending");
  });

  it("Keep last project keeps it", async () => {
    await applyKeepLastProject(prompt());
    expect(autosaveHealth().restoreError).toBe("pending");
  });

  it("Recover settles it, once the workspace is actually back", () => {
    act(() => applyRecoverAutosave(prompt()));
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["saved.dat"]);
    expect(autosaveHealth().restoreError).toBeUndefined();
  });
});
