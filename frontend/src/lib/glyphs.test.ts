// UX-G2: one meaning per glyph. `GLYPHS` (lib/glyphs.ts) is the registry; the
// TitleBar, Library node icons, plot toolbar and plot types all read from it.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LIBRARY_NODE_GLYPH } from "../components/Library/nodeIcons";
import * as GLYPHS from "./glyphs";
import {
  ANALYZE_TOOLS,
  COPY_DATA,
  COPY_FIGURE,
  INSET_MODE,
  INSPECT_TOOLS,
  NAVIGATE_TOOLS,
  POLAR_MODE,
  RESET_VIEW,
  SAVE_PNG,
  SHAPE_TOOLS,
  SMART_SCALE,
  SNAPSHOT_WINDOW,
  STACK_MODE,
  STAT_MODE,
} from "./plotToolbarDefs";
import { PLOT_TYPES } from "./plotTypes";

const HERE = dirname(fileURLToPath(import.meta.url));
const entries = Object.entries(GLYPHS) as [string, string][]; // namespace: one entry per named export

describe("glyph registry", () => {
  it("no two meanings share a glyph", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const [id, g] of entries) {
      const prev = owner.get(g);
      if (prev) clashes.push(`"${g}" is both ${prev} and ${id}`);
      else owner.set(g, id);
    }
    expect(clashes).toEqual([]);
  });

  it("every glyph is one BMP text character (never emoji)", () => {
    for (const [id, g] of entries) {
      expect([...g], id).toHaveLength(1);
      expect(g.codePointAt(0)!, id).toBeLessThan(0x1f300);
      expect(g, id).not.toContain("️");
    }
  });

  it("the surfaces draw ONLY registry glyphs, with no surface-local duplicates", () => {
    const registry = new Set(entries.map(([, g]) => g));
    const tools = [...NAVIGATE_TOOLS, ...INSPECT_TOOLS, ...ANALYZE_TOOLS].map((t) => t.glyph);
    const actions = [
      RESET_VIEW, SMART_SCALE, STACK_MODE, INSET_MODE, POLAR_MODE, STAT_MODE,
      SAVE_PNG, COPY_DATA, COPY_FIGURE, SNAPSHOT_WINDOW,
    ].map((a) => a.glyph);
    const surfaces = {
      tools,
      shapes: SHAPE_TOOLS.map((s) => s.glyph),
      actions,
      plotTypes: PLOT_TYPES.map((p) => p.glyph),
      nodes: Object.values(LIBRARY_NODE_GLYPH),
    };
    for (const [name, glyphs] of Object.entries(surfaces)) {
      for (const g of glyphs) expect(registry.has(g), `${name}: ${g}`).toBe(true);
    }
    // Across surfaces each glyph appears once; the one sanctioned share is
    // the toolbar's "Stack channels" and the "Stacked panels" plot type.
    const all = Object.values(surfaces).flat();
    const dup = all.filter((g, i) => all.indexOf(g) !== i);
    expect(dup).toEqual([GLYPHS.stackedPanels]);
  });

  it("the audit's collisions stay resolved", () => {
    expect(STACK_MODE.glyph).not.toBe(GLYPHS.libraryToggle);
    expect(SHAPE_TOOLS.find((s) => s.kind === "textbox")?.glyph).not.toBe(GLYPHS.libraryToggle);
    expect(LIBRARY_NODE_GLYPH.workbook).not.toBe(GLYPHS.libraryToggle);
    expect(STAT_MODE.glyph).not.toBe(GLYPHS.sheet);
    expect(SNAPSHOT_WINDOW.glyph).not.toBe(GLYPHS.importData);
    expect(INSET_MODE.glyph).not.toBe("⊕");
  });

  it("the TitleBar's panel toggles read the registry", () => {
    const src = readFileSync(join(HERE, "..", "components", "Shell", "TitleBar.tsx"), "utf8");
    expect(src).toContain("GLYPHS.libraryToggle");
    expect(src).toContain("GLYPHS.inspectorToggle");
  });
});
