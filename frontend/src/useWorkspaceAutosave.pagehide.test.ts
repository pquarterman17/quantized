// Soak test issue 5: an edit made in the last ~0.8 s before the tab closed or
// reloaded was lost — the debounced autosave timer never fired. Leaving the
// page (visibilitychange → hidden, pagehide) now writes the pending save at
// once, exactly once, and leaves nothing for the timer to write again. The
// write is SYNCHRONOUS (a localStorage stash), because the async IndexedDB
// save does not outlive a closing page; a restore weighs the stash with the
// other generations and the next real save supersedes it.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadAutosaveGeneration, saveAutosave, setAutosaveBackend, STASH_KEY } from "./lib/autosave";
import { memoryBackend } from "./lib/autosaveBackend";
import { serializeWorkspace } from "./lib/workspace";
import { useProjectLock } from "./store/projectLock";
import { useApp } from "./store/useApp";
import { useWorkspaceAutosave } from "./useWorkspaceAutosave";

const ds = (name: string) => ({
  id: name,
  name,
  data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} },
});

let writes = 0;
let original: ReturnType<typeof useProjectLock.getState>;

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

function leavePage(): void {
  setVisibility("hidden");
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

function useCountingBackend(seed: Parameters<typeof memoryBackend>[0] = []): void {
  const backend = memoryBackend(seed);
  setAutosaveBackend({
    ...backend,
    async write(g) {
      writes += 1;
      await backend.write(g);
    },
  });
}

beforeEach(() => {
  original = useProjectLock.getState();
  useProjectLock.setState({ path: null, status: "unlocked", openedAsCopy: false, record: null });
  writes = 0;
  localStorage.removeItem(STASH_KEY);
  useCountingBackend();
  useApp.setState({ datasets: [], plotWindows: [], focusedWindowId: null, projectDirty: false });
});

afterEach(() => {
  vi.useRealTimers();
  setVisibility("visible");
  useProjectLock.setState(original);
  localStorage.removeItem(STASH_KEY);
});

describe("autosave flushes a pending edit when the page is left", () => {
  it("stashes synchronously inside the hide event, once, and the timer adds no second write", async () => {
    await loadAutosaveGeneration(); // the startup restore has loaded the codec
    vi.useFakeTimers();
    renderHook(() => useWorkspaceAutosave());
    act(() => useApp.setState({ datasets: [ds("a.dat")] }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200); // close 200 ms after the edit
    });

    leavePage();
    // No await between the event and this read: the page may be gone by then.
    const stash = JSON.parse(localStorage.getItem(STASH_KEY) ?? "null") as { text: string } | null;
    expect(stash?.text).toContain("a.dat");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await settle();
    expect(writes).toBe(0); // the stash was the one write
  });

  it("falls back to the async save, once, when the codec is not loaded yet", async () => {
    vi.resetModules(); // a fresh lib/autosave with no codec in hand
    const fresh = await import("./lib/autosave");
    const hook = await import("./useWorkspaceAutosave");
    const backend = memoryBackend();
    fresh.setAutosaveBackend({ ...backend, async write(g) { writes += 1; await backend.write(g); } });
    const app = (await import("./store/useApp")).useApp;
    renderHook(() => hook.useWorkspaceAutosave());
    act(() => app.setState({ datasets: [ds("b.dat")] }));
    leavePage();
    await settle();
    expect(localStorage.getItem(STASH_KEY)).toBeNull();
    expect(writes).toBe(1);
  });

  it("leaving with nothing pending writes nothing", async () => {
    renderHook(() => useWorkspaceAutosave());
    leavePage();
    await settle();
    expect(writes).toBe(0);
    expect(localStorage.getItem(STASH_KEY)).toBeNull();
  });
});

describe("the stash on restore", () => {
  it("wins over an older generation, and the next real save supersedes it", async () => {
    useCountingBackend([{ at: 100, text: serializeWorkspace({ datasets: [ds("old.dat")] }) }]);
    localStorage.setItem(STASH_KEY, JSON.stringify({ at: 200, text: serializeWorkspace({ datasets: [ds("new.dat")] }) }));
    expect((await loadAutosaveGeneration())?.workspace.datasets[0].name).toBe("new.dat");

    await saveAutosave({ datasets: [ds("newer.dat")] } as Parameters<typeof saveAutosave>[0], 300);
    expect(localStorage.getItem(STASH_KEY)).toBeNull();
    expect((await loadAutosaveGeneration())?.workspace.datasets[0].name).toBe("newer.dat");
  });

  it("loses to a newer generation", async () => {
    useCountingBackend([{ at: 300, text: serializeWorkspace({ datasets: [ds("saved.dat")] }) }]);
    localStorage.setItem(STASH_KEY, JSON.stringify({ at: 200, text: serializeWorkspace({ datasets: [ds("stale.dat")] }) }));
    expect((await loadAutosaveGeneration())?.workspace.datasets[0].name).toBe("saved.dat");
  });
});
