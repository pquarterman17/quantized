import { describe, expect, it } from "vitest";

import { liveRoles, OWN_X, planPlotSetup, selectionRoles, withRole } from "./plotSetup";
import type { Dataset } from "./types";

// A dA C D dD F: dA is A's error and dD is D's; the others are plain data.
const labels = ["A", "dA", "C", "D", "dD", "F"];
const ds = (extra: Partial<Dataset> = {}): Dataset => ({
  id: "d",
  name: "book",
  data: {
    time: [0, 1],
    values: [labels.map(() => 1), labels.map(() => 2)],
    labels,
    units: labels.map(() => ""),
    metadata: {},
  },
  errorRoles: [], // 'checked: none' -- no name inference
  ...extra,
});
const live = { xKey: null, yKeys: null, pointLabels: null };

describe("planPlotSetup", () => {
  it("fails closed without an X or a Y", () => {
    expect(planPlotSetup(ds(), { 0: "y" }, null).problems).toEqual(["Choose an X column (or the sheet's own X)."]);
    expect(planPlotSetup(ds(), { [OWN_X]: "x" }, null).problems).toEqual(["Choose at least one Y column."]);
  });

  it("builds X, Y and a Y error paired to the nearest preceding Y", () => {
    const r = planPlotSetup(ds(), { [OWN_X]: "x", 0: "y", 1: "yErr", 3: "y", 4: "yErr" }, null);
    expect(r.problems).toEqual([]);
    expect(r.plan?.xKey).toBeNull();
    expect(r.plan?.yKeys).toEqual([0, 3]);
    expect(r.plan?.errorRoles).toEqual([
      { channel: 1, target: 0, axis: "y", side: "both" },
      { channel: 4, target: 3, axis: "y", side: "both" },
    ]);
    expect(r.plan?.decided).toHaveLength(2);
  });

  it("refuses a Y error column with no Y before it", () => {
    const r = planPlotSetup(ds(), { 2: "x", 3: "y", 1: "yErr" }, null);
    expect(r.plan).toBeNull();
    expect(r.problems).toEqual(["dA is a Y error column with no Y before it."]);
  });

  it("uses a value column as X and takes the Label from a column", () => {
    const r = planPlotSetup(ds(), { 2: "x", 3: "y", 5: "label" }, null);
    expect(r.plan).toMatchObject({ xKey: 2, yKeys: [3], label: 5 });
  });

  it("leaves the dataset's error roles alone when the grid does not touch them", () => {
    const d = ds({ errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }] });
    const r = planPlotSetup(d, { [OWN_X]: "x", 0: "y", 1: "yErr" }, null);
    expect(r.plan?.errorRoles).toBeNull();
    expect(r.plan?.decided).toEqual([]);
  });

  it("keeps unchanged bindings verbatim, asymmetric halves included, even for an unplotted Y", () => {
    const d = ds({
      errorRoles: [
        { channel: 1, target: 0, axis: "y", side: "+" },
        { channel: 4, target: 3, axis: "y", side: "both" },
      ],
    });
    // Replace-style: only C is plotted now; the error columns keep their roles.
    const r = planPlotSetup(d, { [OWN_X]: "x", 2: "y", 1: "yErr", 4: "yErr" }, null);
    expect(r.plan?.errorRoles).toBeNull();
  });

  it("drops a binding whose column was given another role", () => {
    const d = ds({ errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }] });
    const r = planPlotSetup(d, { [OWN_X]: "x", 0: "y", 1: "y" }, null);
    expect(r.plan?.errorRoles).toEqual([]);
  });

  it("an X error follows the Y in its block, else the shared X axis", () => {
    expect(planPlotSetup(ds(), { [OWN_X]: "x", 0: "y", 1: "xErr" }, null).plan?.errorRoles).toEqual([
      { channel: 1, target: 0, axis: "x", side: "both" },
    ]);
    expect(planPlotSetup(ds(), { [OWN_X]: "x", 1: "xErr", 2: "y" }, null).plan?.errorRoles).toEqual([
      { channel: 1, target: -1, axis: "x", side: "both" },
    ]);
  });

  it("keeps a text-column point label unless a column is chosen", () => {
    const text = { key: -1, text: "name", mode: "all", topN: 10 } as const;
    expect(planPlotSetup(ds(), { [OWN_X]: "x", 0: "y" }, text).plan?.label).toBe("keep");
    expect(planPlotSetup(ds(), { [OWN_X]: "x", 0: "y" }, null).plan?.label).toBeNull();
  });
});

describe("roles from the plot and from a selection", () => {
  it("reads the live plot: its X, its Ys (never an error column), the error roles and the label", () => {
    const d = ds({ errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }] });
    const roles = liveRoles(d, { xKey: 2, yKeys: [0, 1, 3], pointLabels: { key: 5, mode: "all", topN: 10 } });
    expect(roles).toEqual({ 2: "x", 0: "y", 3: "y", 1: "yErr", 5: "label" });
  });

  it("seeds a selection from the designations and leaves the X to the user", () => {
    const d = ds({ columnDesignations: { 1: "Y-error", 5: "label", 4: "disregard" }, errorRoles: [] });
    expect(selectionRoles(d, live, [0, 1, 3, 4, 5], "replace")).toEqual({ 0: "y", 1: "yErr", 3: "y", 5: "label" });
  });

  it("add mode starts from the plot as it is", () => {
    const d = ds({ errorRoles: [] });
    expect(selectionRoles(d, { ...live, xKey: 2, yKeys: [0] }, [3], "add")).toEqual({ 2: "x", 0: "y", 3: "y" });
  });

  it("X and Label are single slots", () => {
    expect(withRole({ 0: "x", 1: "y" }, 2, "x")).toEqual({ 1: "y", 2: "x" });
    expect(withRole({ 0: "label" }, 3, "label")).toEqual({ 3: "label" });
    expect(withRole({ 0: "y" }, 0, null)).toEqual({});
  });
});
