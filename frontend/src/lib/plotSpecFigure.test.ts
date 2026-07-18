import { describe, expect, it, vi } from "vitest";

import { plotSpecFigureReason, plotSpecToFigureDoc } from "./plotSpecFigure";
import type { PlotSpec } from "./plotspec";

vi.spyOn(Date, "now").mockReturnValue(1234);

const xy = (over: Partial<PlotSpec> = {}): PlotSpec => ({
  version: 1,
  zones: {
    x: { datasetId: "d1", channel: 0 },
    y: [{ datasetId: "d1", channel: 2 }, { datasetId: "d1", channel: 1 }],
    group: null,
    facet: null,
  },
  mark: "line",
  ...over,
});

describe("plotSpecToFigureDoc", () => {
  it("preserves explicit X/Y display order in an ephemeral live FigureDoc", () => {
    const doc = plotSpecToFigureDoc(xy(), "My graph", { 2: { width: 3 } });
    expect(doc).toMatchObject({
      id: "plotspec-ya",
      name: "My graph",
      datasetId: "d1",
      live: true,
      config: { xKey: 0, yKeys: [2, 1], fmt: "pdf", style: "default" },
    });
    expect(doc?.config.seriesStyles?.[0]).toMatchObject({ width: 3 });
  });

  it("maps scatter to an honest point-only publication style", () => {
    const doc = plotSpecToFigureDoc(xy({ mark: "scatter" }), "", {});
    expect(doc?.config.seriesStyles).toEqual([
      { color: expect.any(String), line: "none", marker: true },
      { color: expect.any(String), line: "none", marker: true },
    ]);
  });

  it("fails closed for grouped, faceted, statistical, incomplete, or cross-dataset specs", () => {
    const grouped = xy({ zones: { ...xy().zones, group: { datasetId: "d1", channel: 3 } } });
    const faceted = xy({ zones: { ...xy().zones, facet: { datasetId: "d1", channel: 3 } } });
    const statistical = xy({ mark: "box" });
    const incomplete = xy({ zones: { ...xy().zones, y: [] } });
    const mixed = xy({ zones: { ...xy().zones, y: [{ datasetId: "d2", channel: 1 }] } });
    for (const spec of [grouped, faceted, statistical, incomplete, mixed]) {
      expect(plotSpecToFigureDoc(spec, "bad", {})).toBeNull();
      expect(plotSpecFigureReason(spec)).not.toBeNull();
    }
  });
});
