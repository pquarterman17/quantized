// F4.2c (a): a spatial Origin panel draws its dataset's excluded and
// filter-dropped rows as every other plot does (hidden, or muted "(excluded)"
// companions), where it used to draw them as ordinary data while "Export
// page…" left them out. `fetchPlot` is mocked to its offline column packing so
// the rows are the dataset's own.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SpatialPanel } from "../../lib/multipanel";
import type { Dataset } from "../../lib/types";
import { fetchSpatialPanel } from "./spatialPanelFetch";

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
