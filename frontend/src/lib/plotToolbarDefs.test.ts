import { describe, expect, it } from "vitest";

import {
  ANALYZE_TOOLS,
  INSPECT_TOOLS,
  NAVIGATE_TOOLS,
  TOOL_DEFS,
  toolDefFor,
} from "./plotToolbarDefs";
import type { PlotTool } from "./uplotOpts";

const ALL_PLOT_TOOLS: PlotTool[] = [
  "pointer",
  "zoom",
  "pan",
  "cursor",
  "region",
  "select",
  "measure",
  "stats",
  "integ",
  "fwhm",
  "qfit",
];

describe("toolDefFor / TOOL_DEFS", () => {
  it("covers every PlotTool variant, including 'region' (no toolbar button)", () => {
    for (const tool of ALL_PLOT_TOOLS) {
      expect(toolDefFor(tool), `missing ToolDef for "${tool}"`).toBeDefined();
    }
  });

  it("matches the toolbar's own def for every button that has one (single source of truth)", () => {
    for (const t of [...NAVIGATE_TOOLS, ...INSPECT_TOOLS, ...ANALYZE_TOOLS]) {
      expect(TOOL_DEFS[t.id]).toBe(t);
    }
  });

  it("every def's desc already reads as a gesture instruction (no hint override needed today)", () => {
    for (const tool of ALL_PLOT_TOOLS) {
      const def = toolDefFor(tool)!;
      expect(def.hint).toBeUndefined();
      expect(def.desc.length).toBeGreaterThan(0);
    }
  });

  it("'region' carries a name/hint even though it has no toolbar button", () => {
    const def = toolDefFor("region")!;
    expect(def.name).toBeTruthy();
    expect(def.desc).toMatch(/background range/i);
  });
});
