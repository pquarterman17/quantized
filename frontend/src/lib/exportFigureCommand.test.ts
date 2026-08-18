// lib/exportFigureCommand's liveViewOverrides — the MAIN #18 export-parity
// piece: annotations (with `size`) + legend screen position, mapped into the
// FigureOverrides shape calc.figure_overrides expects. Also covers
// runExportFigureCommand's MAIN #24 x_fmt/y_fmt wiring (the request builder
// under test.plan's "extend exportFigureCommand tests").

import { beforeEach, describe, expect, it, vi } from "vitest";

import { askParams } from "../components/overlays/ParamDialog";
import { exportFigure } from "./api";
import { runExportFigureCommand } from "./exportFigureCommand";
import { createFigureDocument } from "./figureDocument";
import { liveViewOverrides } from "./figureSpec";
import { defaultPlotView, type PlotWindow } from "./plotview";
import type { Annotation, RefLine, RegionShade, Shape } from "./types";
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
  refLines?: RefLine[];
  regionShades?: RegionShade[];
  xLim?: [number, number] | null;
  yLim?: [number, number] | null;
  y2Lim?: [number, number] | null;
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
    refLines: over.refLines ?? [],
    regionShades: over.regionShades ?? [],
    xLim: over.xLim,
    yLim: over.yLim,
    y2Lim: over.y2Lim,
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

  it("carries a finite live y2Lim through as y2_lim", () => {
    const ov = liveViewOverrides(fakeGet({ y2Lim: [-1, 5] }));
    expect(ov).toMatchObject({ y2_lim: [-1, 5] });
  });

  it("drops a non-finite y2Lim instead of exporting an invalid range", () => {
    const ov = liveViewOverrides(fakeGet({ y2Lim: [0, Number.NaN] }));
    expect(ov).not.toHaveProperty("y2_lim");
  });

  it("omits y2_lim entirely when there is no live secondary-axis range", () => {
    const ov = liveViewOverrides(fakeGet({}));
    expect(ov).not.toHaveProperty("y2_lim");
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
      y2Fmt: null,
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

describe("runExportFigureCommand — y2 (secondary axis) export parity", () => {
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
      y2Lim: null,
      y2Scale: null,
      y2Step: null,
      y2AxisLabel: "",
      xScale: "linear",
      yScale: "linear",
      xFmt: { mode: "auto", digits: 2 },
      yFmt: { mode: "auto", digits: 2 },
      y2Fmt: null,
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

  it("omits every y2 field when y2Keys is null (today's single-axis behaviour, byte-identical request shape)", async () => {
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.y2_keys).toBeUndefined();
    expect(body.y2_label).toBeUndefined();
    expect(body.y2_scale).toBeUndefined();
    expect(body.y2_step).toBeUndefined();
  });

  it("splits y2Keys out of the FULL y_keys list, sending y_keys unchanged", async () => {
    useApp.setState({ y2Keys: [2] });
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    // y2_keys is a SUBSET marker, not a replacement — y_keys carries every
    // plotted channel exactly as a no-y2 request would (all 3 channels here).
    expect(body.y_keys).toEqual([0, 1, 2]);
    expect(body.y2_keys).toEqual([2]);
  });

  it("defaults y2_scale to the live primary yScale when y2Scale is unset", async () => {
    useApp.setState({ y2Keys: [1], y2Scale: null, yScale: "log" });
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.y2_scale).toBe("log");
  });

  it("prefers an explicit y2Scale over the primary yScale", async () => {
    useApp.setState({ y2Keys: [1], y2Scale: "reciprocal", yScale: "log" });
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.y2_scale).toBe("reciprocal");
  });

  it("sends the saved y2AxisLabel and y2Step", async () => {
    useApp.setState({ y2Keys: [1], y2AxisLabel: "Resistance (Ohm)", y2Step: 5 });
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.y2_label).toBe("Resistance (Ohm)");
    expect(body.y2_step).toBe(5);
  });

  it("a blank y2AxisLabel is omitted so the backend auto-derives, like x_label/y_label", async () => {
    useApp.setState({ y2Keys: [1], y2AxisLabel: "   " });
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.y2_label).toBeUndefined();
  });

  it("carries a live y2Lim through overrides.y2_lim", async () => {
    useApp.setState({ y2Keys: [1], y2Lim: [-5, 5] });
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.overrides?.y2_lim).toEqual([-5, 5]);
  });

  // GUI_INTERACTION #12 slice 4a — gateY2Overrides (lib/figureOverrides.ts):
  // a no-y2 request must never carry overrides.y2_lim, whether the stale
  // range is set-but-unplotted (covered by exportParity.test.ts's flipped
  // pin) or was simply never touched at all (this case).
  it("omits overrides.y2_lim when y2Lim was never set and no channel is plotted on y2", async () => {
    useApp.setState({ y2Keys: null, y2Lim: null });
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.overrides?.y2_lim).toBeUndefined();
  });

  // y2_fmt exists on the wire (lib/api.ts's FigureSpec, backend
  // routes/export_figures.py). store/useApp.ts's y2Fmt defaults to `null`
  // ("inherit yFmt" — the compatibility default, TickFormat.tsx's Y2 row);
  // runExportFigureCommand mirrors that same inherit fallback so export
  // matches whatever the screen is showing.
  it("threads the live yFmt through as y2_fmt when y2Fmt is unset (inherit) and a channel is plotted on y2", async () => {
    useApp.setState({ y2Keys: [1], yFmt: { mode: "sci", digits: 2 } });
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.y2_fmt).toEqual({ mode: "sci", digits: 2 });
  });

  it("sends the independently-set y2Fmt when it overrides the inherit default, even if yFmt differs", async () => {
    useApp.setState({ y2Keys: [1], yFmt: { mode: "sci", digits: 2 }, y2Fmt: { mode: "fixed", digits: 0 } });
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.y2_fmt).toEqual({ mode: "fixed", digits: 0 });
  });

  it("omits y2_fmt when the effective format (y2Fmt ?? yFmt) is auto, even with a y2 channel plotted", async () => {
    useApp.setState({ y2Keys: [1] }); // yFmt stays the beforeEach default (auto), y2Fmt inherits it
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.y2_fmt).toBeUndefined();
  });

  it("omits y2_fmt entirely when no channel is plotted on y2, regardless of yFmt/y2Fmt", async () => {
    useApp.setState({ y2Keys: null, yFmt: { mode: "fixed", digits: 1 } });
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.y2_fmt).toBeUndefined();
  });
});

// P0.4 finding 15 (2026-07-27): a ParamDialog render race could resolve
// askParams() with a PARTIAL params object — every key missing except the
// one field a fast interaction (a real user typing quickly, or scripted
// automation) had just edited. `runExportFigureCommand` used to do
// `(params.x_label as string).trim()` with no guard, which threw a
// TypeError on the missing key BEFORE exportActive's own try/catch could run
// — the rejection then propagated out of this function and was swallowed by
// store/commands.ts's runAction (`.catch(() => {})`), so the whole "Export
// figure…" command vanished silently: no exportFigure() call (hence zero
// network activity), no toast, no status change, no console error — the
// live SVG-dialog hang traced via tools/bench/export_envelope.mjs at 1M-row
// scale. The race itself is fixed at the source (ParamDialog.tsx now resets
// its local `values` synchronously during render, so it can no longer hand
// out a partial shape), but this test pins the OUTER contract directly by
// mocking askParams to return EXACTLY the malformed shape the live race
// produced — `{fmt: "svg"}`, nothing else — so a future regression here
// (in ParamDialog, or in any other askParams() caller with the same
// unguarded-access pattern) fails this test instead of silently vanishing
// in production. On the pre-fix code this `await` rejects instead of
// resolving (`exportFigure` is never called) — no timers or waiting needed,
// the mock resolves synchronously either way.
describe("runExportFigureCommand — P0.4 finding 15 (malformed/partial askParams result)", () => {
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
      y2Fmt: null,
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

  it("does not throw, and still exports, when askParams resolves with only the edited key set (missing dpi/title/labels/style)", async () => {
    vi.mocked(askParams).mockResolvedValueOnce({ fmt: "svg" });
    await expect(runExportFigureCommand(useApp.getState)).resolves.toBeUndefined();
    expect(exportFigure).toHaveBeenCalledTimes(1);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.fmt).toBe("svg");
    // Blank/absent labels mean "derive from the data" — must fall back to
    // undefined on the wire, never throw trying to read/trim a missing key.
    expect(body.x_label).toBeUndefined();
    expect(body.y_label).toBeUndefined();
  });

  it("does not throw when askParams resolves with a completely empty object", async () => {
    vi.mocked(askParams).mockResolvedValueOnce({});
    await expect(runExportFigureCommand(useApp.getState)).resolves.toBeUndefined();
    expect(exportFigure).toHaveBeenCalledTimes(1);
  });

  it.each(["pdf", "svg", "png", "tiff"])(
    "the dialog promise resolves and exportFigure is reached for fmt=%s",
    async (fmt) => {
      vi.mocked(askParams).mockResolvedValueOnce({
        fmt,
        style: "default",
        dpi: 300,
        title: "",
        x_label: "",
        y_label: "",
      });
      await runExportFigureCommand(useApp.getState);
      expect(exportFigure).toHaveBeenCalledTimes(1);
      expect(vi.mocked(exportFigure).mock.calls[0][0].fmt).toBe(fmt);
    },
  );
});

// F2.5b (FIGURE_AUTHORING_WORKFLOW_PLAN): "Export figure…" used to build its
// spec via buildFigureSpec (the live PlotView singleton), which cannot
// represent groupKey/axisBreaks/publication overrides at all — an export of
// a grouped or publication-styled window silently dropped them, even though
// the SAME window's Publication Preview export kept them. Fixed by routing
// through buildStageFigureSpec (lib/figureSpec.ts), which prefers the
// FOCUSED window's canonical FigureDocument (`store.plotWindows` here — the
// REAL store, not a fake closure, since buildStageFigureSpec reads
// `windowsForSave()`/`focusedWindowId` through the whole StoreGet).
//
// Gotcha proven while writing this: `windowsForSave()`'s REAL implementation
// rebuilds the FOCUSED window's document from the store's LIVE singleton
// PlotView fields (`yKeys`/`y2Keys`/`xKey`/…), not from whatever `view` a
// test attached to the window's own `document` — that mirrors production
// ("the focused window's live view IS the singleton fields", windows.ts's
// own doc). `axisBreaks`/`publication` are NOT part of PlotView, so they
// survive that rebuild from the attached document untouched. `groupKey`
// graduated to a live-singleton-synced PlotView field under P1.5 (it used
// to be bindings-only, exempt from this rebuild like axisBreaks/publication
// still are) — yKeys/y2Keys/xKey/groupKey must ALL be set as live
// singletons too, or the rebuild silently reverts them to the singleton's
// (usually null/default) value.
describe("runExportFigureCommand — F2.5b (routes through the focused window's canonical document)", () => {
  const DATASET_ID = "d1";

  /** A minimal but fully-typed PlotWindow (WindowsSlice's real shape) — the
   *  same fixture pattern useFigurePage.test.ts's `win()` established for
   *  F3.6's identical need (a document-backed window in the REAL store). */
  function win(over: Partial<PlotWindow>): PlotWindow {
    return {
      id: "w1",
      kind: "plot",
      title: "Window 1",
      datasetId: DATASET_ID,
      geometry: { x: 0, y: 0, w: 400, h: 300 },
      z: 0,
      winState: "normal",
      view: defaultPlotView(),
      bg: "theme",
      linkGroup: null,
      pinned: false,
      ...over,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(exportFigure).mockResolvedValue(undefined);
    vi.mocked(askParams).mockResolvedValue({
      fmt: "pdf",
      style: "default",
      dpi: 300,
      title: "",
      x_label: "",
      y_label: "",
    });
    useApp.setState({
      datasets: [
        {
          id: DATASET_ID,
          name: "scan.dat",
          data: {
            time: [0, 1],
            values: [
              [1, 10],
              [2, 20],
            ],
            labels: ["A", "B"],
            units: ["u", "v"],
            metadata: {},
          },
        },
      ],
      activeId: DATASET_ID,
      xKey: null,
      yKeys: null,
      y2Keys: null,
      xScale: "linear",
      yScale: "linear",
      xFmt: { mode: "auto", digits: 2 },
      yFmt: { mode: "auto", digits: 2 },
      y2Fmt: null,
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

  it("carries a grouped window's group_col onto the exported spec, not just the live view", async () => {
    // P1.5: groupKey is now ALSO a live-singleton-synced binding (like
    // xKey/yKeys/errKeys) -- windowsForSave() snapshots it for the focused
    // window the same way, so it must agree with the document here too.
    useApp.setState({ yKeys: [0], groupKey: 1 });
    const document = createFigureDocument({
      id: "figure-w1",
      name: "Window 1",
      datasetId: DATASET_ID,
      view: defaultPlotView(),
      groupKey: 1,
    });
    useApp.setState({ plotWindows: [win({ document })], focusedWindowId: "w1" });
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.group_col).toBe(1);
  });

  it("does not route through a focused window bound to a DIFFERENT dataset than the one being exported", async () => {
    useApp.setState({ yKeys: [0] });
    const document = createFigureDocument({
      id: "figure-w1-other",
      name: "Window on another dataset",
      datasetId: "d-other",
      view: defaultPlotView(),
      groupKey: 1,
    });
    useApp.setState({
      plotWindows: [win({ document, datasetId: "d-other" })],
      focusedWindowId: "w1",
    });
    await runExportFigureCommand(useApp.getState);
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.group_col).toBeUndefined();
  });

  it("surfaces a grouped+secondary-axis document as an export-failed status, not an unhandled rejection", async () => {
    // grouping + a secondary axis is a backend-invalid combination; groupKey
    // is live-singleton-synced (P1.5), same reasoning as the test above.
    useApp.setState({ yKeys: [0, 1], y2Keys: [1], groupKey: 1 });
    const document = createFigureDocument({
      id: "figure-w1-invalid",
      name: "Window invalid",
      datasetId: DATASET_ID,
      view: defaultPlotView(),
      groupKey: 1,
    });
    useApp.setState({ plotWindows: [win({ document })], focusedWindowId: "w1" });
    await expect(runExportFigureCommand(useApp.getState)).resolves.toBeUndefined();
    expect(exportFigure).not.toHaveBeenCalled();
    expect(useApp.getState().status).toContain("grouped figures cannot use a secondary Y axis");
  });
});
