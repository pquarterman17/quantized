import { afterEach, describe, expect, it } from "vitest";

import { analysisCenterActions } from "./analysisCenterRun";
import { useApp } from "./useApp";
import type { Dataset } from "../lib/types";

const sheet = (id: string): Dataset => ({
  id,
  name: id,
  data: { time: [1, 2, 3, 4], values: [[1], [2], [3], [4]], labels: ["Y"], units: [""], metadata: {} },
});

afterEach(() => useApp.setState({ datasets: [], activeId: null }));

describe("analysisCenterRun", () => {
  it("applies the Analyze menu's requirement predicate (the Center cannot disagree with the menu)", () => {
    useApp.setState({ datasets: [sheet("a")], activeId: "a" });
    const avg = analysisCenterActions().find((a) => a.id === "average-curves")!;
    expect(typeof avg.disabled === "function" && avg.disabled()).toBe(true);
    expect(typeof avg.disabledReason === "function" ? avg.disabledReason() : avg.disabledReason).toBe("Needs 2 or more worksheets");
    useApp.setState({ datasets: [sheet("a"), sheet("b")] });
    expect(typeof avg.disabled === "function" && avg.disabled()).toBe(false);
  });
});
