// Owner decision 2026-11-26 ("it always opens a magnetometry project; I want
// the welcome menu"): a launch with an autosaved session shows the welcome
// screen and HOLDS the session; nothing loads, nothing is deleted, and
// Restore (the welcome card's action) brings it back. The real lateRestore
// module runs here (autosaveStartupRestore.test.ts mocks it).

import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startAutosaveRestore } from "./autosaveStartupRestore";
import { autosaveHealth, autosaveRestoreSettled, saveAutosave, setAutosaveBackend } from "./lib/autosave";
import { memoryBackend } from "./lib/autosaveBackend";
import { replaceRecovered, resetLateRestore } from "./lib/lateRestore";
import { markSessionActive } from "./lib/sessionMarker";
import type { Dataset } from "./lib/types";
import { serializeWorkspace } from "./lib/workspace";
import { useHeldRestore } from "./store/heldRestore";
import { useRecoveryChoice } from "./store/recoveryChoice";
import { useApp } from "./store/useApp";

vi.mock("./lib/api", () => ({ fetchBookData: vi.fn() }));
vi.mock("./commands/recentProjectReopen", () => ({ openRecentProject: vi.fn().mockResolvedValue("opened") }));

const mag: Dataset = {
  id: "mag-1",
  name: "MH_300K.dat",
  data: { time: [-1, 0, 1], values: [[-3], [0], [3]], labels: ["Moment"], units: ["emu"], metadata: {} },
};
const saved = () => serializeWorkspace({ datasets: [mag] });

async function settle(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

let stop: () => void = () => undefined;

beforeEach(() => {
  localStorage.clear();
  setAutosaveBackend(memoryBackend([{ at: 100, text: saved() }]));
  useApp.setState(useApp.getInitialState(), true);
  useRecoveryChoice.getState().clearRecovery();
  resetLateRestore();
});

afterEach(() => {
  stop();
  resetLateRestore();
  autosaveRestoreSettled();
});

describe("startup with an autosaved session", () => {
  it("default (Welcome screen): nothing loads; the session is held for the welcome card", async () => {
    stop = startAutosaveRestore(vi.fn());
    await settle();
    expect(useApp.getState().datasets).toEqual([]);
    expect(useRecoveryChoice.getState().pending).toBeNull();
    expect(useHeldRestore.getState().held).toMatchObject({ at: 100, datasetCount: 1, names: ["MH_300K.dat"], crashed: false });
    expect(autosaveHealth().restoreError).toMatch(/restore it from the welcome screen/);
  });

  it("holding discards nothing: even saving an empty library keeps the held generation", async () => {
    const backend = memoryBackend([{ at: 100, text: saved() }]);
    setAutosaveBackend(backend);
    stop = startAutosaveRestore(vi.fn());
    await settle();
    await saveAutosave({ ...useApp.getState(), datasets: [] }, Date.now() + 1000);
    expect((await backend.read()).map((g) => g.at)).toEqual([100]);
  });

  it("Restore brings the session back and settles the pin", async () => {
    stop = startAutosaveRestore(vi.fn());
    await settle();
    await act(async () => void (await replaceRecovered()));
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["MH_300K.dat"]);
    expect(useHeldRestore.getState().held).toBeNull();
    expect(autosaveHealth().restoreError).toBeUndefined();
  });

  it("Reopen last session: restores silently as before", async () => {
    localStorage.setItem("qz.workflowPrefs", JSON.stringify({ onStartup: "reopen" }));
    const setStatus = vi.fn();
    stop = startAutosaveRestore(setStatus);
    await settle();
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["MH_300K.dat"]);
    expect(useHeldRestore.getState().held).toBeNull();
    expect(setStatus).toHaveBeenCalledWith("restored 1 dataset from autosave");
  });

  it("crash recovery: held with the crash flag under the Welcome pref", async () => {
    markSessionActive(); // the previous page never ran its unload handler
    stop = startAutosaveRestore(vi.fn());
    await settle();
    expect(useApp.getState().datasets).toEqual([]);
    expect(useHeldRestore.getState().held?.crashed).toBe(true);
  });

  it("crash recovery: still offered, not loaded, under the Reopen pref", async () => {
    localStorage.setItem("qz.workflowPrefs", JSON.stringify({ onStartup: "reopen" }));
    markSessionActive();
    stop = startAutosaveRestore(vi.fn());
    await settle();
    expect(useApp.getState().datasets).toEqual([]);
    expect(useHeldRestore.getState().held?.crashed).toBe(true);
  });

  it("no autosave: nothing held, an empty workspace", async () => {
    setAutosaveBackend(memoryBackend([]));
    stop = startAutosaveRestore(vi.fn());
    await settle();
    expect(useApp.getState().datasets).toEqual([]);
    expect(useHeldRestore.getState().held).toBeNull();
    expect(autosaveHealth().restoreError).toBeUndefined();
  });
});
