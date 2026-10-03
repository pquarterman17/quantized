import { describe, expect, it } from "vitest";

import { buildAppActions } from "../appCommands";
import { useApp } from "../store/useApp";
import { TECHNIQUE_WORKFLOWS, type TechniqueActionId } from "./techniqueWorkflow";
import type { Technique } from "./types";

const SPECIAL = new Set<TechniqueActionId>([
  "quick-plot", "configure-figure", "sims-process", "sims-compare", "sims-region",
]);

describe("technique workflow manifest", () => {
  it("covers the complete closed technique vocabulary", () => {
    const techniques: Technique[] = [
      "magnetometry.mvsh", "magnetometry.mvst", "xrd.powder", "xrd.rsm",
      "reflectometry", "sims", "transport", "spectroscopy", "generic",
    ];
    expect(Object.keys(TECHNIQUE_WORKFLOWS).sort()).toEqual([...techniques].sort());
  });

  it("uses only real canonical commands and never repeats an action within one workflow", () => {
    const canonical = new Set(buildAppActions(useApp.getState).map((a) => a.id));
    for (const workflow of Object.values(TECHNIQUE_WORKFLOWS)) {
      const ids = workflow.stages.flatMap((stage) => stage.actions);
      expect(new Set(ids).size, workflow.label).toBe(ids.length);
      expect(ids.filter((id) => !SPECIAL.has(id) && !canonical.has(id)), workflow.label).toEqual([]);
    }
  });

  it("does not leak technique-specific analysis into unrelated workspaces", () => {
    const ids = (technique: Technique) => TECHNIQUE_WORKFLOWS[technique].stages.flatMap((s) => s.actions);
    for (const technique of Object.keys(TECHNIQUE_WORKFLOWS) as Technique[]) {
      if (technique !== "sims") expect(ids(technique).some((id) => id.startsWith("sims-"))).toBe(false);
      if (technique !== "magnetometry.mvsh") expect(ids(technique)).not.toContain("hysteresis");
      if (technique !== "xrd.rsm") expect(ids(technique)).not.toContain("rsm");
      if (technique !== "reflectometry") expect(ids(technique)).not.toContain("reflectivity");
    }
  });
});
