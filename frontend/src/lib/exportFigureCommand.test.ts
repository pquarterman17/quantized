// lib/exportFigureCommand's liveViewOverrides — the MAIN #18 export-parity
// piece: annotations (with `size`) + legend screen position, mapped into the
// FigureOverrides shape calc.figure_overrides expects. Also covers
// runExportFigureCommand's MAIN #24 x_fmt/y_fmt wiring (the request builder
// under test.plan's "extend exportFigureCommand tests").

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  legendTitle?: string | null;
  annotations?: Annotation[];
  shapes?: Shape[];
}) {
  const state = {
    showLegend: over.showLegend ?? true,
    legendPos: over.legendPos ?? "ne",
    legendXY: over.legendXY ?? null,
    legendTitle: over.legendTitle ?? null,
    annotations: over.annotations ?? [],
    shapes: over.shapes ?? [],
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
          data: { time: [0, 1], values: [[1], [2]], labels: ["A"], units: ["u"], metadata: {} },
        },
      ],
      activeId: "d1",
      yKeys: null,
      xScale: "linear",
      yScale: "linear",
      xFmt: { mode: "auto", digits: 2 },
      yFmt: { mode: "auto", digits: 2 },
      xStep: null,
      yStep: null,
      seriesStyles: {},
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
});
