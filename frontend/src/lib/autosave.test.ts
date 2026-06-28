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
    expect(saveAutosave([ds("a", "first"), ds("b", "second")])).toBe(true);
    const restored = loadAutosave();
    expect(restored).toHaveLength(2);
    expect(restored?.[0].name).toBe("first");
    expect(restored?.[1].data.values).toEqual([[10], [20], [30]]);
  });

  it("returns null when nothing is autosaved", () => {
    expect(loadAutosave()).toBeNull();
  });

  it("clears the slot when the library is empty", () => {
    saveAutosave([ds("a", "first")]);
    expect(loadAutosave()).not.toBeNull();
    saveAutosave([]); // empty → remove
    expect(loadAutosave()).toBeNull();
  });

  it("clearAutosave wipes the slot", () => {
    saveAutosave([ds("a", "first")]);
    clearAutosave();
    expect(loadAutosave()).toBeNull();
  });

  it("degrades to false on a quota/storage error (no throw)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(saveAutosave([ds("a", "first")])).toBe(false);
  });

  it("ignores a corrupt autosave slot", () => {
    localStorage.setItem("qz.autosave", "{not valid json");
    expect(loadAutosave()).toBeNull();
  });
});
