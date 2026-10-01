// Stack and inset views export as the plain overlaid figure; the export must
// say so instead of doing it silently (lib/screenOnlyExport.ts). Covers the
// rule itself and the three Stage entry points that ask it: Export figure…,
// Copy figure, and Send figure to report's shared spec step (via Export).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { askParams } from "../components/overlays/ParamDialog";
import { exportFigure, renderFigureBlob, type FigureSpec } from "./api/figures";
import { runCopyFigureCommand } from "./copyFigureCommand";
import { runExportFigureCommand } from "./exportFigureCommand";
import {
  INSET_EXPORT_NOTICE,
  STACK_EXPORT_NOTICE,
  screenOnlyExportNotice,
  type ScreenOnlyView,
} from "./screenOnlyExport";
import { askConfirm } from "../store/confirmDialog";
import { useApp } from "../store/useApp";

vi.mock("./api/figures", () => ({
  exportFigure: vi.fn().mockResolvedValue(undefined),
  renderFigureBlob: vi.fn().mockResolvedValue(new Blob(["png"], { type: "image/png" })),
}));
vi.mock("../components/overlays/ParamDialog", () => ({
  askParams: vi.fn().mockResolvedValue({ fmt: "pdf", style: "default", dpi: 300, title: "", x_label: "", y_label: "" }),
}));
vi.mock("../store/confirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("./clipboard", () => ({
  clipboardImageSupported: () => true,
  clipboardSvgSupported: () => false,
  copySvgAsync: vi.fn(),
}));
vi.mock("./officeClipboard", () => ({ copyOfficeGraphicAsync: vi.fn().mockResolvedValue(true) }));

const view = (over: Partial<ScreenOnlyView> = {}): ScreenOnlyView => ({
  polarMode: false, statMode: false, stackMode: false, insetMode: false, composition: null, ...over,
});
const spec = (over: Partial<FigureSpec> = {}): FigureSpec => ({
  dataset: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["A", "B"], units: ["", ""], metadata: {} },
  y_keys: [0, 1],
  ...over,
});

describe("screenOnlyExportNotice", () => {
  it("names a per-channel stack and an inset, in one sentence each", () => {
    expect(screenOnlyExportNotice(view({ stackMode: true }), spec())).toBe(STACK_EXPORT_NOTICE);
    expect(screenOnlyExportNotice(view({ insetMode: true }), spec())).toBe(INSET_EXPORT_NOTICE);
    for (const n of [STACK_EXPORT_NOTICE, INSET_EXPORT_NOTICE]) expect(n.split(". ")).toHaveLength(1);
  });

  it("stays quiet when the export IS what the screen shows", () => {
    expect(screenOnlyExportNotice(view(), spec())).toBeNull();
    // A one-series "stack" is drawn as the plain plot (PlotStage's gate).
    expect(screenOnlyExportNotice(view({ stackMode: true }), spec({ y_keys: [0] }))).toBeNull();
    // Polar exports as polar; facets and x-breaks carry their own panels.
    expect(screenOnlyExportNotice(view({ stackMode: true, polarMode: true }), spec())).toBeNull();
    expect(screenOnlyExportNotice(view({ insetMode: true }), spec({ polar: {} }))).toBeNull();
    expect(screenOnlyExportNotice(view({ stackMode: true }), spec({ facets: [] }))).toBeNull();
    expect(screenOnlyExportNotice(view({ insetMode: true }), spec({ overrides: { x_breaks: [[1, 2]] } }))).toBeNull();
  });
});

function seedStore(over: Partial<ScreenOnlyView>) {
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: spec().dataset }],
    activeId: "d1",
    plotWindows: [],
    focusedWindowId: null,
    xKey: null,
    yKeys: null,
    hiddenChannels: [],
    seriesStyles: {},
    seriesLabels: {},
    status: "",
    ...view(over),
  });
}

describe("the Stage export commands ask before exporting a screen-only view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(exportFigure).mockResolvedValue(undefined);
  });

  it("Export figure… from a stack: cancelling the notice exports nothing", async () => {
    seedStore({ stackMode: true });
    vi.mocked(askConfirm).mockResolvedValueOnce(false);
    await runExportFigureCommand(useApp.getState);
    expect(askConfirm).toHaveBeenCalledWith(expect.any(String), STACK_EXPORT_NOTICE, "Export anyway");
    expect(exportFigure).not.toHaveBeenCalled();
  });

  it("Export figure… from an inset: confirming exports the overlaid figure", async () => {
    seedStore({ insetMode: true });
    vi.mocked(askConfirm).mockResolvedValueOnce(true);
    await runExportFigureCommand(useApp.getState);
    expect(askConfirm).toHaveBeenCalledWith(expect.any(String), INSET_EXPORT_NOTICE, "Export anyway");
    expect(exportFigure).toHaveBeenCalledTimes(1);
  });

  it("Export figure… from a plain plot asks nothing", async () => {
    seedStore({});
    await runExportFigureCommand(useApp.getState);
    expect(askConfirm).not.toHaveBeenCalled();
    expect(exportFigure).toHaveBeenCalledTimes(1);
    expect(askParams).toHaveBeenCalledTimes(1);
  });

  it("Copy figure from an inset: cancelling the notice renders nothing", async () => {
    seedStore({ insetMode: true });
    vi.mocked(askConfirm).mockResolvedValueOnce(false);
    await runCopyFigureCommand(useApp.getState);
    expect(askConfirm).toHaveBeenCalledWith(expect.any(String), INSET_EXPORT_NOTICE, "Copy anyway");
    expect(renderFigureBlob).not.toHaveBeenCalled();
  });
});
