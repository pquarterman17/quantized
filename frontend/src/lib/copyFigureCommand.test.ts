// MAIN #35: "Copy figure" must render through the SAME publication path as
// "Export figure…", not the screen canvas. These tests pin the spec that goes
// on the wire and the failure paths, since the clipboard write itself is not
// meaningfully observable in jsdom.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderFigureBlob } from "./api";
import {
  clipboardImageSupported,
  clipboardSvgSupported,
  copyImageAsync,
  copySvgAsync,
} from "./clipboard";
import {
  COPY_FIGURE_DPI,
  COPY_FIGURE_FMT,
  runCopyFigureCommand,
  runCopyFigureSvgCommand,
} from "./copyFigureCommand";
import { createFigureDocument } from "./figureDocument";
import { defaultPlotView } from "./plotview";
import type { DataStruct, Dataset } from "./types";

vi.mock("./api", () => ({ renderFigureBlob: vi.fn() }));
vi.mock("./clipboard", () => ({
  clipboardImageSupported: vi.fn(() => true),
  clipboardSvgSupported: vi.fn(() => true),
  copyImageAsync: vi.fn(async () => true),
  copySvgAsync: vi.fn(async () => true),
}));

const data: DataStruct = {
  time: [1, 2, 3],
  values: [
    [10, 5],
    [20, 6],
    [30, 7],
  ],
  labels: ["M", "N"],
  units: ["emu", "emu"],
  metadata: {},
};
const ds: Dataset = { id: "d1", name: "scan.dat", data };

const setStatus = vi.fn();

/** Minimal store snapshot — only the fields buildFigureSpec + the command read.
 *  F2.5b: `focusedWindowId`/`windowsForSave` default to "nothing focused", so
 *  every pre-F2.5b test below still exercises the legacy live-view builder
 *  unchanged (buildStageFigureSpec's fallback path) — only the new "F2.5b"
 *  describe block below overrides them to route through a document. */
function fakeGet(over: Record<string, unknown> = {}) {
  const state = {
    datasets: [ds],
    activeId: "d1",
    resolveDataset: async () => ds,
    setStatus,
    plotTitle: "",
    xAxisLabel: "",
    yAxisLabel: "",
    yKeys: [0, 1],
    xKey: null,
    seriesOrder: [],
    hiddenChannels: [] as number[],
    seriesLabels: {} as Record<number, string>,
    seriesStyles: {},
    xScale: "linear",
    yScale: "linear",
    // Real store default shape — axisFmtParam reads .mode, so null throws.
    xFmt: { mode: "auto", digits: 2 },
    yFmt: { mode: "auto", digits: 2 },
    y2Fmt: null,
    y2Scale: null,
    xStep: null,
    yStep: null,
    y2Keys: [] as number[],
    y2Label: "",
    y2Lim: null,
    xLim: null,
    yLim: null,
    showGrid: false,
    showAxisBox: false,
    showLegend: false,
    legendPos: "ne",
    legendXY: null,
    legendFrameXY: null,
    legendTitle: "",
    annotations: [],
    shapes: [],
    refLines: [],
    regionShades: [],
    pageSetup: null,
    copyFigureTransparent: false,
    focusedWindowId: null as string | null,
    windowsForSave: () => [] as { id: string; kind: string; document?: unknown }[],
    ...over,
  };
  return (() => state) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clipboardImageSupported).mockReturnValue(true);
  vi.mocked(clipboardSvgSupported).mockReturnValue(true);
  vi.mocked(copySvgAsync).mockResolvedValue(true);
  vi.mocked(copyImageAsync).mockResolvedValue(true);
  vi.mocked(renderFigureBlob).mockResolvedValue(new Blob(["x"], { type: "image/png" }));
});

describe("runCopyFigureCommand", () => {
  it("renders through the publication route at 300-DPI PNG", async () => {
    await runCopyFigureCommand(fakeGet());
    expect(renderFigureBlob).toHaveBeenCalledTimes(1);
    const spec = vi.mocked(renderFigureBlob).mock.calls[0][0];
    expect(spec.fmt).toBe(COPY_FIGURE_FMT);
    expect(spec.fmt).toBe("png");
    expect(spec.dpi).toBe(COPY_FIGURE_DPI);
    expect(spec.dpi).toBe(300);
  });

  it("carries the on-screen view into the spec, not raw defaults", async () => {
    // The whole point of #35: what you see is what gets pasted. A hidden
    // channel and a manual limit must both reach the renderer.
    await runCopyFigureCommand(fakeGet({ hiddenChannels: [1], yLim: [0, 42] }));
    const spec = vi.mocked(renderFigureBlob).mock.calls[0][0];
    expect(spec.y_keys).toEqual([0]); // channel 1 hidden on screen -> not rendered
    expect(spec.overrides?.y_lim).toEqual([0, 42]);
  });

  it("hands the PENDING render to the clipboard to keep the user gesture", async () => {
    // Awaiting the render before touching the clipboard can drop the transient
    // user activation, so the command must pass a promise, not a resolved Blob.
    await runCopyFigureCommand(fakeGet());
    const arg = vi.mocked(copyImageAsync).mock.calls[0][0];
    expect(typeof (arg as Promise<Blob | null>).then).toBe("function");
  });

  it("does not render at all when the clipboard image API is unavailable", async () => {
    vi.mocked(clipboardImageSupported).mockReturnValue(false);
    await runCopyFigureCommand(fakeGet());
    expect(renderFigureBlob).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith(
      expect.stringContaining("clipboard image unavailable"),
    );
  });

  it("reports a copy failure using copy wording, not export wording", async () => {
    vi.mocked(copyImageAsync).mockResolvedValue(false);
    await runCopyFigureCommand(fakeGet());
    const messages = setStatus.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.startsWith("copy failed"))).toBe(true);
    expect(messages.some((m) => m.startsWith("export failed"))).toBe(false);
  });

  it("sends the opaque background by default", async () => {
    await runCopyFigureCommand(fakeGet());
    expect(vi.mocked(renderFigureBlob).mock.calls[0][0].transparent).toBe(false);
  });

  it("honours the transparent-background preference", async () => {
    await runCopyFigureCommand(fakeGet({ copyFigureTransparent: true }));
    expect(vi.mocked(renderFigureBlob).mock.calls[0][0].transparent).toBe(true);
  });

  it("reports when there is no dataset to copy", async () => {
    await runCopyFigureCommand(fakeGet({ datasets: [], activeId: null }));
    expect(renderFigureBlob).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith("no dataset to copy");
  });

  it("surfaces a render failure instead of silently copying nothing", async () => {
    vi.mocked(copyImageAsync).mockRejectedValue(new Error("boom"));
    await runCopyFigureCommand(fakeGet());
    const messages = setStatus.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("boom"))).toBe(true);
  });
});

describe("runCopyFigureSvgCommand (MAIN #35)", () => {
  it("renders VECTOR through the same publication route", async () => {
    await runCopyFigureSvgCommand(fakeGet());
    const spec = vi.mocked(renderFigureBlob).mock.calls[0][0];
    expect(spec.fmt).toBe("svg");
  });

  it("hands the pending render to the clipboard, keeping the gesture", async () => {
    await runCopyFigureSvgCommand(fakeGet());
    const arg = vi.mocked(copySvgAsync).mock.calls[0][0];
    expect(typeof (arg as Promise<Blob | null>).then).toBe("function");
  });

  it("does not render at all when the browser won't take SVG", async () => {
    // An entry that always fails is worse than no entry; the caller says why.
    vi.mocked(clipboardSvgSupported).mockReturnValue(false);
    await runCopyFigureSvgCommand(fakeGet());
    expect(renderFigureBlob).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith(expect.stringContaining("Export figure"));
  });

  it("carries the on-screen view, like the raster copy", async () => {
    await runCopyFigureSvgCommand(fakeGet({ hiddenChannels: [1] }));
    expect(vi.mocked(renderFigureBlob).mock.calls[0][0].y_keys).toEqual([0]);
  });

  it("reports a refused clipboard write with copy wording", async () => {
    vi.mocked(copySvgAsync).mockResolvedValue(false);
    await runCopyFigureSvgCommand(fakeGet());
    const msgs = setStatus.mock.calls.map((c) => String(c[0]));
    expect(msgs.some((m) => m.startsWith("copy failed"))).toBe(true);
  });
});

// F2.5b (FIGURE_AUTHORING_WORKFLOW_PLAN): Stage copy used to build its spec
// via buildFigureSpec (the live PlotView singleton), which cannot represent
// groupKey/axisBreaks/publication overrides at all — a copy of a grouped or
// publication-styled window silently dropped them, even though the SAME
// window's Publication Preview export kept them. Fixed by routing through
// buildStageFigureSpec (lib/figureSpec.ts), which prefers the focused
// window's canonical FigureDocument.
describe("F2.5b — Stage copy routes through the focused window's canonical document", () => {
  it("carries a grouped window's group_col onto the copied spec, not just the live view", async () => {
    const document = createFigureDocument({
      id: "w1-doc",
      name: "Window 1",
      datasetId: "d1", // matches activeId/the resolved dataset — routes through the document
      view: { ...defaultPlotView(), yKeys: [0] },
      groupKey: 1,
    });
    await runCopyFigureCommand(
      fakeGet({
        focusedWindowId: "w1",
        windowsForSave: () => [{ id: "w1", kind: "plot", document }],
      }),
    );
    const spec = vi.mocked(renderFigureBlob).mock.calls[0][0];
    expect(spec.group_col).toBe(1);
  });

  it("does not route through a focused window bound to a DIFFERENT dataset than the one being copied", async () => {
    const document = createFigureDocument({
      id: "w1-doc-other",
      name: "Window on another dataset",
      datasetId: "d-other",
      view: { ...defaultPlotView(), yKeys: [0] },
      groupKey: 1,
    });
    await runCopyFigureCommand(
      fakeGet({
        focusedWindowId: "w1",
        windowsForSave: () => [{ id: "w1", kind: "plot", document }],
      }),
    );
    const spec = vi.mocked(renderFigureBlob).mock.calls[0][0];
    expect(spec.group_col).toBeUndefined();
  });

  it("surfaces a grouped+secondary-axis document as a copy-failed toast/status, not an unhandled rejection", async () => {
    const document = createFigureDocument({
      id: "w1-doc-invalid",
      name: "Window invalid",
      datasetId: "d1",
      view: { ...defaultPlotView(), yKeys: [0, 1], y2Keys: [1] },
      groupKey: 1, // grouping + a secondary axis is a backend-invalid combination
    });
    await expect(
      runCopyFigureCommand(
        fakeGet({
          focusedWindowId: "w1",
          windowsForSave: () => [{ id: "w1", kind: "plot", document }],
        }),
      ),
    ).resolves.toBeUndefined();
    expect(renderFigureBlob).not.toHaveBeenCalled();
    const messages = setStatus.mock.calls.map((c) => String(c[0]));
    expect(
      messages.some(
        (m) => m.startsWith("copy failed") && m.includes("grouped figures cannot use a secondary Y axis"),
      ),
    ).toBe(true);
  });
});
