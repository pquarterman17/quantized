// P2.5 / PR #431 review item 5: an older build's `sanitizeSteps` silently
// drops an unknown step kind, then runs the later steps on the input. So a
// .dwk whose pipeline holds a `transform` step is written as version 5, which
// every v1-v4 reader refuses outright; any other save stays v4.

import { describe, expect, it } from "vitest";

import { makeStep } from "./pipeline";
import { parseWorkspace, serializeWorkspace } from "./workspace";

const ds = {
  id: "d1",
  name: "a",
  data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
};

/** The version gate of a v1-v4 build (lib/workspace.ts before this change). */
const olderReaderAccepts = (text: string) => [1, 2, 3, 4].includes((JSON.parse(text) as { version: number }).version);

describe("workspace version for transform steps", () => {
  it("writes v5 when the pipeline holds a transform step, and v5 round-trips here", () => {
    const steps = [
      makeStep("expression", "Add column", "qz.addColumn()", { name: "z", expr: "A" }),
      makeStep("transform", "Transpose a", "qz.transform()", { op: "transpose" }),
    ];
    const text = serializeWorkspace({ datasets: [ds], macroSteps: steps });
    expect(JSON.parse(text).version).toBe(5);
    expect(olderReaderAccepts(text)).toBe(false);
    expect(parseWorkspace(text).macroSteps.map((s) => s.kind)).toEqual(["expression", "transform"]);
  });

  it("stays v4 without one, so ordinary projects still open in older builds", () => {
    const text = serializeWorkspace({
      datasets: [ds],
      macroSteps: [makeStep("fit", "Fit", "qz.fit()", { model: "linear" })],
    });
    expect(JSON.parse(text).version).toBe(4);
    expect(olderReaderAccepts(text)).toBe(true);
  });
});
