// F4.2c (a): a spatial Origin panel draws its dataset's excluded and
// filter-dropped rows as every other plot does (hidden, or muted "(excluded)"
// companions), where it used to draw them as ordinary data while "Export
// page…" left them out. `fetchPlot` is mocked to its offline column packing so
// the rows are the dataset's own.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SpatialPanel } from "../../lib/multipanel";
import type { Dataset } from "../../lib/types";
import { fetchSpatialPanel, spatialEmptyNote } from "./spatialPanelFetch";

const { fetchPlot } = vi.hoisted(() => ({ fetchPlot: vi.fn() }));
vi.mock("../../lib/plotdata", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/plotdata")>()),
  fetchPlot,
}));

const PANEL: SpatialPanel = {
  datasetId: "d1", xKey: null, yKeys: [0], xLim: [0, 2], yLim: [1, 3], xLog: false, yLog: false, row: 0, col: 0,
};

function dataset(excludedRows?: number[]): Dataset {
  return {
    id: "d1",
    name: "book",
    data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["signal"], units: [""], metadata: {} },
    ...(excludedRows ? { excludedRows } : {}),
  };
}

beforeEach(() => {
  fetchPlot.mockReset();
  fetchPlot.mockResolvedValue({
    data: [
      [0, 1, 2],
      [1, 2, 3],
    ],
    series: [{ label: "signal" }],
    xLabel: "time",
    xUnit: "",
  });
});

describe("fetchSpatialPanel draws excluded rows as the app mode says", () => {
  it("without excluded rows, the fetched series is drawn untouched", async () => {
    const { payload } = await fetchSpatialPanel(PANEL, dataset(), "Line", "grey");
    expect(payload.data).toEqual([
      [0, 1, 2],
      [1, 2, 3],
    ]);
  });

  it("hide: the excluded row is a gap", async () => {
    const { payload } = await fetchSpatialPanel(PANEL, dataset([1]), "Line", "hide");
    expect(payload.data[1]).toEqual([1, null, 3]);
    expect(payload.series).toHaveLength(1);
  });

  it("grey: the excluded row moves to a muted '(excluded)' companion", async () => {
    const { payload } = await fetchSpatialPanel(PANEL, dataset([1]), "Line", "grey");
    expect(payload.data.slice(1)).toEqual([
      [1, null, 3],
      [null, 2, null],
    ]);
    expect(payload.series[1]).toMatchObject({ label: "signal (excluded)", kind: "points", muted: true });
  });

  it("a panel with dropped rows is never server-decimated (the mask indexes dataset rows)", async () => {
    const big: Dataset = {
      ...dataset([1]),
      data: {
        time: Array.from({ length: 50_000 }, (_, i) => i),
        values: Array.from({ length: 50_000 }, (_, i) => [i]),
        labels: ["signal"], units: [""], metadata: {},
      },
    };
    await fetchSpatialPanel(PANEL, big, "Line", "hide");
    expect(fetchPlot.mock.calls[0][6]).toBeNull();
    await fetchSpatialPanel(PANEL, { ...big, excludedRows: [] }, "Line", "hide");
    expect(fetchPlot.mock.calls[1][6]).not.toBeNull();
  });
});

describe("fetchSpatialPanel: Origin's asymmetric / X error bars (lane E2)", () => {
  it("builds the panel's spans from its own error bindings, keyed like the payload", async () => {
    const ds: Dataset = {
      id: "d1",
      name: "book",
      data: { time: [0, 1, 2], values: [[1, 0.1, 0.3], [2, 0.2, 0.4], [3, 0.1, 0.5]], labels: ["y", "up", "x"], units: ["", "", ""], metadata: {} },
    };
    const p: SpatialPanel = {
      ...PANEL, hiddenChannels: [1, 2],
      errors: [{ channel: 1, target: 0, axis: "y", side: "+" }, { channel: 2, target: 0, axis: "x", side: "both" }],
    };
    const { errorSpans } = await fetchSpatialPanel(p, ds, "Line", "grey");
    // half a Y pair draws nothing (never invents the other side); the X bars draw
    expect(errorSpans.get(1)).toEqual([{ axis: "x", plus: [0.3, 0.4, 0.5], minus: [0.3, 0.4, 0.5] }]);
  });
});

// Ledger R-36: a layer whose curves are all left out keeps its cell and says
// why, worded like the single plot's empty notice, over the plot (no clicks).
describe("spatialEmptyNote", () => {
  it("is a centred, click-through status note with the panel's text", () => {
    const note = spatialEmptyNote("No curves: left out");
    expect(note.getAttribute("role")).toBe("status");
    expect(note.textContent).toBe("No curves: left out");
    expect(note.style.pointerEvents).toBe("none");
    expect(note.style.position).toBe("absolute");
  });
});
