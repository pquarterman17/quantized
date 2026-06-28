import { afterEach, describe, expect, it } from "vitest";

import { applyPalette, normalizePalette, PALETTES } from "./palettes";

afterEach(() => applyPalette("default")); // leave the DOM clean for other suites

describe("normalizePalette", () => {
  it("accepts known values and falls back to default", () => {
    expect(normalizePalette("okabe-ito")).toBe("okabe-ito");
    expect(normalizePalette("nonsense")).toBe("default");
    expect(normalizePalette(undefined)).toBe("default");
  });
});

describe("applyPalette", () => {
  const el = document.documentElement;

  it("overrides --series-1..8 for a preset", () => {
    applyPalette("okabe-ito");
    const colors = PALETTES.find((p) => p.value === "okabe-ito")!.colors!;
    expect(el.style.getPropertyValue("--series-1")).toBe(colors[0]);
    expect(el.style.getPropertyValue("--series-8")).toBe(colors[7]);
  });

  it("clears the overrides for the theme default", () => {
    applyPalette("tableau10");
    expect(el.style.getPropertyValue("--series-1")).not.toBe("");
    applyPalette("default");
    expect(el.style.getPropertyValue("--series-1")).toBe("");
    expect(el.style.getPropertyValue("--series-5")).toBe("");
  });

  it("every preset provides at least 8 cycle colours", () => {
    for (const p of PALETTES) {
      if (p.colors) expect(p.colors.length).toBeGreaterThanOrEqual(8);
    }
  });
});
