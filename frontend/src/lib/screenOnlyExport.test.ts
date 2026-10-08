// Stack views export as the plain overlaid figure;
// the export must say so instead of doing it silently (lib/screenOnlyExport.ts).
// Covers the rule itself and the three Stage entry points that ask it: Export
// figure…, Copy figure, and Send figure to report's shared spec step (via
// Export). Plot audit leftovers: the magnifier inset rides the request
// (`overrides.inset`) and exports as drawn — a dual-Y one too, with its
// secondary range (batch 33) — so it asks nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { askParams } from "../components/overlays/ParamDialog";
import { exportFigure, renderFigureBlob, type FigureSpec } from "./api/figures";
import { exportFigurePage } from "./api/figurePage";
import { DEFAULT_INSET_AT } from "./inset";
import type { PlotView } from "./plotview";
import { runCopyFigureCommand } from "./copyFigureCommand";
import { runExportFigureCommand } from "./exportFigureCommand";
import {
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
vi.mock("./api/figurePage", () => ({ exportFigurePage: vi.fn().mockResolvedValue(undefined) }));
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

/** The rule's inputs plus the inset toggle it no longer reads (an inset always exports). */
type View = ScreenOnlyView & { insetMode: boolean };
const view = (over: Partial<View> = {}): View => ({
  polarMode: false, statMode: false, stackMode: false, insetMode: false, composition: null, ...over,
});
const spec = (over: Partial<FigureSpec> = {}): FigureSpec => ({
  dataset: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["A", "B"], units: ["", ""], metadata: {} },
  y_keys: [0, 1],
  ...over,
});

describe("screenOnlyExportNotice", () => {
  it("names a per-channel stack in one sentence", () => {
    expect(screenOnlyExportNotice(view({ stackMode: true }), spec())).toBe(STACK_EXPORT_NOTICE);
    expect(STACK_EXPORT_NOTICE.split(". ")).toHaveLength(1);
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
    // The request carries the inset (a dual-Y one too): the export draws it.
    expect(screenOnlyExportNotice(view({ insetMode: true }), spec({ overrides: { inset: { at: [0.5, 0.5, 0.3, 0.3] } } }))).toBeNull();
    expect(screenOnlyExportNotice(view({ insetMode: true }), spec({ y2_keys: [1] }))).toBeNull();
  });
});

function seedStore(over: Partial<View>) {
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

  // Plot audit round 4: the vector export draws the stack's own panels now.
  it("Export figure… from a stack exports one panel per channel and asks nothing", async () => {
    seedStore({ stackMode: true });
    await runExportFigureCommand(useApp.getState);
    expect(askConfirm).not.toHaveBeenCalled();
    expect(exportFigure).not.toHaveBeenCalled();
    const page = vi.mocked(exportFigurePage).mock.calls[0][0];
    expect(page).toMatchObject({ rows: 2, cols: 1, stack: true });
    expect(page.panels.map((p) => p.figure.y_keys)).toEqual([[0], [1]]);
  });

  it("Copy figure from a stack still says the copy is one overlaid plot", async () => {
    seedStore({ stackMode: true });
    vi.mocked(askConfirm).mockResolvedValueOnce(false);
    await runCopyFigureCommand(useApp.getState);
    expect(askConfirm).toHaveBeenCalledWith(expect.any(String), STACK_EXPORT_NOTICE, "Copy anyway");
  });

  const INSET = { x: [0.2, 0.6], y: [1.5, 3.5], yZoom: true, at: [0.1, 0.2, 0.3, 0.25], lines: false } as const;
  const INSET_WIRE = { x: [0.2, 0.6], y: [1.5, 3.5], at: [0.1, 0.2, 0.3, 0.25], lines: false };

  it("Export figure… from an inset exports the inset as drawn and asks nothing", async () => {
    seedStore({ insetMode: true });
    useApp.setState({ inset: structuredClone(INSET) as unknown as PlotView["inset"] });
    await runExportFigureCommand(useApp.getState);
    expect(askConfirm).not.toHaveBeenCalled();
    expect(vi.mocked(exportFigure).mock.calls[0][0].overrides?.inset).toEqual(INSET_WIRE);
  });

  it("an inset never drawn exports at its default placement, seeded by the export", async () => {
    seedStore({ insetMode: true });
    useApp.setState({ inset: null });
    await runExportFigureCommand(useApp.getState);
    expect(vi.mocked(exportFigure).mock.calls[0][0].overrides?.inset).toEqual({ at: [...DEFAULT_INSET_AT], lines: true });
  });

  it("Copy figure from an inset copies the inset too", async () => {
    seedStore({ insetMode: true });
    useApp.setState({ inset: structuredClone(INSET) as unknown as PlotView["inset"] });
    await runCopyFigureCommand(useApp.getState);
    expect(askConfirm).not.toHaveBeenCalled();
    expect(vi.mocked(renderFigureBlob).mock.calls[0][0].overrides?.inset).toEqual(INSET_WIRE);
  });

  it("Export figure… from a dual-Y inset exports it with its secondary range and asks nothing", async () => {
    seedStore({ insetMode: true });
    useApp.setState({ y2Keys: [1], inset: { ...structuredClone(INSET), y2: [3, 4] } as unknown as PlotView["inset"] });
    await runExportFigureCommand(useApp.getState);
    expect(askConfirm).not.toHaveBeenCalled();
    const req = vi.mocked(exportFigure).mock.calls[0][0];
    expect(req.y2_keys).toEqual([1]);
    expect(req.overrides?.inset).toEqual({ ...INSET_WIRE, y2: [3, 4] });
    useApp.setState({ y2Keys: null });
  });

  it("Export figure… from a plain plot asks nothing", async () => {
    seedStore({});
    await runExportFigureCommand(useApp.getState);
    expect(askConfirm).not.toHaveBeenCalled();
    expect(exportFigure).toHaveBeenCalledTimes(1);
    expect(askParams).toHaveBeenCalledTimes(1);
  });

  it("Copy figure from a dual-Y inset copies the inset too", async () => {
    seedStore({ insetMode: true });
    useApp.setState({ y2Keys: [1], inset: structuredClone(INSET) as unknown as PlotView["inset"] });
    await runCopyFigureCommand(useApp.getState);
    expect(askConfirm).not.toHaveBeenCalled();
    expect(vi.mocked(renderFigureBlob).mock.calls[0][0].overrides?.inset).toEqual(INSET_WIRE);
    useApp.setState({ y2Keys: null });
  });
});
