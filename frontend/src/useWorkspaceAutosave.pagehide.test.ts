// Soak test issue 5: an edit made in the last ~0.8 s before the tab closed or
// reloaded was lost — the debounced autosave timer never fired. Leaving the
// page (visibilitychange → hidden, pagehide) now
//  - stashes the state SYNCHRONOUSLY (a localStorage generation), because the
//    async IndexedDB save does not outlive a closing page, and
//  - starts the pending async save at once, which a live page (a tab switch)
//    completes, folding the stash into the rotation.
// Review follow-ups pinned here: S1 (clear drops the stash), S2 (a save never
// drops a NEWER stash), S3 (a live hide still writes IndexedDB), S4 (size cap,
// localStorage backend, quota), S5 (a close during an in-flight save), S6
// (diagnostics list the stash).

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAutosave,
  listAutosaveGenerations,
  loadAutosaveGeneration,
  resetAutosaveStashState,
  saveAutosave,
  setAutosaveBackend,
  stashAutosave,
  STASH_KEY,
  STASH_MAX_CHARS,
} from "./lib/autosave";
import { localStorageBackend, memoryBackend, type AutosaveBackend } from "./lib/autosaveBackend";
import type { Generation } from "./lib/autosaveGenerations";
import { serializeWorkspace } from "./lib/workspace";
import { useProjectLock } from "./store/projectLock";
import { BROWSER_AUTOSAVE_LOCK_PATH } from "./store/projectLockPaths";
import { useApp } from "./store/useApp";
import { useWorkspaceAutosave } from "./useWorkspaceAutosave";

type Ws = Parameters<typeof saveAutosave>[0];
const ds = (name: string) => ({
  id: name,
  name,
  data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} },
});
const ws = (name: string): Ws => ({ datasets: [ds(name)] }) as Ws;

let writes = 0;
let original: ReturnType<typeof useProjectLock.getState>;

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

function hide(): void {
  setVisibility("hidden");
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function close(): void {
  hide();
  act(() => {
    window.dispatchEvent(new Event("pagehide"));
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

const stashText = (): string | null => localStorage.getItem(STASH_KEY);
const restoredName = async (): Promise<string | undefined> =>
  (await loadAutosaveGeneration())?.workspace.datasets[0]?.name;

function counting(base: AutosaveBackend): AutosaveBackend {
  return {
    ...base,
    async write(g) {
      writes += 1;
      await base.write(g);
    },
  };
}

beforeEach(() => {
  original = useProjectLock.getState();
  useProjectLock.setState({ path: null, status: "unlocked", openedAsCopy: false, record: null });
  writes = 0;
  localStorage.removeItem(STASH_KEY);
  resetAutosaveStashState();
  setAutosaveBackend(counting(memoryBackend()));
  useApp.setState({ datasets: [], plotWindows: [], focusedWindowId: null, projectDirty: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setVisibility("visible");
  useProjectLock.setState(original);
  localStorage.removeItem(STASH_KEY);
  resetAutosaveStashState();
});

describe("leaving the page with an edit pending", () => {
  it("stashes inside the hide event, and a page that stays alive also saves to IndexedDB once (S3)", async () => {
    await loadAutosaveGeneration(); // the startup restore has loaded the codec
    vi.useFakeTimers();
    renderHook(() => useWorkspaceAutosave());
    act(() => useApp.setState({ datasets: [ds("a.dat")] }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200); // leave 200 ms after the edit
    });

    hide();
    // No await between the event and this read: a closing page may be gone.
    expect(stashText()).toContain("a.dat");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await settle();
    expect(writes).toBe(1); // the async save ran, once; the timer added nothing
    expect(stashText()).toBeNull(); // folded into the rotation, then dropped
    expect(await restoredName()).toBe("a.dat");
  });

  it("a pagehide after the hide neither stashes nor saves a second time", async () => {
    await loadAutosaveGeneration();
    renderHook(() => useWorkspaceAutosave());
    act(() => useApp.setState({ datasets: [ds("a.dat")] }));
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    close();
    expect(setItem.mock.calls.filter(([k]) => k === STASH_KEY)).toHaveLength(1);
    await settle();
    expect(writes).toBe(1);
  });

  it("falls back to the async save alone when the codec is not loaded yet", async () => {
    renderHook(() => useWorkspaceAutosave());
    act(() => useApp.setState({ datasets: [ds("b.dat")] }));
    close();
    expect(stashText()).toBeNull();
    await settle();
    expect(writes).toBe(1);
  });

  it("leaving with nothing pending writes nothing", async () => {
    await loadAutosaveGeneration();
    renderHook(() => useWorkspaceAutosave());
    close();
    await settle();
    expect(writes).toBe(0);
    expect(stashText()).toBeNull();
  });

  it("a read-only tab never stashes", async () => {
    await loadAutosaveGeneration();
    useProjectLock.setState({ path: BROWSER_AUTOSAVE_LOCK_PATH, status: "held-by-other-live", record: null });
    renderHook(() => useWorkspaceAutosave());
    act(() => useApp.setState({ datasets: [ds("c.dat")] }));
    close();
    expect(stashText()).toBeNull();
  });

  it("a close while the debounced save is still in flight stashes too (S5)", async () => {
    await loadAutosaveGeneration();
    let release!: () => void;
    const base = memoryBackend();
    setAutosaveBackend({
      ...base,
      write: (g) => new Promise<void>((r) => (release = () => void base.write(g).then(r))),
    });
    vi.useFakeTimers();
    renderHook(() => useWorkspaceAutosave());
    act(() => useApp.setState({ datasets: [ds("d.dat")] }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900); // the timer fired; the write hangs
    });
    await settle();
    expect(release).toBeTypeOf("function");
    close();
    expect(stashText()).toContain("d.dat");
  });
});

describe("the stash as a generation", () => {
  async function loadCodec(seed: Generation[] = []): Promise<void> {
    setAutosaveBackend(counting(memoryBackend(seed)));
    await loadAutosaveGeneration();
  }

  it("wins over an older generation and loses to a newer one", async () => {
    await loadCodec([{ at: 100, text: serializeWorkspace({ datasets: [ds("old.dat")] }) }]);
    stashAutosave(ws("new.dat"), 200);
    expect(await restoredName()).toBe("new.dat");

    await loadCodec([{ at: 300, text: serializeWorkspace({ datasets: [ds("saved.dat")] }) }]);
    stashAutosave(ws("stale.dat"), 200);
    expect(await restoredName()).toBe("saved.dat");
  });

  it("Clear autosaved workspace removes the stash too (S1)", async () => {
    await loadCodec();
    stashAutosave(ws("cleared.dat"), 200);
    expect(await clearAutosave()).toBeNull();
    expect(stashText()).toBeNull();
    expect(await loadAutosaveGeneration()).toBeNull();
  });

  it("an older save finishing after a newer stash keeps the stash (S2)", async () => {
    await loadCodec();
    let release!: () => void;
    const base = memoryBackend();
    setAutosaveBackend({ ...base, write: (g) => new Promise<void>((r) => (release = () => void base.write(g).then(r))) });
    const saving = saveAutosave(ws("state0.dat"), 100);
    await settle();
    stashAutosave(ws("state1.dat"), 200); // edit + tab switch while the save waits
    release();
    expect(await saving).toBe(true);
    expect(stashText()).toContain("state1.dat");
    expect(await restoredName()).toBe("state1.dat");
  });

  it("a later save folds the stash into the rotation before dropping it", async () => {
    await loadCodec();
    stashAutosave(ws("stashed.dat"), 200);
    await saveAutosave(ws("saved.dat"), 300);
    expect(stashText()).toBeNull();
    const gens = await listAutosaveGenerations();
    expect(gens.map((g) => g.at)).toEqual([300, 200]);
  });

  it("is listed for diagnostics (S6)", async () => {
    await loadCodec([{ at: 100, text: serializeWorkspace({ datasets: [ds("old.dat")] }) }]);
    stashAutosave(ws("new.dat"), 200);
    expect((await listAutosaveGenerations()).map((g) => g.at)).toEqual([200, 100]);
  });

  it("an empty library removes the stash instead of writing one", async () => {
    await loadCodec();
    stashAutosave(ws("x.dat"), 200);
    expect(stashAutosave({ datasets: [] } as unknown as Ws, 300)).toBe(false);
    expect(stashText()).toBeNull();
  });

  it("declines on the localStorage backend, which is already synchronous (S4)", async () => {
    setAutosaveBackend(localStorageBackend("qz.autosave.test-slot"));
    await loadAutosaveGeneration();
    expect(stashAutosave(ws("x.dat"), 200)).toBe(false);
    expect(stashText()).toBeNull();
    localStorage.removeItem("qz.autosave.test-slot");
  });

  it("declines a workspace over the size cap, and then skips serializing (S4)", async () => {
    await loadCodec();
    const big = ws("x".repeat(STASH_MAX_CHARS + 10));
    expect(stashAutosave(big, 200)).toBe(false);
    expect(stashText()).toBeNull();
    const spy = vi.spyOn(JSON, "stringify");
    expect(stashAutosave(ws("small-but-after-big.dat"), 300)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a save that fails for quota drops an older stash (S4)", async () => {
    await loadCodec();
    stashAutosave(ws("old-stash.dat"), 100);
    setAutosaveBackend({
      ...memoryBackend(),
      async write() {
        throw new DOMException("full", "QuotaExceededError");
      },
    });
    expect(await saveAutosave(ws("now.dat"), 200)).toBe(false);
    expect(stashText()).toBeNull();
  });
});
