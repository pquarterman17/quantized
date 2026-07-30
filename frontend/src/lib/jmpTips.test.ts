import { describe, expect, it } from "vitest";

import { actionToHelpItem, searchHelpItems } from "./helpContent";
import { JMP_TIPS, tipToHelpItem } from "./jmpTips";
import { buildAppActions } from "../appCommands";
import { useApp } from "../store/useApp";

describe("JMP_TIPS content", () => {
  it("every tip has a non-empty JMP term and a quantized answer, with a unique id", () => {
    const ids = new Set<string>();
    for (const t of JMP_TIPS) {
      expect(t.jmp.length).toBeGreaterThan(0);
      expect(t.quantized.length).toBeGreaterThan(20);
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
    }
  });

  it("tips that name a tool use the tool's ACTUAL name (a rename breaks this)", () => {
    // The whole value of the migration map is that it points at real things.
    // Any tool name a tip mentions must still exist in the tool catalog, so a
    // tool rename can't leave a dangling 'do X here' that no longer exists.
    const toolNames = buildAppActions(useApp.getState)
      .filter((action) => action.description)
      .map((action) => actionToHelpItem(action).title);
    const referenced = [
      "Data filter",
      "Tabulate",
      "Split by column value",
      "Join datasets by key",
      "Stack columns to long form",
      "Unstack / pivot to wide form",
      "Graph Builder",
      "Distribution",
      "Test chooser",
      "Pipeline",
    ];
    for (const name of referenced) {
      // sanity: the reference list itself names real tools
      expect(toolNames.some((toolName) => toolName.includes(name))).toBe(true);
      // and at least one tip actually mentions it
      const mentioned = JMP_TIPS.some((t) => t.quantized.includes(name));
      expect(mentioned, `no tip mentions "${name}"`).toBe(true);
    }
  });
});

describe("tips are searchable alongside tools and formats", () => {
  it("finds a tip by a JMP term and by a quantized keyword", () => {
    const items = JMP_TIPS.map(tipToHelpItem);
    // JMP term in the title.
    expect(searchHelpItems(items, "formula").length).toBeGreaterThan(0);
    // Something from the quantized answer / keywords.
    expect(searchHelpItems(items, "jsl").map((r) => r.key)).toContain("jmp:saved-script-to-pipeline");
  });
});
