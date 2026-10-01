// With the statistics stage on screen, "Export figure…", "Copy figure",
// "Copy figure (vector)" and "Send figure to report" must produce the STAT plot
// (the stage's own export, lib/statStageBridge.ts), never an XY figure of the
// underlying data. With no stat stage to route to, they say so first
// (lib/screenOnlyExport.ts's confirm) instead of exporting XY silently.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigure, renderFigureBlob } from "./api/figures";
import { postBlob } from "./api/http";
import { copySvgAsync } from "./clipboard";
import { runCopyFigureCommand, runCopyFigureSvgCommand } from "./copyFigureCommand";
import { runExportFigureCommand } from "./exportFigureCommand";
import { copyOfficeGraphicAsync } from "./officeClipboard";
import type { ReportFigureBlock } from "./report";
import { STAT_EXPORT_NOTICE } from "./screenOnlyExport";
import { NEW_REPORT, runSendFigureToReportCommand } from "./sendFigureToReport";
import { activeStatExporter, registerStatStageExporter, type StatExportOut } from "./statStageBridge";
import { askConfirm } from "../store/confirmDialog";
import { useApp } from "../store/useApp";

vi.mock("./api/figures", () => ({
  exportFigure: vi.fn().mockResolvedValue(undefined),
  renderFigureBlob: vi.fn().mockResolvedValue(new Blob(["xy"], { type: "image/png" })),
}));
vi.mock("./api/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/http")>()),
  postBlob: vi.fn(),
}));
const { ask } = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock("../components/overlays/ParamDialog", () => ({ askParams: ask }));
vi.mock("../store/paramDialog", () => ({ askParams: ask }));
vi.mock("../store/confirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("./clipboard", () => ({
  clipboardImageSupported: () => true,
  clipboardSvgSupported: () => true,
  copySvgAsync: vi.fn().mockResolvedValue(true),
}));
vi.mock("./officeClipboard", () => ({ copyOfficeGraphicAsync: vi.fn().mockResolvedValue(true) }));

const STAT_PNG = new Blob(["stat-png"], { type: "image/png" });

/** Stands in for the stage's exporter (Stage/useStatStageExport.ts): builds a
 *  box request in `fmt` with the caller's style/dpi and delivers it. */
const exporter = vi.fn(async (fmt: string, out: StatExportOut = {}) => {
  const spec = { kind: "box" as const, data: [[1, 2, 3]], labels: ["A"], fmt, style: out.style, dpi: out.dpi };
  if (out.deliver) await out.deliver({ route: "statplot", spec }, out.signal);
  return true;
});

let unregister: (() => void) | null = null;

function seed(over: Record<string, unknown> = {}) {
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: {
      time: [0, 1], values: [[1, 2], [3, 4]], labels: ["A", "B"], units: ["", ""], metadata: {},
    } }],
    activeId: "d1",
    plotWindows: [],
    focusedWindowId: null,
    xKey: null,
    yKeys: null,
    hiddenChannels: [],
    seriesStyles: {},
    seriesLabels: {},
    polarMode: false,
    statMode: true,
    stackMode: false,
    insetMode: false,
    composition: null,
    reports: [],
    openReportId: null,
    status: "",
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(postBlob).mockResolvedValue(STAT_PNG);
  seed();
  unregister = registerStatStageExporter(exporter);
});
afterEach(() => {
  unregister?.();
  unregister = null;
});

describe("the stat stage's exporter is the one the commands find", () => {
  it("only while stat mode is what the Stage draws, and only while registered", () => {
    expect(activeStatExporter({ statMode: true, polarMode: false })).toBe(exporter);
    expect(activeStatExporter({ statMode: false, polarMode: false })).toBeNull();
    expect(activeStatExporter({ statMode: true, polarMode: true })).toBeNull(); // PlotStage draws polar first
    unregister?.();
    expect(activeStatExporter({ statMode: true, polarMode: false })).toBeNull();
  });
});

describe("Export figure… in stat mode", () => {
  it("exports through the stat stage with the dialog's format, style and DPI", async () => {
    ask.mockResolvedValueOnce({ fmt: "svg", style: "aps", dpi: 600 });
    await runExportFigureCommand(useApp.getState);
    expect(exporter).toHaveBeenCalledWith("svg", { style: "aps", dpi: 600 });
    expect(exportFigure).not.toHaveBeenCalled();
    expect(useApp.getState().status).toBe("exported statistical-plot figure");
  });

  it("with no stat stage to route to, asks before exporting XY", async () => {
    unregister?.();
    ask.mockResolvedValueOnce({ fmt: "pdf", style: "default", dpi: 300, title: "", x_label: "", y_label: "" });
    vi.mocked(askConfirm).mockResolvedValueOnce(false);
    await runExportFigureCommand(useApp.getState);
    expect(askConfirm).toHaveBeenCalledWith(expect.any(String), STAT_EXPORT_NOTICE, "Export anyway");
    expect(exportFigure).not.toHaveBeenCalled();
  });
});

describe("Copy figure in stat mode", () => {
  it("puts the stat renderer's 300-DPI PNG on the clipboard, never an XY render", async () => {
    await runCopyFigureCommand(useApp.getState);
    expect(renderFigureBlob).not.toHaveBeenCalled();
    expect(postBlob).toHaveBeenCalledWith(
      "/api/export/statplot-figure",
      expect.objectContaining({ kind: "box", fmt: "png", dpi: 300 }),
      expect.anything(),
    );
    const call = vi.mocked(copyOfficeGraphicAsync).mock.calls[0]?.[0];
    expect(call?.svg).toBeNull();
    expect(await call?.png).toBe(STAT_PNG);
  });

  it("Copy figure (vector) copies the stat renderer's SVG", async () => {
    const svg = new Blob(["<svg/>"], { type: "image/svg+xml" });
    vi.mocked(postBlob).mockResolvedValueOnce(svg);
    await runCopyFigureSvgCommand(useApp.getState);
    expect(renderFigureBlob).not.toHaveBeenCalled();
    expect(postBlob).toHaveBeenCalledWith(
      "/api/export/statplot-figure", expect.objectContaining({ fmt: "svg" }), expect.anything(),
    );
    expect(await vi.mocked(copySvgAsync).mock.calls[0]?.[0]).toBe(svg);
  });

  it("Copy figure (vector) asks for glyph outlines, as the XY vector copy does", async () => {
    await runCopyFigureSvgCommand(useApp.getState);
    expect(postBlob).toHaveBeenCalledWith(
      "/api/export/statplot-figure",
      expect.objectContaining({ fmt: "svg", svg_text_as_paths: true }),
      expect.anything(),
    );
  });

  it("the PNG copy sends no outline flag", async () => {
    await runCopyFigureCommand(useApp.getState);
    const body = vi.mocked(postBlob).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body.fmt).toBe("png");
    expect(body).not.toHaveProperty("svg_text_as_paths");
  });

  it("with no stat stage to route to, asks before copying XY", async () => {
    unregister?.();
    vi.mocked(askConfirm).mockResolvedValueOnce(false);
    await runCopyFigureCommand(useApp.getState);
    expect(askConfirm).toHaveBeenCalledWith(expect.any(String), STAT_EXPORT_NOTICE, "Copy anyway");
    expect(renderFigureBlob).not.toHaveBeenCalled();
  });
});

describe("Send figure to report in stat mode", () => {
  const figureBlocks = (): ReportFigureBlock[] =>
    useApp.getState().reports.flatMap((r) =>
      r.report.sections.flatMap((s) => s.blocks.filter((b): b is ReportFigureBlock => b.type === "figure")),
    );

  it("adds the stat renderer's PNG as the figure's image, with no XY spec", async () => {
    ask.mockResolvedValueOnce({ target: NEW_REPORT, newReportName: "", caption: "Box", fmt: "svg", style: "aps" });
    await runSendFigureToReportCommand(useApp.getState);
    expect(exporter).toHaveBeenCalledWith("png", expect.objectContaining({ style: "aps", dpi: 300 }));
    const [block] = figureBlocks();
    expect(block.spec).toBeUndefined();
    expect(block.image?.mime).toBe("image/png");
    expect(atob(block.image?.data ?? "")).toBe("stat-png");
    expect(block.caption).toBe("Box");
  });

  it("with no stat stage to route to, asks before sending XY", async () => {
    unregister?.();
    ask.mockResolvedValueOnce({ target: NEW_REPORT, newReportName: "", caption: "", fmt: "svg", style: "default" });
    vi.mocked(askConfirm).mockResolvedValueOnce(false);
    await runSendFigureToReportCommand(useApp.getState);
    expect(askConfirm).toHaveBeenCalledWith(expect.any(String), STAT_EXPORT_NOTICE, "Send anyway");
    expect(figureBlocks()).toEqual([]);
  });
});
