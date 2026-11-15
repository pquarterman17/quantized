// Gap audit 4 lane A review fixes for the symbol details and the error band,
// each pinned against a fix seen to fail without it:
//   L4  a colour-mapped (or chunk-pending) series keeps its band, not bars;
//   L5  invalid `markerEvery` / `markerAlpha` read from a file are dropped, on
//       the canvas and on the wire alike;
//   L9  the legend swatch's symbol colours get the canvas' contrast check, and
//       an unset colour well shows the series colour.

import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { beforeAll, describe, expect, it } from "vitest";

import SeriesSymbolErrorControls from "../components/Inspector/SeriesSymbolErrorControls";
import { legendRowStyle } from "../components/Stage/legendRowStyle";
import { buildExportStyles } from "./exportStyles";
import { portableStyle, seriesStyleFromExport } from "./graphFormat";
import { loadMarks } from "./marksLoader";
import { seriesPoints } from "./markers";
import type { PlotPayload } from "./plotdata";
import { createFigureDocument } from "./figureDocument";
import { defaultPlotView } from "./plotview";
import type { Dataset } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";
import { symbolPoints } from "./symbolDetails";
import { buildSeriesDefs } from "./uplotSeries";

const DS: Dataset = { id: "d1", name: "d", data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} } };
const COLORS = { accentColor: "#00f", inkColor: "#eef0f6", inkDimColor: "#888", isDarkBg: true };
const PAYLOAD: PlotPayload = { data: [[0, 1, 2], [1, 2, 3]], series: [{ label: "y", unit: "" }], xLabel: "x", xUnit: "" };

beforeAll(() => loadMarks());

describe("L4: a colour-mapped series keeps its band", () => {
  it("the hidden native series still carries the band paint the error plugins read", () => {
    const colorByColumns = new Map([[1, { channel: 2, z: [0, 1, 2], colormap: "viridis" as const, lo: 0, hi: 2 }]]);
    const { series } = buildSeriesDefs(PAYLOAD, { seriesStyles: [{ colorBy: 2, errorBar: { band: true } }], colorByColumns }, ["y"], true, COLORS);
    expect((series[1] as { qzErr?: { band?: boolean } }).qzErr?.band).toBe(true);
  });
});

describe("L5: symbol values from a file are validated", () => {
  const bad = { marker: true, markerEvery: 2.5, markerAlpha: -0.5 };

  it("a .dwk drops them, from a window's view and from its document", () => {
    const view = { ...defaultPlotView(), seriesStyles: { 0: bad, 1: { markerEvery: 4, markerAlpha: 0.3 } } };
    const document = createFigureDocument({ id: "w1", name: "W", datasetId: "d1", view });
    const win = { id: "w1", kind: "plot", title: "W", datasetId: "d1", geometry: { x: 0, y: 0, w: 1, h: 1 }, z: 1, winState: "normal", view, document, bg: "theme", linkGroup: null, pinned: false } as const;
    const back = parseWorkspace(serializeWorkspace({ datasets: [DS], plotWindows: [win as never] }), { width: 800, height: 600 }).plotWindows[0];
    expect(back.view.seriesStyles[0]).toEqual({ marker: true });
    expect(back.view.seriesStyles[1]).toEqual({ markerEvery: 4, markerAlpha: 0.3 });
    expect(back.kind === "plot" && back.document?.plot.view.seriesStyles[0]).toEqual({ marker: true });
  });

  it("a template and a saved publication style drop them", () => {
    expect(portableStyle(bad)).toEqual({ marker: true });
    expect(seriesStyleFromExport({ marker_every: "3" as never, marker_alpha: 5 })).toBeNull();
  });

  it("the canvas and the wire ignore them alike", () => {
    const pts = symbolPoints(seriesPoints(bad, "Line", "#f00"), bad, "#f00", (c) => c);
    expect(pts.filter).toBeUndefined();
    expect(pts.fill).toBeUndefined();
    expect(buildExportStyles([0], { 0: bad })[0]).not.toHaveProperty("marker_every");
    expect(buildExportStyles([0], { 0: bad })[0]).not.toHaveProperty("marker_alpha");
  });
});

describe("L9: symbol colours in the legend and the Inspector", () => {
  it("a black symbol edge on the dark canvas is swapped for ink in the legend, as on the canvas", () => {
    const { sample } = legendRowStyle({ label: "y", unit: "" }, 0, [{ marker: true, markerEdge: "#000000", markerFillColor: "#ff8800" }], null, true, "#eef0f6");
    expect(sample?.markerEdge).toBe("#eef0f6");
    expect(sample?.markerFillColor).toBe("#ff8800");
  });

  it("an unset colour well shows the series colour", () => {
    render(createElement(SeriesSymbolErrorControls, {
      channel: 0, style: { marker: true, color: "#3366cc" }, setSeriesStyle: () => {}, markers: true, errors: true,
    }));
    expect((screen.getByLabelText("Symbol edge color") as HTMLInputElement).value).toBe("#3366cc");
    expect((screen.getByLabelText("Error bar color") as HTMLInputElement).value).toBe("#3366cc");
  });
});
