import { beforeEach, describe, expect, it } from "vitest";

import { isPreviewExpanded, setPreviewExpanded } from "./libraryPreviewPrefs";

const KEY = "qz.libraryTreePreviewIds";

beforeEach(() => localStorage.removeItem(KEY));

describe("Library Tree per-row preview-expansion preference (UX-001)", () => {
  it("defaults collapsed for missing, malformed, and malformed-shape values", () => {
    expect(isPreviewExpanded("d1")).toBe(false);
    localStorage.setItem(KEY, "not json");
    expect(isPreviewExpanded("d1")).toBe(false);
    localStorage.setItem(KEY, JSON.stringify({ not: "an array" }));
    expect(isPreviewExpanded("d1")).toBe(false);
    // Non-string entries are dropped rather than crashing the membership test.
    localStorage.setItem(KEY, JSON.stringify(["d1", 42, null, "d2"]));
    expect(isPreviewExpanded("d1")).toBe(true);
    expect(isPreviewExpanded("d2")).toBe(true);
  });

  it("round-trips expand/collapse for one id without disturbing others", () => {
    setPreviewExpanded("d1", true);
    setPreviewExpanded("d2", true);
    expect(isPreviewExpanded("d1")).toBe(true);
    expect(isPreviewExpanded("d2")).toBe(true);
    setPreviewExpanded("d1", false);
    expect(isPreviewExpanded("d1")).toBe(false);
    expect(isPreviewExpanded("d2")).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toEqual(["d2"]);
  });

  it("collapsing an id that was never expanded is a no-op", () => {
    setPreviewExpanded("d1", false);
    expect(isPreviewExpanded("d1")).toBe(false);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toEqual([]);
  });
});
