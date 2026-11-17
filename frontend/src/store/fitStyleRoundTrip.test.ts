// UX9-I: a Curve Fit's look over its data survives File > Save + reopen. The
// fit was drawn as a thinner dashed line over data that gained markers while
// it was shown -- and reopened as a solid line over plain data, because the
// figure's saved fit section dropped the `curveFit` flag that look follows
// (lib/fitOverlayStyle.ts). The flag is now part of the saved section, so the
// SERIES the canvas builds are the same before and after the round trip, with
// no fit panel open on either side.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createFigureDocument } from "../lib/figureDocument";
import { withFitOverlay, type PlotPayload } from "../lib/plotdata";
import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import type { Dataset, FitOverlay } from "../lib/types";
import { buildSeriesDefs } from "../lib/uplotSeries";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { useApp } from "./useApp";
import { resetWindowOverlaysForTests } from "./windowOverlays";
import { loadWindowOverlays } from "./windowOverlaysLazy";

const DS: Dataset = {
  id: "d1", name: "decay.csv",
  data: { time: [0, 1, 2, 3, 4], values: [[10], [6], [3.7], [2.2], [1.4]], labels: ["signal"], units: ["V"], metadata: {} },
};
const FIT: FitOverlay = { datasetId: "d1", binding: { yKey: 0, xKey: null }, y: [10.1, 6.1, 3.6, 2.2, 1.3], curveFit: true };
const COLORS = { accentColor: "#00f", inkColor: "#fff", inkDimColor: "#888", isDarkBg: true };

function plotWindow(): PlotWindow {
  const view = { ...defaultPlotView(), yKeys: [0] };
  return {
    id: "w1", kind: "plot", title: "decay", datasetId: "d1", geometry: { x: 0, y: 0, w: 400, h: 300 },
    z: 0, winState: "normal", view, bg: "theme", linkGroup: null, pinned: false,
    document: createFigureDocument({ id: "fig", name: "decay", datasetId: "d1", view }),
  };
}

/** The look of every drawn series: what the canvas builds from the store now. */
function seriesLook() {
  const s = useApp.getState();
  const ds = s.datasets.find((d) => d.id === "d1")!;
  const base: PlotPayload = { data: [ds.data.time, ds.data.values.map((r) => r[0])], series: [{ label: "signal", unit: "V" }], xLabel: "time", xUnit: "s" };
  const payload = withFitOverlay(base, s.fitOverlay, "d1");
  const { series } = buildSeriesDefs(payload, { defaultTrace: "Line" }, [], true, COLORS);
  return series.slice(1).map((x) => ({ label: x.label, width: x.width, dash: x.dash ?? null, points: !!x.points?.show }));
}

/** Save the way File > Save does (the focused window's live fit folded in), then reopen. */
async function saveAndReopen(): Promise<void> {
  const s = useApp.getState();
  const content = serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
  useApp.setState(useApp.getInitialState(), true); // a fresh session: no fit, no panel
  resetWindowOverlaysForTests();
  useApp.getState().loadWorkspace(parseWorkspace(content, { width: 5000, height: 5000 }));
  await vi.waitFor(() => expect(useApp.getState().fitOverlay).not.toBeNull());
}

beforeAll(async () => { await loadWindowOverlays(); });

beforeEach(() => {
  resetWindowOverlaysForTests();
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({ datasets: [DS], activeId: "d1", yKeys: [0], plotWindows: [plotWindow()], focusedWindowId: "w1", fitOverlay: FIT, curveFitOpen: false });
});

describe("the fit-over-data style round-trips through the .dwk", () => {
  it("dashed fit over marked data before the save; the same series after the reopen", async () => {
    const before = seriesLook();
    expect(before).toHaveLength(2);
    expect(before[0].points).toBe(true); // the data gained markers under the fit
    expect(before[1].dash).not.toBeNull(); // the fit is dashed
    await saveAndReopen();
    expect(useApp.getState().curveFitOpen).toBe(false); // no panel decides the look
    expect(useApp.getState().fitOverlay?.curveFit).toBe(true);
    expect(seriesLook()).toEqual(before);
  });

  it("a plain fit (Quick Fit, peaks) stays plain after the reopen", async () => {
    const { curveFit: _flag, ...plain } = FIT;
    useApp.setState({ fitOverlay: plain });
    const before = seriesLook();
    expect(before[1].dash).toBeNull();
    await saveAndReopen();
    expect(useApp.getState().fitOverlay?.curveFit).toBeUndefined();
    expect(seriesLook()).toEqual(before);
  });
});
