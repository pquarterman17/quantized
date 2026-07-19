import { describe, expect, it } from "vitest";

import { HELP_TOOLS } from "./helpContent";
import { searchHelpItems } from "./helpContent";
import { ORIGIN_TIPS, tipToHelpItem } from "./originTips";

describe("ORIGIN_TIPS content", () => {
  it("every tip has a non-empty Origin term and a quantized answer, with a unique id", () => {
    const ids = new Set<string>();
    for (const t of ORIGIN_TIPS) {
      expect(t.origin.length).toBeGreaterThan(0);
      expect(t.quantized.length).toBeGreaterThan(20);
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
    }
  });

  it("tips that name a tool use the tool's ACTUAL name (a rename breaks this)", () => {
    // The whole value of the migration map is that it points at real things.
    // Any tool name a tip mentions must still exist in the tool catalog, so a
    // tool rename can't leave a dangling 'do X here' that no longer exists.
    const toolNames = HELP_TOOLS.map((t) => t.name);
    const referenced = ["Curve fit", "Find peaks", "Peak Analyzer", "Test chooser", "Distribution", "Graph Builder"];
    for (const name of referenced) {
      // sanity: the reference list itself names real tools
      expect(toolNames).toContain(name);
      // and at least one tip actually mentions it
      const mentioned = ORIGIN_TIPS.some((t) => t.quantized.includes(name));
      expect(mentioned, `no tip mentions "${name}"`).toBe(true);
    }
  });
});

describe("tips are searchable alongside tools and formats", () => {
  it("finds a tip by an Origin term and by a quantized keyword", () => {
    const items = ORIGIN_TIPS.map(tipToHelpItem);
    // Origin term in the title.
    expect(searchHelpItems(items, "fitting").length).toBeGreaterThan(0);
    // Something from the quantized answer / keywords.
    expect(searchHelpItems(items, "opju").map((r) => r.key)).toContain("origin:open-project");
  });
});
