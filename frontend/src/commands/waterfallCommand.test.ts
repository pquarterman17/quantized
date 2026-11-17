// UX9-D: the Plot-menu / palette Waterfall action and the Channels-card slider
// write the same store field, and the palette finds the action for the words a
// scientist types ("waterfall", "offset").

import { beforeEach, describe, expect, it } from "vitest";

import { rankActions } from "../lib/paletteRank";
import type { Dataset } from "../lib/types";
import { useApp } from "../store/useApp";
import { withCommandDocs } from "./commandDocs";
import { buildPlotCommands } from "./plotCommands";
import { applyWaterfall, DEFAULT_WATERFALL } from "./waterfallCommand";

function ds(id: string): Dataset {
  return {
    id,
    name: `${id}.txt`,
    data: { time: [0, 1, 2], values: [[1], [4], [2]], labels: ["Intensity"], units: ["cts"], metadata: {} },
  };
}

const MULTI: Dataset = {
  id: "m",
  name: "multi",
  data: { time: [0, 1, 2], values: [[1, 2], [4, 5], [2, 3]], labels: ["A", "B"], units: ["", ""], metadata: {} },
};

beforeEach(() => {
  useApp.setState({ datasets: [], activeId: null, selectedIds: [], waterfall: 0, yKeys: null, xKey: null, history: [] });
});

describe("applyWaterfall", () => {
  it("plots the selection together and sets the offset on the same field the slider writes", async () => {
    useApp.setState({ datasets: [ds("a"), ds("b"), ds("c")], selectedIds: ["a", "b", "c"], activeId: "a" });
    await applyWaterfall();
    const s = useApp.getState();
    expect(s.datasets).toHaveLength(4); // the live graph landed
    expect(s.waterfall).toBe(DEFAULT_WATERFALL);
    expect(s.datasets.find((d) => d.id === s.activeId)?.linkedCurves).toHaveLength(3);
    // The Channels-card slider is setWaterfall(v / 100): the identical field.
    s.setWaterfall(0.5);
    expect(useApp.getState().waterfall).toBe(0.5);
  });

  it("is one undo step: a single undo removes the overlay graph and the offset", async () => {
    useApp.setState({ datasets: [ds("a"), ds("b"), ds("c")], selectedIds: ["a", "b", "c"], activeId: "a" });
    await applyWaterfall();
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["waterfall"]);
    useApp.getState().undo();
    expect(useApp.getState().datasets).toHaveLength(3);
    expect(useApp.getState().waterfall).toBe(0);
  });

  it("records nothing when it refuses", async () => {
    useApp.setState({ datasets: [ds("a")], activeId: "a", selectedIds: ["a"] });
    await applyWaterfall();
    expect(useApp.getState().history).toEqual([]);
  });

  it("stacks the focused graph's own curves when nothing is multi-selected, keeping an existing offset", async () => {
    useApp.setState({ datasets: [MULTI], activeId: "m", selectedIds: ["m"], waterfall: 0.2 });
    await applyWaterfall();
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().waterfall).toBe(0.2);
  });

  it("refuses a single-curve plot without touching the offset", async () => {
    useApp.setState({ datasets: [ds("a")], activeId: "a", selectedIds: ["a"] });
    await applyWaterfall();
    expect(useApp.getState().waterfall).toBe(0);
  });

  it("is what the Plot menu's Waterfall… item runs", async () => {
    useApp.setState({ datasets: [MULTI], selectedIds: ["m"], activeId: "m" });
    const item = buildPlotCommands(useApp.getState).find((a) => a.id === "waterfall")!;
    expect(item.label).toBe("Waterfall…");
    void item.run();
    // The state is set synchronously for a single multi-curve graph.
    await new Promise((r) => setTimeout(r, 0));
    expect(useApp.getState().waterfall).toBe(DEFAULT_WATERFALL);
  });
});

describe("palette discovery", () => {
  const actions = withCommandDocs(buildPlotCommands(useApp.getState));
  for (const q of ["waterfall", "offset"]) {
    it(`"${q}" ranks the Waterfall action first`, () => {
      expect(rankActions(actions, q)[0]?.a.id).toBe("waterfall");
    });
  }
});
