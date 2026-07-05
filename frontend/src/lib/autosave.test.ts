import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearAutosave, loadAutosave, saveAutosave } from "./autosave";
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

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("autosave", () => {
  it("round-trips the library through localStorage", () => {
    expect(saveAutosave({ datasets: [ds("a", "first"), ds("b", "second")] })).toBe(true);
    const restored = loadAutosave();
    expect(restored?.datasets).toHaveLength(2);
    expect(restored?.datasets[0].name).toBe("first");
    expect(restored?.datasets[1].data.values).toEqual([[10], [20], [30]]);
  });

  it("round-trips the folder tree + membership + expansion (v2)", () => {
    saveAutosave({
      datasets: [{ ...ds("a", "first"), folderId: "f1", order: 0 }],
      folders: [{ id: "f1", name: "XRD", parentId: null, order: 0 }],
      activeId: "a",
      selectedIds: ["a"],
      expandedFolders: ["f1"],
    });
    const r = loadAutosave();
    expect(r?.folders).toEqual([{ id: "f1", name: "XRD", parentId: null, order: 0 }]);
    expect(r?.datasets[0].folderId).toBe("f1");
    expect(r?.activeId).toBe("a");
    expect(r?.expandedFolders).toEqual(["f1"]);
  });

  it("returns null when nothing is autosaved", () => {
    expect(loadAutosave()).toBeNull();
  });

  it("clears the slot when the library is empty", () => {
    saveAutosave({ datasets: [ds("a", "first")] });
    expect(loadAutosave()).not.toBeNull();
    saveAutosave({ datasets: [] }); // empty → remove
    expect(loadAutosave()).toBeNull();
  });

  it("clearAutosave wipes the slot", () => {
    saveAutosave({ datasets: [ds("a", "first")] });
    clearAutosave();
    expect(loadAutosave()).toBeNull();
  });

  it("degrades to false on a quota/storage error (no throw)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(saveAutosave({ datasets: [ds("a", "first")] })).toBe(false);
  });

  it("ignores a corrupt autosave slot", () => {
    localStorage.setItem("qz.autosave", "{not valid json");
    expect(loadAutosave()).toBeNull();
  });
});
