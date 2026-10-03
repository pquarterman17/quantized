import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigureBatch } from "./api/figureBatch";
import { batchFigureSpecs, downloadBatchFigures, MAX_BATCH_FIGURE_EXPORT } from "./batchFigureExport";
import { createFigureDocument } from "./figureDocument";
import { defaultPlotView } from "./plotview";
import type { Dataset } from "./types";

vi.mock("./api/figureBatch", () => ({
  exportFigureBatch: vi.fn(),
}));

const dataset = (id = "d1"): Dataset => ({
  id,
  name: `${id}.csv`,
  data: {
    time: [0, 1],
    values: [[1, 2]],
    labels: ["signal"],
    units: ["a.u."],
    metadata: {},
  },
});

const figure = createFigureDocument({
  id: "figure-1",
  name: "Sample A",
  datasetId: "d1",
  view: { ...defaultPlotView(), xKey: null, yKeys: [0] },
});

const options = {
  format: "svg" as const,
  style: "nature",
  dpi: 450,
  archiveName: "My figures",
};

beforeEach(() => {
  vi.mocked(exportFigureBatch).mockReset();
});

describe("batchFigureSpecs", () => {
  it("uses the canonical document exporter and applies one output preset", () => {
    const [spec] = batchFigureSpecs([figure], [dataset()], options);
    expect(spec).toMatchObject({
      fmt: "svg",
      style: "nature",
      dpi: 450,
      filename: "Sample A",
      y_keys: [0],
    });
  });

  it("refuses missing live data instead of exporting the wrong dataset", () => {
    expect(() => batchFigureSpecs([figure], [dataset("other")], options)).toThrow(
      'requires dataset "d1"',
    );
  });
});

describe("downloadBatchFigures", () => {
  it("sends one cancellable archive request", async () => {
    const controller = new AbortController();
    await downloadBatchFigures([figure], [dataset()], options, controller.signal);
    expect(exportFigureBatch).toHaveBeenCalledWith(
      [expect.objectContaining({ filename: "Sample A", fmt: "svg" })],
      "My figures",
      controller.signal,
    );
  });

  it("refuses an oversized archive before sending a request", async () => {
    const figures = Array.from({ length: MAX_BATCH_FIGURE_EXPORT + 1 }, (_, index) => ({
      ...figure,
      id: `figure-${index}`,
      name: `Figure ${index}`,
    }));
    await expect(downloadBatchFigures(figures, [dataset()], options)).rejects.toThrow(
      `at most ${MAX_BATCH_FIGURE_EXPORT}`,
    );
    expect(exportFigureBatch).not.toHaveBeenCalled();
  });
});
