// Autosave seam tests (MAIN_PLAN #32). Every pre-#32 behaviour is preserved
// here (now awaited); the new cases cover rotation, corrupt-newest fallback,
// persistent health, and migration off the legacy localStorage slot.
//
// The backend is swapped for `memoryBackend()` rather than exercising
// IndexedDB — jsdom implements none. That is deliberate and safe: the rules
// that can actually be wrong live in autosaveGenerations.ts (pure, fully
// tested), and autosaveBackend.ts only moves bytes.

import { beforeEach, describe, expect, it } from "vitest";

import {
  autosaveHealth,
  clearAutosave,
  listAutosaveGenerations,
  loadAutosave,
  saveAutosave,
  setAutosaveBackend,
} from "./autosave";
import { LEGACY_KEY, memoryBackend, type AutosaveBackend } from "./autosaveBackend";
import { serializeWorkspace } from "./workspace";
import type { Dataset } from "./types";

const ds = (id: string, name: string): Dataset => ({
  id,
  name,
  data: {
    time: [0, 1, 2],
    values: [[10], [20], [30]],
    labels: ["M"],
    units: ["emu"],
    metadata: {},
  },
});

/** A backend whose writes always fail — the quota/unavailable-storage case. */
function failingBackend(message = "quota"): AutosaveBackend {
  return {
    kind: "memory",
    async read() {
      return [];
    },
    async write() {
      throw new Error(message);
    },
    async clear() {},
  };
}

beforeEach(() => {
  localStorage.clear();
  setAutosaveBackend(memoryBackend());
});

describe("autosave round-trip (pre-#32 behaviour, preserved)", () => {
  it("round-trips the library", async () => {
    expect(await saveAutosave({ datasets: [ds("a", "first"), ds("b", "second")] })).toBe(true);
    const restored = await loadAutosave();
    expect(restored?.datasets).toHaveLength(2);
    expect(restored?.datasets[0].name).toBe("first");
    expect(restored?.datasets[1].data.values).toEqual([[10], [20], [30]]);
  });

  it("round-trips the folder tree + membership + expansion (v2)", async () => {
    await saveAutosave({
      datasets: [{ ...ds("a", "first"), folderId: "f1", order: 0 }],
      folders: [{ id: "f1", name: "XRD", parentId: null, order: 0 }],
      activeId: "a",
      selectedIds: ["a"],
      expandedFolders: ["f1"],
    });
    const r = await loadAutosave();
    expect(r?.folders).toEqual([{ id: "f1", name: "XRD", parentId: null, order: 0 }]);
    expect(r?.datasets[0].folderId).toBe("f1");
    expect(r?.activeId).toBe("a");
    expect(r?.expandedFolders).toEqual(["f1"]);
  });

  it("returns null when nothing is autosaved", async () => {
    expect(await loadAutosave()).toBeNull();
  });

  it("clears the slot when the library is empty", async () => {
    await saveAutosave({ datasets: [ds("a", "first")] });
    expect(await loadAutosave()).not.toBeNull();
    await saveAutosave({ datasets: [] });
    expect(await loadAutosave()).toBeNull();
  });

  it("clearAutosave wipes every generation", async () => {
    await saveAutosave({ datasets: [ds("a", "first")] }, 1);
    await saveAutosave({ datasets: [ds("b", "second")] }, 2);
    await clearAutosave();
    expect(await loadAutosave()).toBeNull();
    expect(await listAutosaveGenerations()).toEqual([]);
  });

  it("degrades to false on a storage error rather than throwing", async () => {
    setAutosaveBackend(failingBackend());
    expect(await saveAutosave({ datasets: [ds("a", "first")] })).toBe(false);
  });

  it("ignores a corrupt legacy slot", async () => {
    localStorage.setItem(LEGACY_KEY, "{not valid json");
    expect(await loadAutosave()).toBeNull();
  });
});

describe("rotating generations (#32)", () => {
  it("keeps several recovery points instead of one slot", async () => {
    await saveAutosave({ datasets: [ds("a", "one")] }, 1);
    await saveAutosave({ datasets: [ds("b", "two")] }, 2);
    await saveAutosave({ datasets: [ds("c", "three")] }, 3);
    const gens = await listAutosaveGenerations();
    expect(gens.map((g) => g.at)).toEqual([3, 2, 1]);
  });

  it("restores the NEWEST generation", async () => {
    await saveAutosave({ datasets: [ds("a", "old")] }, 1);
    await saveAutosave({ datasets: [ds("b", "new")] }, 2);
    expect((await loadAutosave())?.datasets[0].name).toBe("new");
  });

  it("falls back past a corrupt newest generation to a good older one", async () => {
    // The entire reason for keeping more than one. Seed a store whose newest
    // entry is unparseable and whose older entry is a real workspace.
    const good = serializeWorkspace({ datasets: [ds("a", "survivor")] });
    setAutosaveBackend(
      memoryBackend([
        { at: 2, text: "{corrupt" },
        { at: 1, text: good },
      ]),
    );
    const restored = await loadAutosave();
    expect(restored?.datasets[0].name).toBe("survivor");
  });

  it("caps the retained set rather than growing forever", async () => {
    for (let at = 1; at <= 6; at++) {
      await saveAutosave({ datasets: [ds(`d${at}`, `n${at}`)] }, at);
    }
    expect((await listAutosaveGenerations()).length).toBeLessThanOrEqual(3);
  });
});

describe("autosave health (#32)", () => {
  it("records the time of a successful save", async () => {
    await saveAutosave({ datasets: [ds("a", "first")] }, 1234);
    expect(autosaveHealth().savedAt).toBe(1234);
    expect(autosaveHealth().error).toBeNull();
  });

  it("keeps the failure reason set — a scrolled-away toast was the old gap", async () => {
    setAutosaveBackend(failingBackend("disk on fire"));
    await saveAutosave({ datasets: [ds("a", "first")] });
    expect(autosaveHealth().error).toBe("disk on fire");
  });

  it("clears the error only on the next SUCCESS", async () => {
    setAutosaveBackend(failingBackend());
    await saveAutosave({ datasets: [ds("a", "first")] });
    expect(autosaveHealth().error).not.toBeNull();
    setAutosaveBackend(memoryBackend());
    await saveAutosave({ datasets: [ds("a", "first")] }, 9);
    expect(autosaveHealth().error).toBeNull();
    expect(autosaveHealth().savedAt).toBe(9);
  });
});

describe("legacy migration (#32)", () => {
  it("imports the pre-#32 localStorage slot when the new store is empty", async () => {
    // Upgrading must not strand existing work — that would be a data-loss bug
    // introduced BY the data-loss fix.
    localStorage.setItem(LEGACY_KEY, serializeWorkspace({ datasets: [ds("a", "legacy")] }));
    expect((await loadAutosave())?.datasets[0].name).toBe("legacy");
  });

  it("prefers a real generation over the legacy slot", async () => {
    localStorage.setItem(LEGACY_KEY, serializeWorkspace({ datasets: [ds("a", "legacy")] }));
    await saveAutosave({ datasets: [ds("b", "current")] }, 5);
    expect((await loadAutosave())?.datasets[0].name).toBe("current");
  });

  it("does not delete the legacy slot, so a downgrade still finds it", async () => {
    const text = serializeWorkspace({ datasets: [ds("a", "legacy")] });
    localStorage.setItem(LEGACY_KEY, text);
    await loadAutosave();
    expect(localStorage.getItem(LEGACY_KEY)).toBe(text);
  });
});
