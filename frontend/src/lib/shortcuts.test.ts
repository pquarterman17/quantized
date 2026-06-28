import { describe, expect, it } from "vitest";

import { SHORTCUT_GROUPS, shortcutGroupsFor } from "./shortcuts";

describe("SHORTCUT_GROUPS", () => {
  it("has non-empty groups, each with keys + desc on every row", () => {
    expect(SHORTCUT_GROUPS.length).toBeGreaterThan(0);
    for (const g of SHORTCUT_GROUPS) {
      expect(g.title).toBeTruthy();
      expect(g.items.length).toBeGreaterThan(0);
      for (const s of g.items) {
        expect(s.keys.trim()).not.toBe("");
        expect(s.desc.trim()).not.toBe("");
      }
    }
  });

  it("has no duplicate key combos within a group", () => {
    for (const g of SHORTCUT_GROUPS) {
      const keys = g.items.map((s) => s.keys);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("shortcutGroupsFor", () => {
  it("keeps ⌘ on mac", () => {
    const g = shortcutGroupsFor(true);
    expect(g[0].items.some((s) => s.keys.includes("⌘"))).toBe(true);
  });

  it("rewrites ⌘ → Ctrl off mac", () => {
    const g = shortcutGroupsFor(false);
    const all = g.flatMap((x) => x.items.map((s) => s.keys)).join(" ");
    expect(all).not.toContain("⌘");
    expect(all).toContain("Ctrl");
  });
});
