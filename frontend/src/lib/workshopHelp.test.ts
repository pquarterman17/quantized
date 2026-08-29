// Coverage guard for the workshop help registry (P3.1).
//
// The point of `WORKSHOP_HELP` is that a `?` never opens an empty result
// list. Its values are search queries against the SHARED command metadata,
// so a renamed or removed command must fail here rather than silently
// degrade the affordance into a dead end.

import { describe, expect, it } from "vitest";

import { buildAppActions } from "../appCommands";
import { useApp } from "../store/useApp";
import { actionToHelpItem, searchHelpItems } from "./helpContent";
import { WORKSHOP_HELP, workshopHelpTopic } from "./workshopHelp";

const ITEMS = buildAppActions(useApp.getState).map(actionToHelpItem);

describe("workshop help registry", () => {
  it("every topic matches at least one real help item", () => {
    const dead: string[] = [];
    for (const [id, query] of Object.entries(WORKSHOP_HELP)) {
      if (searchHelpItems(ITEMS, query).length === 0) dead.push(`${id} → "${query}"`);
    }
    expect(dead, "these `?` buttons would open an empty Help list").toEqual([]);
  });

  it("resolves a topic by ToolWindow id and returns undefined for unknown ids", () => {
    expect(workshopHelpTopic("peaks")).toBe("Find peaks");
    expect(workshopHelpTopic("no-such-window")).toBeUndefined();
  });

  it("records the runtime-registered commands Help cannot see", () => {
    // Not a wish: these four are real commands with real descriptions that
    // `buildAppActions` never returns, because their modules publish through
    // a runtime registry instead. Help and the command palette therefore
    // cannot find them, and `relink-sources` is why the registry above has no
    // relink entry. Asserted so the day someone routes them through the
    // shared catalog, this test fails and the registry gets its entry.
    const ids = new Set(buildAppActions(useApp.getState).map((a) => a.id));
    for (const hidden of ["relink-sources", "paste-workbook", "take-over-editing", "open-as-copy"]) {
      expect(ids.has(hidden), `${hidden} is now searchable — add it to WORKSHOP_HELP`).toBe(false);
    }
  });
});
