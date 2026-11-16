import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { FIGURE_STYLE_DPI, FIGURE_STYLES } from "./figureOutputConstants";
import { previewDpiFor, rulerSteps, specWidthIn } from "./previewSizing";
import { FIGURE_STYLE_SIZE_CM, PRESET_ORDER, presetLabel, presetLabels, presetOptions } from "../../../lib/figurePresets";

// The frontend mirrors of the calibrated preset table must match the backend
// source exactly (they are display-only, but a wrong size on a label or a
// ruler would misreport the export). Parsed from the Python source itself.
function backendPresets(): Map<string, { w: number; h: number; dpi: number }> {
  const src = readFileSync(resolve(__dirname, "../../../../../src/quantized/calc/figure_styles.py"), "utf8");
  const rows = new Map<string, { w: number; h: number; dpi: number }>();
  const re = /"(\w+)":\s*_t\("\w+",\s*"[^"]+",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*(\d+)/g;
  for (const m of src.matchAll(re)) rows.set(m[1], { w: Number(m[8]), h: Number(m[9]), dpi: Number(m[10]) });
  return rows;
}

describe("figure preset mirrors (UX-H)", () => {
  it("match calc/figure_styles.py preset for preset", () => {
    const backend = backendPresets();
    expect(backend.size).toBeGreaterThanOrEqual(10);
    expect(Object.keys(FIGURE_STYLE_SIZE_CM).sort()).toEqual([...backend.keys()].sort());
    for (const [id, row] of backend) {
      expect(FIGURE_STYLE_SIZE_CM[id], id).toEqual([row.w, row.h]);
      expect(FIGURE_STYLE_DPI[id], id).toBe(row.dpi);
    }
  });

  it("offers every backend preset once, by name with its size", () => {
    expect([...PRESET_ORDER].sort()).toEqual([...backendPresets().keys()].sort());
    expect(presetLabel("aps")).toBe("APS · single column · 8.6 × 6.5 cm");
    expect(presetLabel("nature_double")).toBe("Nature · double column · 18.3 × 6 cm");
    expect(presetLabel("presentation")).toBe("Slide · 25 × 18 cm");
    const ids = presetOptions("default").map((o) => o.value);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of FIGURE_STYLES) expect(ids).toContain(id);
    expect(presetLabels(["aps"])).toEqual({ aps: "APS · single column · 8.6 × 6.5 cm" });
    expect(presetOptions("aps", FIGURE_STYLES).map((o) => o.value)).toEqual(FIGURE_STYLES); // a narrower id list
  });

  it("keeps an unknown preset visible under its own id", () => {
    expect(presetLabel("lab_custom")).toBe("lab_custom");
    expect(presetOptions("lab_custom").at(-1)).toEqual({ value: "lab_custom", label: "lab_custom" });
  });
});

describe("preview sizing (UX-H)", () => {
  it("renders the preview near 960 device px wide (x devicePixelRatio, <= 1600), within [110, 300] dpi", () => {
    expect(specWidthIn({ style: "aps" })).toBeCloseTo(8.6 / 2.54);
    expect(specWidthIn({ style: "aps", width_in: 5 })).toBe(5); // a page size wins
    expect(previewDpiFor({ style: "default" })).toBe(160); // 6 in
    expect(previewDpiFor({ style: "aps" })).toBe(284); // 960 px over 8.6 cm
    expect(previewDpiFor({ style: "default" }, 2)).toBe(267); // 1600 px cap over 6 in
    expect(previewDpiFor({ style: "aps" }, 3)).toBe(300); // capped
    expect(previewDpiFor({ style: "aps", facets: [{ label: "a", x: [], series: [] }] })).toBe(110); // a grid is wider
    expect(previewDpiFor({ style: "poster" })).toBe(110); // floored
    expect(previewDpiFor({ style: "nope" })).toBe(160); // unknown -> default size
  });

  it("coarsens ruler ticks as the figure grows", () => {
    expect(rulerSteps(8.6)).toEqual({ major: 1, minor: 0.5 });
    expect(rulerSteps(30)).toEqual({ major: 5, minor: 1 });
    expect(rulerSteps(60)).toEqual({ major: 10, minor: 5 });
  });
});
