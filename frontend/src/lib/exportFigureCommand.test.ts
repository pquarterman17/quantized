// lib/exportFigureCommand's liveViewOverrides — the MAIN #18 export-parity
// piece: annotations (with `size`) + legend screen position, mapped into the
// FigureOverrides shape calc.figure_overrides expects. Also covers
// runExportFigureCommand's MAIN #24 x_fmt/y_fmt wiring (the request builder
// under test.plan's "extend exportFigureCommand tests").

import { beforeEach, describe, expect, it, vi } from "vitest";

import { askParams } from "../components/overlays/ParamDialog";
import { exportFigure } from "./api";
import { liveViewOverrides, runExportFigureCommand } from "./exportFigureCommand";
import type { Annotation, Shape } from "./types";
import { useApp } from "../store/useApp";

vi.mock("./api", () => ({
  exportFigure: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../components/overlays/ParamDialog", () => ({
  askParams: vi.fn().mockResolvedValue({
    fmt: "pdf",
    style: "default",
    dpi: 300,
    title: "",
    x_label: "",
    y_label: "",
  }),
}));

function fakeGet(over: {
  showLegend?: boolean;
  legendPos?: "ne" | "nw" | "se" | "sw";
  legendXY?: [number, number] | null;
  legendFrameXY?: [number, number] | null;
  legendTitle?: string | null;
  annotations?: Annotation[];
  shapes?: Shape[];
  xLim?: [number, number] | null;
  yLim?: [number, number] | null;
  showGrid?: boolean;
  showAxisBox?: boolean;
  xScale?: "linear" | "log" | "reciprocal";
  yScale?: "linear" | "log" | "reciprocal";
}) {
  const state = {
    showLegend: over.showLegend ?? true,
    legendPos: over.legendPos ?? "ne",
    legendXY: over.legendXY ?? null,
    legendFrameXY: over.legendFrameXY ?? null,
    legendTitle: over.legendTitle ?? null,
    annotations: over.annotations ?? [],
    shapes: over.shapes ?? [],
    xLim: over.xLim,
    yLim: over.yLim,
    showGrid: over.showGrid,
    showAxisBox: over.showAxisBox,
    xScale: over.xScale,
    yScale: over.yScale,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (() => state) as any;
}

describe("liveViewOverrides", () => {
  it("maps a corner legendPos through legendPosToLoc when legendXY is unset", () => {
    const ov = liveViewOverrides(fakeGet({ legendPos: "sw" }));
    expect(ov?.legend).toEqual({ show: true, loc: "lower left" });
  });

  it("maps a free legendXY to loc:custom + anchor (MAIN #18)", () => {
    const ov = liveViewOverrides(fakeGet({ legendXY: [0.25, 0.75] }));
    expect(ov?.legend).toEqual({ show: true, loc: "custom", anchor: [0.25, 0.75] });
  });

  it("sends show:false when the screen legend is hidden, ignoring legendPos/legendXY", () => {
    const ov = liveViewOverrides(fakeGet({ showLegend: false, legendXY: [0.1, 0.1] }));
    expect(ov?.legend).toEqual({ show: false });
  });

  it("carries the legend title (decode #52) through, corner and free position", () => {
    const corner = liveViewOverrides(fakeGet({ legendTitle: "Nb/Au" }));
    expect(corner?.legend).toEqual({ show: true, loc: "upper right", title: "Nb/Au" });
    const free = liveViewOverrides(fakeGet({ legendTitle: "Nb/Au", legendXY: [0.2, 0.8] }));
    expect(free?.legend).toEqual({ show: true, loc: "custom", anchor: [0.2, 0.8], title: "Nb/Au" });
  });

  it("maps a frame anchor to loc:axes + anchor, winning over legendXY (decode #52)", () => {
    const framed = liveViewOverrides(fakeGet({ legendFrameXY: [0.1, 0.15] }));
    expect(framed?.legend).toEqual({ show: true, loc: "axes", anchor: [0.1, 0.15] });
    // Frame anchor beats a free container fraction AND carries the title.
    const both = liveViewOverrides(
      fakeGet({ legendFrameXY: [0.1, 0.15], legendXY: [0.2, 0.8], legendTitle: "Nb/Au" }),
    );
    expect(both?.legend).toEqual({ show: true, loc: "axes", anchor: [0.1, 0.15], title: "Nb/Au" });
  });

  it("carries each annotation's size override through, omitting it when unset", () => {
    const ov = liveViewOverrides(
      fakeGet({
        annotations: [
          { id: "a1", x: 1, y: 2, text: "Tc", size: 24 },
          { id: "a2", x: 3, y: 4, text: "Hc" },
        ],
      }),
    );
    expect(ov?.annotations).toEqual([
      { x: 1, y: 2, text: "Tc", size: 24 },
      { x: 3, y: 4, text: "Hc" },
    ]);
  });

  it("drops a non-finite annotation rather than sending garbage coords", () => {
    const ov = liveViewOverrides(
      fakeGet({ annotations: [{ id: "a1", x: Number.NaN, y: 2, text: "bad" }] }),
    );
    expect(ov?.annotations ?? []).toHaveLength(0);
  });

  it("carries a page-anchored annotation's anchor through, omitting it for a data-anchored one (MAIN #21)", () => {
    const ov = liveViewOverrides(
      fakeGet({
        annotations: [
          { id: "a1", x: 0.2, y: 0.8, text: "field", anchor: "page" },
          { id: "a2", x: 3, y: 4, text: "Hc" },
        ],
      }),
    );
    expect(ov?.annotations).toEqual([
      { x: 0.2, y: 0.8, text: "field", anchor: "page" },
      { x: 3, y: 4, text: "Hc" },
    ]);
  });

  it("omits annotations entirely (not an empty array) when there are none", () => {
    const ov = liveViewOverrides(fakeGet({}));
    expect(ov).not.toHaveProperty("annotations");
  });

  it("carries an annotation's frame (MAIN #27 text box) through unchanged", () => {
    const frame = { fill: "#fff", stroke: "#000", opacity: 0.5, pad: 4 };
    const ov = liveViewOverrides(
      fakeGet({ annotations: [{ id: "a1", x: 1, y: 2, text: "box", frame }] }),
    );
    expect(ov?.annotations).toEqual([{ x: 1, y: 2, text: "box", frame }]);
  });

  it("carries drawn shapes through, omitting unset style fields (MAIN #27)", () => {
    const ov = liveViewOverrides(
      fakeGet({
        shapes: [
          { id: "s1", kind: "arrow", x1: 1, y1: 2, x2: 3, y2: 4 },
          { id: "s2", kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1, anchor: "page", stroke: "#f00", opacity: 0.3 },
        ],
      }),
    );
    expect(ov?.shapes).toEqual([
      { kind: "arrow", x1: 1, y1: 2, x2: 3, y2: 4 },
      { kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1, anchor: "page", stroke: "#f00", opacity: 0.3 },
    ]);
  });

  it("drops a non-finite shape rather than sending garbage coords", () => {
    const ov = liveViewOverrides(
      fakeGet({ shapes: [{ id: "s1", kind: "line", x1: Number.NaN, y1: 0, x2: 1, y2: 1 }] }),
    );
    expect(ov?.shapes ?? []).toHaveLength(0);
  });

  it("omits shapes entirely (not an empty array) when there are none", () => {
    const ov = liveViewOverrides(fakeGet({}));
    expect(ov).not.toHaveProperty("shapes");
  });

  it("carries finite live limits, grid, box spines, and log minor ticks", () => {
    const ov = liveViewOverrides(
      fakeGet({
        xLim: [1, 9],
        yLim: [0.01, 100],
        showGrid: false,
        showAxisBox: true,
        xScale: "linear",
        yScale: "log",
      }),
    );
    expect(ov).toMatchObject({
      x_lim: [1, 9],
      y_lim: [0.01, 100],
      grid: false,
      spines: { top: true, right: true },
      ticks: { minor: true },
    });
  });

  it("drops a non-finite live limit instead of exporting an invalid range", () => {
    const ov = liveViewOverrides(fakeGet({ xLim: [0, Number.NaN] }));
    expect(ov).not.toHaveProperty("x_lim");
  });
});

describe("runExportFigureCommand — MAIN #24 x_fmt/y_fmt wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(exportFigure).mockResolvedValue(undefined);
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "scan.dat",
          data: {
            time: [0, 1],
            values: [[1, 10, 100], [2, 20, 200]],
            labels: ["A", "B", "C"],
            units: ["u", "v", "w"],
            metadata: {},
          },
        },
      ],
      activeId: "d1",
      xKey: null,
      yKeys: null,
      y2Keys: null,
      xScale: "linear",
      yScale: "linear",
      xFmt: { mode: "auto", digits: 2 },
      yFmt: { mode: "auto", digits: 2 },
      xStep: null,
      yStep: null,
      seriesStyles: {},
      seriesLabels: {},
      seriesOrder: null,
      hiddenChannels: [],
      xLim: null,
      yLim: null,
      showGrid: true,
      showAxisBox: false,
      plotTitle: "",
      xAxisLabel: "",
      yAxisLabel: "",
      status: "",
    });
  });

  it("omits x_fmt/y_fmt when both axes are auto", async () => {
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.x_fmt).toBeUndefined();
    expect(body.y_fmt).toBeUndefined();
  });

  it("sends the live x_fmt/y_fmt when non-auto", async () => {
    useApp.setState({
      xFmt: { mode: "fixed", digits: 3 },
      yFmt: { mode: "eng", digits: 0 },
    });
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.x_fmt).toEqual({ mode: "fixed", digits: 3 });
    expect(body.y_fmt).toEqual({ mode: "eng", digits: 0 });
  });

  it("sends saved major-tick increments for publication parity", async () => {
    useApp.setState({ xStep: 2000, yStep: 0.5 });
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.x_step).toBe(2000);
    expect(body.y_step).toBe(0.5);
  });

  it("exports the live x channel, visible draw order, and display-label overrides", async () => {
    useApp.setState({
      xKey: 1,
      yKeys: [0, 2],
      seriesOrder: [2, 0],
      hiddenChannels: [2],
      seriesLabels: { 0: "Measured signal" },
    });
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.x_key).toBe(1);
    expect(body.y_keys).toEqual([0]);
    expect(body.dataset.labels).toEqual(["Measured signal", "B", "C"]);
    // The imported workbook itself remains untouched.
    expect(useApp.getState().datasets[0].data.labels).toEqual(["A", "B", "C"]);
  });

  it("prefills the dialog from the live imported title and axis labels", async () => {
    useApp.setState({
      plotTitle: "Imported graph",
      xAxisLabel: "Q (nm^-1)",
      yAxisLabel: "Reflectivity",
    });
    await runExportFigureCommand(useApp.getState);
    const fields = vi.mocked(askParams).mock.calls[0][1];
    expect(fields.find((f) => f.key === "title")?.default).toBe("Imported graph");
    expect(fields.find((f) => f.key === "x_label")?.default).toBe("Q (nm^-1)");
    expect(fields.find((f) => f.key === "y_label")?.default).toBe("Reflectivity");
  });
});
