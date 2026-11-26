// Line polish (plan item 17): persistence, validation, the draw order on the
// canvas, and the Inspector row. The shared screen == export fixture is
// `lineStyleFixture.test.ts`.

import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import type uPlot from "uplot";
import { beforeAll, describe, expect, it, vi } from "vitest";

import SeriesLineStyleControls from "../components/Inspector/SeriesLineStyleControls";
import { buildExportStyles } from "./exportStyles";
import { createFigureDocument } from "./figureDocument";
import { portableStyle, seriesStyleFromExport } from "./graphFormat";
import { lineStrokes } from "./lineStyleGeometry";
import { cleanLineStyle, lineStyleSpec } from "./lineStyleSanitize";
import { loadMarks, usesMarks } from "./marksLoader";
import type { PlotPayload } from "./plotdata";
import { defaultPlotView } from "./plotview";
import { sanitizeExportSeriesStyles } from "./publicationStyles";
import type { Dataset, SeriesStyle } from "./types";
import { lineFrontPlugin } from "./uplotLineStyle";
import { buildSeriesDefs } from "./uplotSeries";
import { parseWorkspace, serializeWorkspace } from "./workspace";

const DS: Dataset = { id: "d1", name: "d", data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} } };
const COLORS = { accentColor: "#00f", inkColor: "#eef0f6", inkDimColor: "#888", isDarkBg: true };
const PAYLOAD: PlotPayload = { data: [[0, 1, 2], [1, 2, 3]], series: [{ label: "y", unit: "" }], xLabel: "x", xUnit: "" };
const STYLE: SeriesStyle = { marker: true, symbolGap: 3, lineFront: true, doubleLine: 2 };

beforeAll(() => loadMarks());

function reopen(view = { ...defaultPlotView(), seriesStyles: { 0: STYLE } }) {
  const document = createFigureDocument({ id: "w1", name: "W", datasetId: "d1", view });
  const win = { id: "w1", kind: "plot", title: "W", datasetId: "d1", geometry: { x: 0, y: 0, w: 1, h: 1 }, z: 1, winState: "normal", view, document, bg: "theme", linkGroup: null, pinned: false } as const;
  const text = serializeWorkspace({ datasets: [DS], plotWindows: [win as never] });
  return { text, back: parseWorkspace(text, { width: 800, height: 600 }).plotWindows[0] };
}

describe("persistence", () => {
  it("a style with the options survives save and reopen, in the view and the document", () => {
    const { back } = reopen();
    expect(back.view.seriesStyles[0]).toEqual(STYLE);
    expect(back.kind === "plot" && back.document?.plot.view.seriesStyles[0]).toEqual(STYLE);
  });

  it("a project saved without them opens unchanged, and the file gains no key", () => {
    const old: SeriesStyle = { marker: true, markerSize: 6, color: "#3366cc" };
    const { text, back } = reopen({ ...defaultPlotView(), seriesStyles: { 0: old } });
    expect(back.view.seriesStyles[0]).toEqual(old);
    expect(text).not.toMatch(/symbolGap|lineFront|doubleLine/);
  });

  it("invalid values from a file, template or publication style are dropped", () => {
    const bad = { marker: true, symbolGap: -2, doubleLine: 500, lineFront: "yes" } as unknown as SeriesStyle;
    expect(back0(bad)).toEqual({ marker: true });
    expect(cleanLineStyle(bad)).toEqual({ marker: true });
    expect(portableStyle(bad)).toEqual({ marker: true });
    expect(seriesStyleFromExport({ symbol_gap: "3" as never, double_line: 0, line_front: 1 as never })).toBeNull();
    expect(sanitizeExportSeriesStyles([{ symbol_gap: 3, double_line: 99, line_front: true }])).toEqual([{ symbol_gap: 3, line_front: true }]);
    expect(seriesStyleFromExport({ symbol_gap: 3, double_line: 2, line_front: true })).toEqual({ symbolGap: 3, doubleLine: 2, lineFront: true });
  });

  it("a series the options do not apply to sends and keeps nothing on the wire", () => {
    expect(lineStyleSpec({ ...STYLE, bars: true })).toBeNull();
    expect(lineStyleSpec({ ...STYLE, connect: "spline" })).toBeNull();
    expect(buildExportStyles([0], { 0: { ...STYLE, step: "mid" } })[0]).not.toHaveProperty("symbol_gap");
    expect(buildExportStyles([0], { 0: STYLE })[0]).toMatchObject({ symbol_gap: 3, line_front: true, double_line: 2 });
  });
});

function back0(style: SeriesStyle) {
  return reopen({ ...defaultPlotView(), seriesStyles: { 0: style } }).back.view.seriesStyles[0];
}

describe("canvas order and paths", () => {
  it("the options wait for the marks chunk like the other marks", () => {
    expect(usesMarks({ symbolGap: 2 })).toBe(true);
    expect(usesMarks({ lineFront: true })).toBe(true);
    expect(usesMarks({ doubleLine: 2 })).toBe(true);
    expect(usesMarks({ marker: true })).toBe(false);
  });

  it("a line behind the symbols (the default) keeps its stroke in the path; in front it moves to the hook", () => {
    const stub = {
      data: PAYLOAD.data, bbox: { left: 0, top: 0, width: 100, height: 100 },
      valToPos: (v: number) => v * 20, series: [{ sorted: 1 }, { scale: "y", points: { show: true, size: 4 } }],
    };
    const at = (style: SeriesStyle) => {
      const { series } = buildSeriesDefs(PAYLOAD, { seriesStyles: [style] }, ["y"], true, COLORS);
      return series[1];
    };
    const moves = (style: SeriesStyle) => {
      const calls: string[] = [];
      vi.stubGlobal("Path2D", class { moveTo() { calls.push("m"); } lineTo() { calls.push("l"); } addPath() {} });
      try { at(style).paths!(stub as unknown as uPlot, 1, 0, 2); } finally { vi.unstubAllGlobals(); }
      return calls;
    };
    expect(moves({ marker: true, symbolGap: 2 }).length).toBeGreaterThan(0);
    expect(moves({ marker: true, symbolGap: 2, lineFront: true })).toEqual([]);
    expect((at({ marker: true, lineFront: true }) as { qzLine?: { front: boolean } }).qzLine?.front).toBe(true);
    expect((at({ marker: true }) as { qzLine?: unknown }).qzLine).toBeUndefined();
  });

  it("the front hook repaints only series that asked for it, after the points", () => {
    const strokes: unknown[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => (k === "stroke" ? (p: unknown) => strokes.push(p) : k in t ? t[k as string] : () => undefined),
      set: (t, k, v) => { t[k as string] = v; return true; },
    });
    vi.stubGlobal("Path2D", class { moveTo() {} lineTo() {} });
    try {
      const hook = lineFrontPlugin().hooks!.drawSeries as (u: uPlot, i: number) => void;
      const mk = (qzLine?: object) => ({
        ctx, data: PAYLOAD.data, bbox: { left: 0, top: 0, width: 100, height: 100 }, valToPos: (v: number) => v * 20,
        valToIdx: (v: number) => Math.round(v), scales: { x: { min: 0, max: 2 } },
        series: [{ sorted: 1 }, { scale: "y", show: true, width: 1, stroke: () => "#f00", points: { show: true, size: 4 }, qzLine }],
      }) as unknown as uPlot;
      hook(mk(), 1);
      hook(mk({ gap: 0, sep: 0, front: false }), 1);
      expect(strokes).toHaveLength(0);
      hook(mk({ gap: 0, sep: 0, front: true }), 1);
      expect(strokes).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a gap never changes the data: the kernel only reads it", () => {
    const xs = [0, 20, 40];
    const ys = [0, 0, 0];
    lineStrokes(xs, ys, () => true, 3, 2, 2);
    expect([xs, ys]).toEqual([[0, 20, 40], [0, 0, 0]]);
  });
});

describe("Inspector row", () => {
  it("writes the gap, the double separation and the order; clearing removes the key", () => {
    const set = vi.fn();
    render(createElement(SeriesLineStyleControls, { channel: 2, style: { marker: true, symbolGap: 3 }, setSeriesStyle: set, markers: true }));
    fireEvent.change(screen.getByLabelText("Gap between line and symbol"), { target: { value: "" } });
    expect(set).toHaveBeenLastCalledWith(2, { symbolGap: undefined });
    fireEvent.change(screen.getByLabelText("Double line separation"), { target: { value: "2.5" } });
    expect(set).toHaveBeenLastCalledWith(2, { doubleLine: 2.5 }, "doubleLine:2");
    fireEvent.change(screen.getByLabelText("Double line separation"), { target: { value: "-1" } });
    expect(set).toHaveBeenCalledTimes(2); // invalid: ignored
    fireEvent.click(screen.getByRole("radio", { name: "Line in front of the symbols" }));
    expect(set).toHaveBeenLastCalledWith(2, { lineFront: true });
  });

  it("shows no gap or order without symbols, and nothing for a bar or a hidden line", () => {
    const { rerender, container } = render(createElement(SeriesLineStyleControls, { channel: 0, style: {}, setSeriesStyle: () => {}, markers: false }));
    expect(screen.queryByLabelText("Gap between line and symbol")).toBeNull();
    expect(screen.getByLabelText("Double line separation")).toBeTruthy();
    rerender(createElement(SeriesLineStyleControls, { channel: 0, style: { bars: true }, setSeriesStyle: () => {}, markers: true }));
    expect(container.textContent).toBe("");
    rerender(createElement(SeriesLineStyleControls, { channel: 0, style: { width: 0, marker: true }, setSeriesStyle: () => {}, markers: true }));
    expect(container.textContent).toBe("");
  });
});
