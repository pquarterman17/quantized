import { describe, expect, it } from "vitest";

import { buildAppActions } from "../appCommands";
import { useApp } from "../store/useApp";
import {
  actionToHelpItem,
  searchHelpItems,
  type HelpItem,
} from "./helpContent";

const COMMANDS = buildAppActions(useApp.getState);
const ITEMS = COMMANDS.map(actionToHelpItem);

describe("shared command help metadata", () => {
  it("documents every curated command at its command definition", () => {
    expect(COMMANDS.length).toBeGreaterThan(80);
    expect(
      COMMANDS.filter((action) => !action.description).map(
        (action) => action.id,
      ),
    ).toEqual([]);
    for (const action of COMMANDS) {
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.description!.length).toBeGreaterThan(20);
    }
  });

  it("uses unique stable command ids", () => {
    const ids = COMMANDS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("turns command metadata into a searchable menu-path topic", () => {
    const command = COMMANDS.find(
      (action) => action.id === "break-x-axis",
    )!;
    const item = actionToHelpItem(command);
    expect(item.key).toBe("break-x-axis");
    expect(item.meta).toBe("Plot ▸ Layout");
    expect(item.detail).toContain("discontinuous");
  });

  it("rejects a command with no description", () => {
    expect(() =>
      actionToHelpItem({
        id: "undocumented",
        group: "Test",
        label: "Undocumented",
        run: () => undefined,
      }),
    ).toThrow('command "undocumented" has no help description');
  });
});

describe("searchHelpItems", () => {
  it("returns everything in order for a blank query", () => {
    const all = searchHelpItems(ITEMS, "");
    expect(all).toHaveLength(ITEMS.length);
    expect(all[0].key).toBe(ITEMS[0].key);
    expect(all.every((result) => result.hits.length === 0)).toBe(true);
  });

  it("finds a command by a word in its title with highlight hits", () => {
    const results = searchHelpItems(ITEMS, "hyster");
    expect(results[0].key).toBe("hysteresis");
    expect(results[0].hits.length).toBeGreaterThan(0);
  });

  it("finds a command by description text not present in its title", () => {
    const results = searchHelpItems(ITEMS, "coercivity");
    const hit = results.find((result) => result.key === "hysteresis");
    expect(hit).toBeDefined();
    expect(hit!.hits).toEqual([]);
  });

  it("ranks a title match above a description-only match", () => {
    const results = searchHelpItems(ITEMS, "peak");
    expect(results[0].title.toLowerCase()).toContain("peak");
  });

  it("returns nothing for an unknown query", () => {
    expect(searchHelpItems(ITEMS, "zzxqwv")).toEqual([]);
  });

  it("searches arbitrary HelpItem sources", () => {
    const items: HelpItem[] = [
      { key: "a", title: "Alpha", detail: "the first" },
      { key: "b", title: "Beta", detail: "the second" },
    ];
    expect(searchHelpItems(items, "alph").map((result) => result.key)).toEqual([
      "a",
    ]);
  });
});
