import { describe, expect, it } from "vitest";

import type { Action } from "../store/commands";
import { analysisTools } from "./analysisCenter";
import { analysisUnavailableReason } from "./analysisRequirements";
import type { Dataset } from "./types";

const action = (id: string): Action => ({ id, group: "Analyze", label: id, description: id, run: () => {} });

function sheet(id = "d1"): Dataset {
  return {
    id,
    name: `${id}.dat`,
    data: {
      time: Array.from({ length: 12 }, (_, i) => i),
      values: Array.from({ length: 12 }, (_, i) => [i * 1.5]),
      labels: ["Signal"],
      units: [""],
      metadata: { technique: "generic" },
    },
  };
}

// The Analysis Center used to run its own compatibility() with no worksheet-count
// or 2θ check; it now reads the same predicate table as the Analyze menu.
describe("Analysis Center converges on the shared requirement predicates", () => {
  it("flags Average curves with a single worksheet and clears it with two", () => {
    const one = sheet();
    const [alone] = analysisTools([action("average-curves")], one, [one]);
    expect(alone?.available).toBe(false);
    expect(alone?.unavailableReason).toContain("2 or more worksheets");
    const [pair] = analysisTools([action("average-curves")], one, [one, sheet("d2")]);
    expect(pair?.available).toBe(true);
  });

  it("flags 2θ-only tools on a worksheet whose X axis is not 2θ", () => {
    const ds = sheet();
    const [pawley] = analysisTools([action("reductions-pawley")], ds, [ds]);
    expect(pawley?.available).toBe(false);
    expect(pawley?.unavailableReason).toContain("2θ");
  });

  it("never disagrees with the menu predicate on availability", () => {
    const ds = sheet();
    for (const id of ["average-curves", "reductions-pawley", "reductions-reference", "curvefit"]) {
      const menu = analysisUnavailableReason(id, { dataset: ds, datasets: [ds] });
      const [tool] = analysisTools([action(id)], ds, [ds]);
      expect(tool?.available).toBe(menu === undefined);
    }
  });
});
