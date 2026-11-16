import { describe, expect, it } from "vitest";
import { importFailureHint } from "./importFailureHint";

describe("importFailureHint", () => {
  it.each(["a.h5", "a.NXS", "a.mat", "a.ibw", "a.png", "a.TIF", "a.tiff", "a.jpg", "a.jpeg"])(
    "points binary %s at no wizard (its error already says what to do)",
    (name) => {
      expect(importFailureHint(name)).toBe("");
    },
  );

  it("still points a text-like file at the Import wizard", () => {
    expect(importFailureHint("scan.csv")).toContain("Import wizard");
    expect(importFailureHint("noext")).toContain("Import wizard");
  });

  it("names the platform shortcut and never shows the Mac glyph off macOS (UX-Q)", () => {
    expect(importFailureHint("scan.csv", false)).toContain("Ctrl+K");
    expect(importFailureHint("scan.csv", false)).not.toContain("⌘");
    expect(importFailureHint("scan.csv", true)).toContain("⌘K");
  });
});
