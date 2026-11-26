// Soak-fix review 4, F2: an unanswered recovery survives a reload. While a
// previous session waits (or its restore will not load), a marker in storage
// names the time below which generations are that session; the next page
// reads it at startup and OFFERS that generation again — beside this page's
// newest save, which is restored as usual — instead of quietly restoring the
// newest save and letting it rotate the old session out.
// Each test is a fresh "page": `vi.resetModules` then the modules imported
// anew, after the marker is in storage.

import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Generation } from "./lib/autosaveGenerations";
import type { Dataset } from "./lib/types";

const { offerLateRestore } = vi.hoisted(() => ({ offerLateRestore: vi.fn<(p: { workspace: { datasets: Dataset[] }; at: number }) => void>() }));
vi.mock("./lib/lateRestore", () => ({ offerLateRestore, holdForWelcome: vi.fn() }));
vi.mock("./lib/api", () => ({ fetchBookData: vi.fn() }));

const ds = (id: string, name: string): Dataset => ({
  id,
  name,
  data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
});

async function settle(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

let stop: () => void = () => undefined;

beforeEach(() => {
  offerLateRestore.mockClear();
  localStorage.clear();
  localStorage.setItem("qz.workflowPrefs", JSON.stringify({ onStartup: "reopen" })); // these tests cover the Reopen-last-session path (default is the welcome screen)
  vi.resetModules();
});

afterEach(() => {
  stop();
  localStorage.clear();
});

/** A fresh page whose storage holds `gens` and the marker `marker`. */
async function reload(gens: (marker: number) => Generation[], marker: number) {
  const { serializeWorkspace } = await import("./lib/workspace");
  localStorage.setItem("qz.autosave.pendingRecovery", String(marker));
  const autosave = await import("./lib/autosave");
  const { memoryBackend } = await import("./lib/autosaveBackend");
  const generations = gens(marker).map((g) => ({ ...g, text: serializeWorkspace({ datasets: [ds(g.text, `${g.text}.dat`)] }) }));
  autosave.setAutosaveBackend(memoryBackend(generations));
  const { useApp } = await import("./store/useApp");
  const { startAutosaveRestore } = await import("./autosaveStartupRestore");
  return { autosave, useApp, start: () => (stop = startAutosaveRestore(vi.fn())) };
}

describe("an unanswered recovery across a reload (F2)", () => {
  it("restores this page's newest save AND offers the older session again, keeping it pinned", async () => {
    const page = await reload(() => [
      { at: 100, text: "previous" },
      { at: 300, text: "mine" },
    ], 200);
    page.start();
    await settle();
    expect(page.useApp.getState().datasets.map((d) => d.name)).toEqual(["mine.dat"]);
    expect(offerLateRestore).toHaveBeenCalledTimes(1);
    expect(offerLateRestore.mock.calls[0][0].workspace.datasets.map((d) => d.name)).toEqual(["previous.dat"]);
    // Pinned: this session's saves do not rotate it out.
    for (const at of [400, 500, 600, 700]) await page.autosave.saveAutosave({ datasets: [ds(`s${at}`, `s${at}.dat`)] } as never, at);
    expect((await page.autosave.listAutosaveGenerations()).map((g) => g.at)).toContain(100);
  });

  it("when that session is all there is, it is offered — never restored silently", async () => {
    const page = await reload(() => [{ at: 100, text: "previous" }], 200);
    page.start();
    await settle();
    expect(page.useApp.getState().datasets).toEqual([]);
    expect(offerLateRestore).toHaveBeenCalledTimes(1);
  });
});
// (With no marker the startup restore is unchanged: autosaveStartupRestore.test.ts.)
