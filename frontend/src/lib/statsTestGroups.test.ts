import { describe, expect, it } from "vitest";

import { STATS_TESTS } from "./statsTests";
import { statsTestGroups } from "./statsTestGroups";

describe("statsTestGroups", () => {
  it("places every test in exactly one group (none dropped, none repeated)", () => {
    const ids = statsTestGroups().flatMap((g) => g.tests.map((t) => t.id));
    expect([...ids].sort()).toEqual(STATS_TESTS.map((t) => t.id).sort());
  });

  it("uses the fixed family order and puts SPC and life data in their own groups", () => {
    const labels = statsTestGroups().map((g) => g.label);
    expect(labels[0]).toBe("Normality");
    expect(labels).not.toContain("Other");
    const spc = statsTestGroups().find((g) => g.label.startsWith("Quality"));
    expect(spc?.tests.map((t) => t.id)).toEqual(["control-chart", "capability"]);
    const life = statsTestGroups().find((g) => g.label.startsWith("Life"));
    expect(life?.tests.map((t) => t.id)).toEqual(["life-distribution", "life-by-x"]);
  });

  it("puts response screening in its own Screening group", () => {
    const g = statsTestGroups().find((x) => x.label === "Screening");
    expect(g?.tests.map((t) => t.id)).toEqual(["response-screening"]);
  });

  it("collects unmapped families under Other", () => {
    const odd = { ...STATS_TESTS[0], id: "anderson" as const, family: "Mystery" };
    expect(statsTestGroups([odd]).map((g) => g.label)).toEqual(["Other"]);
  });
});
