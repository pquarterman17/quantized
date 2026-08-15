import { beforeEach, describe, expect, it } from "vitest";

import {
  LIBRARY_VIEW_PREFS_KEY,
  loadLibraryViewMode,
  saveLibraryViewMode,
} from "./libraryViewPrefs";

beforeEach(() => localStorage.removeItem(LIBRARY_VIEW_PREFS_KEY));

describe("Library view preference", () => {
  it("defaults safely to Tree for missing, malformed, and future values", () => {
    expect(loadLibraryViewMode()).toBe("tree");
    localStorage.setItem(LIBRARY_VIEW_PREFS_KEY, "not json");
    expect(loadLibraryViewMode()).toBe("tree");
    localStorage.setItem(LIBRARY_VIEW_PREFS_KEY, JSON.stringify({ mode: "tiles" }));
    expect(loadLibraryViewMode()).toBe("tree");
  });

  it("round-trips the available Details choice", () => {
    saveLibraryViewMode("details");
    expect(loadLibraryViewMode()).toBe("details");
    expect(JSON.parse(localStorage.getItem(LIBRARY_VIEW_PREFS_KEY) ?? "{}")).toEqual({ mode: "details" });
  });
});
