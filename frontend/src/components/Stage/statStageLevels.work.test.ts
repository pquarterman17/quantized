// P2.6 box 2, review round 2 (item 7): a faceted stage plans the category
// axis ONCE — the level universe, its label resolution, the co-occurrence
// walk — and only COUNTS per panel, reusing the facet slices the compute
// effect already built. Asserted on the work done (call counts), not a clock.

import { describe, expect, it, vi } from "vitest";

import * as facet from "../../lib/facet";
import * as groupAxis from "../../lib/groupAxis";
import type { DataStruct, Dataset } from "../../lib/types";
import { levelAxes } from "./statStageLevels";

vi.mock("../../lib/groupAxis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/groupAxis")>();
  return { ...actual, planGroupAxis: vi.fn(actual.planGroupAxis), countGroupAxis: vi.fn(actual.countGroupAxis) };
});
vi.mock("../../lib/facet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/facet")>();
  return { ...actual, facetSlices: vi.fn(actual.facetSlices) };
});

const DATA: DataStruct = {
  time: Array.from({ length: 9 }, (_, i) => i),
  values: Array.from({ length: 9 }, (_, i) => [i % 3, i, Math.floor(i / 3)]),
  labels: ["grp", "y", "fac"],
  units: ["", "", ""],
  metadata: {},
  cat_levels: { 0: ["A", "B", "C"], 2: ["f0", "f1", "f2"] },
};
const DS: Dataset = { id: "w", name: "w", data: DATA };

describe("levelAxes — whole-dataset work once, per-panel work only counting", () => {
  it("plans once for three panels, counts four times, and never re-slices", async () => {
    const { facetSlices } = await vi.importActual<typeof import("../../lib/facet")>("../../lib/facet");
    const slices = facetSlices(DATA, 2);
    vi.mocked(groupAxis.planGroupAxis).mockClear();
    vi.mocked(groupAxis.countGroupAxis).mockClear();
    vi.mocked(facet.facetSlices).mockClear();
    const axes = levelAxes({
      active: DS, data: DATA, mode: "box", groupCol: 0, group2Col: null, valueCol: 1, plotted: [1],
      barValueChannels: [1], facetCol: 2, slices,
    });
    expect(axes?.panels?.size).toBe(3);
    expect(groupAxis.planGroupAxis).toHaveBeenCalledTimes(1);
    expect(groupAxis.countGroupAxis).toHaveBeenCalledTimes(4); // flat + 3 panels
    expect(facet.facetSlices).not.toHaveBeenCalled();
  });
});
