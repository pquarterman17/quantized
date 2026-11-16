// Lanes C/K review 3 R2: opening a project puts its saved fit back on the
// canvas a few microtasks AFTER the open's own "matches disk" reset (the
// overlay module is lazy, a lane-K redraw awaits its evaluation). That restore
// is what the file already says, not an edit: the project must open clean. A
// real fit afterwards still marks it changed (review 2 N2).
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setAutosaveBackend } from "./lib/autosave";
import { memoryBackend } from "./lib/autosaveBackend";
import { createFigureDocument } from "./lib/figureDocument";
import { captureFit } from "./lib/figureOverlays";
import { defaultPlotView, type PlotWindow } from "./lib/plotview";
import type { Dataset, FitOverlay } from "./lib/types";
import { useRecentProjects } from "./store/recentProjects";
import { useApp } from "./store/useApp";
import { useWorkspaceAutosave } from "./useWorkspaceAutosave";

const mocks = vi.hoisted(() => ({ fitBands: vi.fn() }));
vi.mock("./lib/api/fitStats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/api/fitStats")>()), fitBands: mocks.fitBands,
}));

const CURVE = [10.5, 5.2, 2.8, 1.5];
const DECAY: Dataset = {
  id: "decay", name: "decay.csv",
  data: { time: [0, 1, 2, 3], values: [[10.4], [5.1], [2.9], [1.6]], labels: ["signal"], units: ["V"], metadata: {} },
  fitSpec: { model: "ExpDec1", xKey: null, yKey: 0, params: [0.5, 10, 1.25], nPoints: 4, nFree: 3 },
};
const FIT: FitOverlay = { datasetId: "decay", binding: { yKey: 0, xKey: null }, y: CURVE };

function window(overlays?: ReturnType<typeof captureFit>): PlotWindow {
  const document = createFigureDocument({ id: "fig", name: "W", datasetId: "decay", view: { ...defaultPlotView(), yKeys: [0] }, overlays });
  return {
    id: "pw1", kind: "plot", title: "W", datasetId: "decay", geometry: { x: 0, y: 0, w: 400, h: 300 },
    z: 0, winState: "normal", view: { ...defaultPlotView(), yKeys: [0] }, bg: "theme", linkGroup: null, pinned: false, document,
  };
}

async function settle(ms: number) {
  await act(async () => {
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** An open, as workspaceIO does it: load, then "matches disk" in the same tick. */
function open(plotWindow: PlotWindow): void {
  act(() => {
    const s = useApp.getState();
    s.loadWorkspace({ datasets: [DECAY], plotWindows: [plotWindow], focusedWindowId: "pw1" });
    s.setCurrentProject({ name: "p.dwk", path: "/p.dwk" });
  });
}

beforeEach(async () => {
  mocks.fitBands.mockReset();
  mocks.fitBands.mockImplementation(async ({ x }: { x: number[] }) => ({ yFit: x.map((_v, i) => CURVE[i]) }));
  setAutosaveBackend(memoryBackend());
  useRecentProjects.setState({ recentProjects: [] });
  useApp.setState(useApp.getInitialState(), true);
  renderHook(() => useWorkspaceAutosave());
  await settle(20);
});

describe("opening a fitted project leaves it clean", () => {
  it("a figure that kept its fit: seeded back, still clean; a real edit then marks it", async () => {
    open(window(captureFit(FIT, DECAY)));
    await vi.waitFor(() => expect(useApp.getState().fitOverlay).toEqual(FIT));
    await settle(20);
    expect(useApp.getState().projectDirty).toBe(false);
    act(() => useApp.getState().setFitOverlay({ ...FIT, y: [1, 2, 3, 4] })); // a new fit IS an edit
    expect(useApp.getState().projectDirty).toBe(true);
  });

  it("a 0.34-era project: its fit redrawn from the saved parameters, still clean", async () => {
    open(window());
    await vi.waitFor(() => expect(useApp.getState().fitOverlay).toEqual(FIT));
    await settle(20);
    expect(mocks.fitBands).toHaveBeenCalled();
    expect(useApp.getState().projectDirty).toBe(false);
  });
});
