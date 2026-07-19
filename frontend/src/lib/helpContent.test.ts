import { describe, expect, it } from "vitest";

import { buildAppActions } from "../appCommands";
import {
  HELP_TOOLS,
  searchHelpItems,
  toolToHelpItem,
  type HelpItem,
} from "./helpContent";
import { useApp } from "../store/useApp";

const ITEMS = HELP_TOOLS.map(toolToHelpItem);

describe("HELP_TOOLS coverage (the guard that keeps it data-driven)", () => {
  it("has a help entry for every Analyze-menu command", () => {
    // A new analysis tool cannot ship without a one-line description — the
    // whole point of authoring the catalog here is that this fails otherwise.
    const analyzeIds = buildAppActions(useApp.getState)
      .filter((a) => a.group === "Analyze")
      .map((a) => a.id);
    const documented = new Set(HELP_TOOLS.map((t) => t.id));
    const undocumented = analyzeIds.filter((id) => !documented.has(id));
    expect(undocumented).toEqual([]);
  });

  it("does not document a tool that isn't a real command (no dangling entries)", () => {
    const commandIds = new Set(buildAppActions(useApp.getState).map((a) => a.id));
    const dangling = HELP_TOOLS.map((t) => t.id).filter((id) => !commandIds.has(id));
    expect(dangling).toEqual([]);
  });

  it("every tool has a non-empty name and a sentence-ish description", () => {
    for (const t of HELP_TOOLS) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.desc.length).toBeGreaterThan(20);
      expect(t.section.length).toBeGreaterThan(0);
    }
  });
});

describe("toolToHelpItem", () => {
  it("maps a tool to a searchable item with a menu-path meta", () => {
    const item = toolToHelpItem(HELP_TOOLS[0]);
    expect(item.key).toBe(HELP_TOOLS[0].id);
    expect(item.title).toBe(HELP_TOOLS[0].name);
    expect(item.meta).toMatch(/^Analyze ▸ /);
    expect(item.keywords).toContain(HELP_TOOLS[0].section);
  });
});

describe("searchHelpItems", () => {
  it("returns everything (order-preserved, unscored) for a blank query", () => {
    const all = searchHelpItems(ITEMS, "");
    expect(all).toHaveLength(ITEMS.length);
    expect(all[0].key).toBe(ITEMS[0].key);
    expect(all.every((r) => r.hits.length === 0)).toBe(true);
  });

  it("finds a tool by a word in its title, with highlight hits", () => {
    const r = searchHelpItems(ITEMS, "hyster");
    expect(r[0].key).toBe("hysteresis");
    expect(r[0].hits.length).toBeGreaterThan(0);
  });

  it("finds a tool by a keyword NOT in its title (no hits, still ranked)", () => {
    // "coercivity" is only in hysteresis's keywords/detail, not its name.
    const r = searchHelpItems(ITEMS, "coercivity");
    expect(r.map((x) => x.key)).toContain("hysteresis");
    const hit = r.find((x) => x.key === "hysteresis")!;
    expect(hit.hits).toEqual([]); // matched the fallback tier, so no title highlight
  });

  it("ranks a title match above a keyword-only match", () => {
    // "peak" is in "Find peaks"/"Peak Analyzer" titles AND in other tools'
    // keywords; the title matches must come first.
    const r = searchHelpItems(ITEMS, "peak");
    const firstTitleMatch = r[0];
    expect(firstTitleMatch.title.toLowerCase()).toContain("peak");
  });

  it("returns nothing for a query that matches no title, detail, or keyword", () => {
    expect(searchHelpItems(ITEMS, "zzxqwv")).toEqual([]);
  });

  it("searches an arbitrary HelpItem list, not just tools (category-agnostic)", () => {
    const items: HelpItem[] = [
      { key: "a", title: "Alpha", detail: "the first" },
      { key: "b", title: "Beta", detail: "the second" },
    ];
    expect(searchHelpItems(items, "alph").map((r) => r.key)).toEqual(["a"]);
  });
});
