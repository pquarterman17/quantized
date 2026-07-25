// MAIN #35: "Copy figure" must render through the SAME publication path as
// "Export figure…", not the screen canvas. These tests pin the spec that goes
// on the wire and the failure paths, since the clipboard write itself is not
// meaningfully observable in jsdom.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderFigureBlob } from "./api";
import { clipboardImageSupported, copyImageAsync } from "./clipboard";
import { COPY_FIGURE_DPI, COPY_FIGURE_FMT, runCopyFigureCommand } from "./copyFigureCommand";
import type { DataStruct, Dataset } from "./types";

vi.mock("./api", () => ({ renderFigureBlob: vi.fn() }));
vi.mock("./clipboard", () => ({
  clipboardImageSupported: vi.fn(() => true),
  copyImageAsync: vi.fn(async () => true),
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

/** Minimal store snapshot — only the fields buildFigureSpec + the command read. */
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
    pageSetup: null,
    ...over,
  };
  return (() => state) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clipboardImageSupported).mockReturnValue(true);
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
