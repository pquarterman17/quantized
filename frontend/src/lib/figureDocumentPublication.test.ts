import { describe, expect, it } from "vitest";

import { figureDocumentFromLegacyFigureDoc } from "./figureDocumentPublication";
import type { FigureDoc } from "./figuredoc";
import type { DataStruct } from "./types";

const snapshot: DataStruct = {
  time: [0, 1], values: [[1], [2]], labels: ["signal"], units: ["V"], metadata: {},
};

const legacy = (overrides: Partial<FigureDoc> = {}): FigureDoc => ({
  id: "legacy-1",
  name: "Legacy preview",
  datasetId: "d1",
  live: true,
  config: {
    xKey: 0, yKeys: [1], groupCol: 2, xScale: "log", yScale: "linear",
    title: "Legacy title", xLabel: "X", yLabel: "Y", style: "nature", fmt: "svg", dpi: 600,
    overrides: {
      font_name: "Helvetica", font_size: 9, ticks: { dir: "in", len: 5 }, margins: { left: 0.12 },
      annotations: [{ x: 1, y: 2, text: "note" }],
    },
    seriesStyles: [{ color: "#123456", line: "none", marker: true, marker_size: 5 }],
  },
  ...overrides,
});

describe("legacy Publication Preview -> FigureDocument adapter", () => {
  it("converts a live document losslessly without mutating its legacy source", () => {
    const source = legacy();
    const before = structuredClone(source);
    const document = figureDocumentFromLegacyFigureDoc(source);

    expect(document).toMatchObject({
      version: 2, id: "legacy-1", name: "Legacy preview",
      bindings: { datasetId: "d1", xKey: 0, yKeys: [1], groupKey: 2 },
      data: { mode: "live" },
      plot: { view: { xScale: "log", plotTitle: "Legacy title", xAxisLabel: "X", yAxisLabel: "Y" } },
      output: { stylePreset: "nature", format: "svg", dpi: 600 },
      publication: { overrides: source.config.overrides, seriesStyles: source.config.seriesStyles },
    });
    document.publication!.overrides!.margins!.left = 0.8;
    expect(source).toEqual(before);
  });

  it("retains frozen data and rejects an invalid frozen legacy source clearly", () => {
    const frozen = figureDocumentFromLegacyFigureDoc(legacy({ live: false, datasetId: "stale-id", dataSnapshot: snapshot }));
    expect(frozen.data).toEqual({ mode: "frozen", snapshot });
    expect(frozen.bindings.datasetId).toBeNull();
    expect(() => figureDocumentFromLegacyFigureDoc(legacy({ live: false, dataSnapshot: undefined })))
      .toThrow('frozen legacy FigureDoc "legacy-1" has no data snapshot');
  });
});
