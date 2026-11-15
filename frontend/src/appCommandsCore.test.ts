// App paints with the core command list and adds the Analyze group right after
// mount (the full list, appCommands.ts): the core list must not carry Analyze,
// and the full list must be core + Analyze with every core entry intact.
import { describe, expect, it } from "vitest";

import { buildAppActions } from "./appCommands";
import { buildCoreActions } from "./appCommandsCore";
import { useApp } from "./store/useApp";

describe("core vs full command list", () => {
  it("core has no Analyze entries; full is a superset with the same core entries", () => {
    const core = buildCoreActions(useApp.getState);
    const full = buildAppActions(useApp.getState);
    expect(core.some((a) => a.group === "Analyze")).toBe(false);
    expect(full.some((a) => a.id === "curvefit" && a.group === "Analyze")).toBe(true);
    const ids = new Set(full.map((a) => a.id));
    expect(core.every((a) => ids.has(a.id))).toBe(true);
    expect(full.length).toBeGreaterThan(core.length);
  });
});
