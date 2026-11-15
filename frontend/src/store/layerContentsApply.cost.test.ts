// Gap audit 3 N1 review: one Layer Contents Apply assembles the graph ONCE,
// however many column shifts the draft needs (O(rows x curves), not x K).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/linkedCurves", async (orig) => {
  const real = await orig<typeof import("../lib/linkedCurves")>();
  return { ...real, assembleLinkedCurves: vi.fn(real.assembleLinkedCurves) };
});
import { assembleLinkedCurves } from "../lib/linkedCurves";
import { layerRowsOf } from "../lib/layerContents";
import { plotSelectedTogether } from "../lib/plotSelectedTogether";
import type { Dataset } from "../lib/types";
import { applyLayerContents } from "./layerContentsApply";
import { useApp } from "./useApp";

const sheet = (id: string): Dataset => ({
  id, name: id, data: { time: [0, 1], values: [[1], [2]], labels: ["Y"], units: [""], metadata: {} },
});
const ids = ["a", "b", "c", "d", "e", "f"];

beforeEach(async () => {
  useApp.setState({ datasets: ids.map(sheet), selectedIds: [], history: [], future: [] });
  await plotSelectedTogether(ids);
});

describe("Layer Contents apply cost", () => {
  it("reverses six curves (five moves) with a single assembly", () => {
    const g = useApp.getState().datasets.find((d) => d.linkedCurves)!;
    vi.mocked(assembleLinkedCurves).mockClear();
    applyLayerContents(g.id, [...layerRowsOf(g.linkedCurves!)].reverse());
    expect(useApp.getState().datasets.find((d) => d.linkedCurves)!.linkedCurves!.map((k) => k.datasetId)).toEqual([...ids].reverse());
    expect(vi.mocked(assembleLinkedCurves)).toHaveBeenCalledTimes(1);
  });
});
