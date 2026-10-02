// A LIVE Break-at-gaps arrangement (the store's `composition` render cache)
// and row exclusion. The export sends `x_breaks` only when the screen's rule
// (`facet.breakCompositionFromData` over the analysis rows: two or more
// surviving panels) still draws a break (BUG-012 residual). The cached
// arrangement used to keep its gesture-time panels, so excluding every row on
// one side of the gap left the screen paneled while the export drew one plain
// plot. It is now rebuilt from its own break ranges over the current rows.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { breakPanelsOf } from "../../lib/composition";
import { createFigureDocument } from "../../lib/figureDocument";
import { buildStageFigureSpec } from "../../lib/figureSpecStage";
import { defaultPlotView } from "../../lib/plotview";
import type { Dataset, DataStruct } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import { multiPanelShowing, useEffectiveComposition } from "./useEffectiveComposition";

// x = 0,1,2 | 10,11,12: one large gap, so Break at gaps panels it in two.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[0, 1], [1, 2], [2, 3], [10, 4], [11, 5], [12, 6]],
  labels: ["x", "y"],
  units: ["", ""],
  metadata: {},
};

function setup(): void {
  useApp.setState({
    datasets: [{ id: "d1", name: "ds1", data: DATA }],
    activeId: "d1", xKey: 0, yKeys: [1], y2Keys: null, facetKey: null, groupKey: null,
    stackMode: false, composition: null, polarMode: false, statMode: false,
    plotWindows: [
      {
        id: "w1", kind: "plot", title: "", datasetId: "d1",
        geometry: { x: 0, y: 0, w: 480, h: 360 }, z: 0, winState: "normal",
        bg: "theme", linkGroup: null, pinned: false, view: defaultPlotView(),
        document: createFigureDocument({ id: "fig-w1", name: "w1", datasetId: "d1", view: defaultPlotView() }),
      },
    ],
    focusedWindowId: "w1",
  });
}

const screenBreaks = (rerender: () => void, read: () => ReturnType<typeof useEffectiveComposition>) => {
  rerender();
  return breakPanelsOf(read());
};

function exportBreaks(): unknown {
  const ds = useApp.getState().datasets.find((d) => d.id === "d1") as Dataset;
  const spec = buildStageFigureSpec(useApp.getState, ds, "fig", { fmt: "pdf", style: "default", dpi: 300, title: "" });
  return spec.overrides?.x_breaks;
}

beforeEach(setup);

describe("useEffectiveComposition — a live Break-at-gaps break follows row exclusion", () => {
  it("excluding one whole side collapses the screen break, as the export has none", () => {
    useApp.getState().breakAtGaps("d1", [[2, 10]]);
    const hook = renderHook(() => useEffectiveComposition(useActiveDataset()));
    expect(breakPanelsOf(hook.result.current)).toHaveLength(2); // the gesture paneled it

    const ds = useApp.getState().datasets[0];
    useApp.setState({ datasets: [{ ...ds, excludedRows: [3, 4, 5] }] });
    const panels = screenBreaks(() => hook.rerender(), () => hook.result.current);

    expect(exportBreaks()).toBeUndefined();
    expect(panels).toBeNull();
    const { stackMode } = useApp.getState();
    expect(multiPanelShowing(hook.result.current, stackMode, 1)).toBe(false);
  });

  it("excluding rows that leave both sides populated keeps the break, rebuilt over the kept rows", () => {
    useApp.getState().breakAtGaps("d1", [[2, 10]]);
    const hook = renderHook(() => useEffectiveComposition(useActiveDataset()));
    const ds = useApp.getState().datasets[0];
    useApp.setState({ datasets: [{ ...ds, excludedRows: [5] }] });
    const panels = screenBreaks(() => hook.rerender(), () => hook.result.current);
    expect(panels).toHaveLength(2);
    expect(panels?.[1].payload.data[0]).toEqual([10, 11]); // the excluded row is gone
  });
});
