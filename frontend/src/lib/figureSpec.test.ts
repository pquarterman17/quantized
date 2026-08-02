import { describe, expect, it } from "vitest";

import { buildFigureSpec, buildFigureSpecFromDocument, resolveFigureDocumentData } from "./figureSpec";
import { createFigureDocument, figureDocumentToPlotView, updateFigureDocumentFromPlotView } from "./figureDocument";
import { defaultPlotView } from "./plotview";
import type { Dataset, DataStruct } from "./types";

const data: DataStruct = {
  time: [0, 1, 2],
  values: [
    [10, 100, 1, 2, 0.1, 0.01],
    [20, 200, 3, 4, 0.2, 0.02],
    [30, 300, 5, 6, 0.3, 0.03],
  ],
  labels: ["group", "signal", "right", "plus", "minus", "x error"],
  units: ["", "V", "A", "V", "V", "s"],
  metadata: {},
};

const dataset: Dataset = {
  id: "dataset-1",
  name: "device.csv",
  data,
  channelRoles: { 5: "ignore" },
};

function richView() {
  return {
    ...defaultPlotView(),
    xKey: null,
    yKeys: [1, 2],
    y2Keys: [2],
    y2Scale: "log" as const,
    y2Fmt: { mode: "sci" as const, digits: 3 },
    y2Step: 2,
    y2AxisLabel: "Right axis",
    xScale: "log" as const,
    yScale: "reciprocal" as const,
    xFmt: { mode: "fixed" as const, digits: 1 },
    yFmt: { mode: "eng" as const, digits: 2 },
    xStep: 0.5,
    yStep: 4,
    plotTitle: "Canonical export",
    xAxisLabel: "Time (s)",
    yAxisLabel: "Response",
    seriesOrder: [2, 1],
    seriesLabels: { 1: "left trace" },
    seriesStyles: { 1: { color: "#123456", width: 3, marker: true, markerSize: 7 } },
    showLegend: true,
    legendXY: [0.2, 0.8] as [number, number],
    legendTitle: "Signals",
    showGrid: true,
    showAxisBox: true,
    xLim: [0.1, 10] as [number, number],
    yLim: [1, 9] as [number, number],
    y2Lim: [2, 20] as [number, number],
    annotations: [{ id: "a", x: 1, y: 2, text: "peak", size: 14, frame: { pad: 3 } }],
    shapes: [{ id: "s", kind: "rect" as const, x1: 0, y1: 1, x2: 2, y2: 3, stroke: "#f00" }],
    pageSetup: {
      width: 10,
      height: 5,
      unit: "cm" as const,
      margins: { left: 1, right: 2, top: 0.5, bottom: 1.5 },
      aspectDerived: false,
    },
  };
}

describe("FigureDocument FigureSpec adapter", () => {
  it("preserves an explicitly bound Y channel that is also the X channel", () => {
    const document = createFigureDocument({
      id: "same-x-y",
      name: "Resistance against itself and voltage",
      datasetId: dataset.id,
      view: { ...defaultPlotView(), xKey: 0, yKeys: [0, 1] },
      publication: {
        overrides: null,
        seriesStyles: [{ color: "#3366cc" }, { color: "#cc6633" }],
      },
    });

    const spec = buildFigureSpecFromDocument(document, dataset, "same-x-y");

    expect(spec.x_key).toBe(0);
    expect(spec.y_keys).toEqual([0, 1]);
    expect(spec.series_styles).toEqual([{ color: "#3366cc" }, { color: "#cc6633" }]);
  });

  it("keeps the established StoreGet FigureSpec wire shape byte/deep-equal", () => {
    const view = richView();
    const get = (() => view) as never;
    const opts = { fmt: "svg", style: "thesis", dpi: 600, title: "Override", xLabel: "X", yLabel: "Y" };

    const spec = buildFigureSpec(get, dataset, "device", opts);

    const expected = {
      dataset: { ...data, labels: ["group", "left trace", "right", "plus", "minus", "x error"] },
      x_key: undefined,
      y_keys: [2, 1],
      x_scale: "log",
      y_scale: "reciprocal",
      x_fmt: { mode: "fixed", digits: 1 },
      y_fmt: { mode: "eng", digits: 2 },
      x_step: 0.5,
      y_step: 4,
      y2_keys: [2],
      y2_label: "Right axis",
      y2_scale: "log",
      y2_fmt: { mode: "sci", digits: 3 },
      y2_step: 2,
      fmt: "svg",
      style: "thesis",
      dpi: 600,
      width_in: 10 / 2.54,
      height_in: 5 / 2.54,
      title: "Override",
      x_label: "X",
      y_label: "Y",
      series_styles: [
        { color: "#8b5cf6" },
        { color: "#123456", width: 3, marker: true, marker_size: 7 },
      ],
      overrides: {
        legend: { show: true, loc: "custom", anchor: [0.2, 0.8], title: "Signals" },
        annotations: [{ x: 1, y: 2, text: "peak", size: 14, frame: { pad: 3 } }],
        shapes: [{ kind: "rect", x1: 0, y1: 1, x2: 2, y2: 3, stroke: "#f00" }],
        x_lim: [0.1, 10],
        y_lim: [1, 9],
        grid: true,
        spines: { top: true, right: true },
        margins: { left: 0.1, right: 0.2, top: 0.1, bottom: 0.3 },
        y2_lim: [2, 20],
        ticks: { minor: true },
      },
      filename: "device",
    };
    expect(spec).toEqual(expected);
    expect(JSON.stringify(spec)).toBe(JSON.stringify(expected));
  });

  it("exports canonical bindings, rich display state, page setup, output defaults, and x breaks", () => {
    const document = createFigureDocument({
      id: "figure-1",
      name: "Device figure",
      datasetId: dataset.id,
      view: richView(),
      axisBreaks: { x: [[0.4, 0.6]], y: [[3, 4]], y2: [[5, 6]] },
      errors: [
        { target: 1, channel: 3, axis: "y", side: "+" },
        { target: 1, channel: 4, axis: "y", side: "-" },
        { target: -1, channel: 5, axis: "x", side: "both" },
      ],
      output: { format: "png", stylePreset: "nature", dpi: 450, transparent: true, filename: "saved-device" },
    });
    const documentBefore = structuredClone(document);
    const datasetBefore = structuredClone(dataset);

    const spec = buildFigureSpecFromDocument(document, dataset, "fallback");

    expect(spec).toMatchObject({
      x_key: undefined,
      y_keys: [2, 1],
      y2_keys: [2],
      y2_scale: "log",
      y2_fmt: { mode: "sci", digits: 3 },
      x_fmt: { mode: "fixed", digits: 1 },
      y_fmt: { mode: "eng", digits: 2 },
      fmt: "png",
      style: "nature",
      dpi: 450,
      transparent: true,
      filename: "saved-device",
      width_in: 10 / 2.54,
      height_in: 5 / 2.54,
      series_styles: [
        { color: "#8b5cf6" },
        { color: "#123456", width: 3, marker: true, marker_size: 7 },
      ],
    });
    expect(spec.error_spans).toEqual([
      { x: { plus: [0.01, 0.02, 0.03], minus: [0.01, 0.02, 0.03] } },
      {
        x: { plus: [0.01, 0.02, 0.03], minus: [0.01, 0.02, 0.03] },
        y: { plus: [2, 4, 6], minus: [0.1, 0.2, 0.3] },
      },
    ]);
    expect(spec.overrides).toMatchObject({
      legend: { show: true, loc: "custom", anchor: [0.2, 0.8], title: "Signals" },
      annotations: [{ text: "peak", frame: { pad: 3 } }],
      shapes: [{ kind: "rect", stroke: "#f00" }],
      x_breaks: [[0.4, 0.6]],
      margins: { left: 0.1, right: 0.2, top: 0.1, bottom: 0.3 },
    });

    expect(buildFigureSpecFromDocument(document, dataset, "fallback", {
      fmt: "svg", dpi: 72, transparent: false, filename: null,
    })).toMatchObject({ fmt: "svg", dpi: 72, transparent: false, filename: "fallback" });
    expect(document).toEqual(documentBefore);
    expect(dataset).toEqual(datasetBefore);
  });

  it("keeps canonical-only rich errors, mark/facet, breaks, and output across the PlotView facade round trip", () => {
    const document = createFigureDocument({
      id: "round-trip",
      name: "Round trip",
      datasetId: dataset.id,
      view: { ...defaultPlotView(), errKeys: { 1: 3 } },
      mark: "scatter",
      facetKey: 2,
      errors: [{ target: -1, channel: 5, axis: "x", side: "both" }, { target: 1, channel: 4, axis: "y", side: "+" }],
      axisBreaks: { x: [[1, 2]], y: [[3, 4]], y2: [[5, 6]] },
      output: { format: "tiff", dpi: 900, transparent: true, filename: "canonical" },
      publication: {
        overrides: { font_name: "Helvetica", margins: { left: 0.1 }, ticks: { dir: "in" } },
        seriesStyles: [{ color: "#111111", line: "none", marker: true }],
      },
    });

    const restored = updateFigureDocumentFromPlotView(document, { view: figureDocumentToPlotView(document) });

    expect(restored.bindings.errors).toEqual(document.bindings.errors);
    expect(restored.bindings.facetKey).toBe(2);
    expect(restored.plot.mark).toBe("scatter");
    expect(restored.plot.axisBreaks).toEqual(document.plot.axisBreaks);
    expect(restored.output).toEqual(document.output);
    expect(restored.publication).toEqual(document.publication);
  });

  it("merges publication overrides by explicit nested field and honors absent/null/exact series styles", () => {
    const base = {
      id: "publication", name: "Publication", datasetId: dataset.id,
      view: { ...richView(), yKeys: [1], y2Keys: [], y2Scale: null, y2Fmt: null, y2Step: null, y2AxisLabel: "" },
    };
    const absent = createFigureDocument(base);
    expect(buildFigureSpecFromDocument(absent, dataset, "absent").series_styles).toHaveLength(1);

    const nullStyles = createFigureDocument({ ...base, publication: { overrides: null, seriesStyles: null } });
    expect(buildFigureSpecFromDocument(nullStyles, dataset, "null")).not.toHaveProperty("series_styles");

    const exactStyles = [{ color: "#fedcba", line: "none" as const, marker: true, marker_size: 9 }];
    const publication = createFigureDocument({
      ...base,
      publication: {
        overrides: { font_size: 11, legend: { title: "Publication legend" }, margins: { left: 0.33 }, ticks: { dir: "in" } },
        seriesStyles: exactStyles,
      },
    });
    const spec = buildFigureSpecFromDocument(publication, dataset, "publication");
    expect(spec.overrides).toMatchObject({
      font_size: 11,
      legend: { show: true, loc: "custom", anchor: [0.2, 0.8], title: "Publication legend" },
      margins: { left: 0.33, right: 0.2, top: 0.1, bottom: 0.3 },
      ticks: { dir: "in", minor: true },
    });
    expect(spec.series_styles).toEqual(exactStyles);
    expect(spec.series_styles).not.toBe(exactStyles);
  });

  it("rejects a mismatched live dataset and resolves frozen documents from their snapshot", () => {
    const live = createFigureDocument({ id: "live", name: "Live", datasetId: dataset.id, view: richView() });
    expect(() => buildFigureSpecFromDocument(live, { ...dataset, id: "other" }, "bad")).toThrow('bound to dataset "dataset-1"');
    expect(() => buildFigureSpecFromDocument(live, undefined, "missing")).toThrow('requires dataset "dataset-1"');

    const frozen = createFigureDocument({
      id: "frozen",
      name: "Frozen",
      datasetId: null,
      view: { ...defaultPlotView(), yKeys: [1] },
      data: { mode: "frozen", snapshot: data },
    });
    const resolved = resolveFigureDocumentData(frozen);
    expect(resolved.data).toEqual(data);
    expect(resolved.data).not.toBe(data);
    expect(buildFigureSpecFromDocument(frozen, undefined, "frozen").dataset).toEqual(data);
  });

  it("exports grouping without y2 and rejects the backend-invalid grouped+y2 combination", () => {
    const grouped = createFigureDocument({
      id: "grouped",
      name: "Grouped",
      datasetId: dataset.id,
      view: { ...richView(), y2Keys: [], y2Scale: null, y2Fmt: null, y2Step: null, y2AxisLabel: "" },
      groupKey: 0,
    });
    expect(buildFigureSpecFromDocument(grouped, dataset, "grouped").group_col).toBe(0);

    const invalid = createFigureDocument({
      id: "invalid",
      name: "Grouped y2",
      datasetId: dataset.id,
      view: richView(),
      groupKey: 0,
    });
    expect(() => buildFigureSpecFromDocument(invalid, dataset, "invalid"))
      .toThrow("grouped figures cannot use a secondary Y axis");
  });
});
