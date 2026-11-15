// The three follow-ups booked by PR #679 (plans/BUGS_AND_ISSUES.md, "Open
// follow-ups from PR #679"), each against the real store and the real callers:
//  1. Export / Copy figure SAY when the figure leaves out an overlay the canvas
//     draws (never draw it at a guessed X), in Send to report's own words.
//  2. A legacy fit with no recorded X gets a figure card, and Open takes the
//     gate's open-without-the-fit path, with the reason and a Re-fit offer.
//  3. An X-designated column plotted as Y is never recorded as a fitted Y (I3).
//
// Sheet: T1,R1,T2,R2 (test/ownXFixture) -- `time` is T1, channels R1 (0),
// T2 (1, "Set As X"), R2 (2).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AnalysisResultFigures from "../workshops/analysisresults/AnalysisResultFigures";
import { runCopyFigureCommand } from "../../lib/copyFigureCommand";
import { runExportFigureCommand } from "../../lib/exportFigureCommand";
import { fitAnalysisResult } from "../../lib/fitAnalysisResult";
import { createFigureDocument } from "../../lib/figureDocument";
import { defaultPlotView, type PlotView, type PlotWindow } from "../../lib/plotview";
import { fitSelectionRefusal, selectedFitData } from "../../lib/fitselection";
import { overlaysNotCarriedReason } from "../../lib/overlaySpecShape";
import type { Dataset, FitSpec } from "../../lib/types";
import { prepareAnalysisResultPlot } from "../../store/analysisResultActions";
import { useToasts } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import { t1r1t2r2 } from "../../test/ownXFixture";

const mocks = vi.hoisted(() => ({ ask: vi.fn(), render: vi.fn(), download: vi.fn() }));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  renderFigureBlob: mocks.render,
  exportFigure: mocks.download,
}));
vi.mock("../../lib/clipboard", () => ({
  clipboardImageSupported: () => true, clipboardSvgSupported: () => true, copySvgAsync: async () => true,
}));
vi.mock("../../lib/officeClipboard", () => ({ copyOfficeGraphicFormats: async () => ["image/png"] }));
vi.mock("../../store/paramDialog", () => ({ askParams: mocks.ask }));
vi.mock("../../components/overlays/ParamDialog", () => ({ askParams: mocks.ask }));

const SHEET = t1r1t2r2();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.render.mockResolvedValue(new Blob(["png"]));
  mocks.download.mockResolvedValue(undefined);
  useToasts.setState({ toasts: [] });
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({
    datasets: [SHEET], activeId: "own", xKey: null, yKeys: [0], hiddenChannels: [], seriesOrder: null,
    seriesStyles: {}, plotWindows: [], focusedWindowId: null, reports: [], history: [], future: [],
    fitOverlay: { datasetId: "own", binding: { yKey: 0, xKey: null }, y: [1, 2, 3, 4] },
    baselineOverlay: null, peakOverlay: null, derivOverlay: null, excludedDisplay: "hide",
  });
});

const lastToast = () => useToasts.getState().toasts.at(-1)?.msg ?? "";

/** Focus a window whose LIVE document groups by R2: a grouped request re-splits
 *  its rows server-side, so a row-aligned fit column cannot ride it. */
function focusGrouped(over: Partial<PlotView> = {}) {
  const s = useApp.getState();
  const view = { ...defaultPlotView(), ...s, ...over, groupKey: 2 };
  const document = createFigureDocument({ id: "w1-doc", name: "W", datasetId: "own", view });
  const win: PlotWindow = {
    id: "w1", kind: "plot", title: "Window 1", datasetId: "own", geometry: { x: 0, y: 0, w: 400, h: 300 },
    z: 0, winState: "normal", view, bg: "theme", linkGroup: null, pinned: false, document,
  };
  useApp.setState({ ...over, groupKey: 2, plotWindows: [win], focusedWindowId: "w1" });
}

describe("1 -- Export / Copy figure say when a drawn overlay is left out", () => {
  it("Copy figure reports the fit a grouped figure cannot carry, in Send to report's words", async () => {
    // The canvas draws R1's fit; a grouped request re-splits its rows server-side,
    // so the fit cannot ride it (and is never drawn at a guessed X).
    focusGrouped();
    await runCopyFigureCommand(useApp.getState);
    const sent = mocks.render.mock.calls[0][0];
    expect(sent.dataset.labels).not.toContain("fit");
    expect(lastToast()).toContain(overlaysNotCarriedReason(["fit"]));
  });

  it("Export figure reports it too; a figure that carries the fit says nothing extra", async () => {
    mocks.ask.mockResolvedValue({ fmt: "svg", style: "default", dpi: 300, greyscale: false, title: "", x_label: "", y_label: "" });
    await runExportFigureCommand(useApp.getState);
    expect(mocks.download.mock.calls[0][0].dataset.labels).toContain("fit");
    expect(lastToast()).not.toContain("does not carry");
    focusGrouped();
    await runExportFigureCommand(useApp.getState);
    expect(lastToast()).toContain(overlaysNotCarriedReason(["fit"]));
  });

  it("a fit the canvas does not draw either (its curve hidden) is not reported", async () => {
    focusGrouped({ yKeys: [0, 2], hiddenChannels: [0] });
    await runCopyFigureCommand(useApp.getState);
    expect(lastToast()).not.toContain("does not carry");
  });
});

describe("2 -- a legacy fit with no recorded X is reachable from the results panel", () => {
  const legacy: FitSpec = { model: "Linear", yKey: 0, params: [2, 1], errors: [0, 0], nPoints: 4 };
  function saveLegacy() {
    const ds: Dataset = { ...SHEET, fitSpec: legacy };
    const result = fitAnalysisResult(ds, legacy);
    useApp.setState({ datasets: [ds], analysisResults: [result] });
    return result;
  }

  it("gets a figure card whose Open is enabled, says why the fit is not drawn and offers a re-fit", () => {
    const result = saveLegacy();
    expect(result.plotBindings).toBeUndefined(); // the envelope still records no X binding
    const onOpen = vi.fn(), onRefit = vi.fn();
    render(<AnalysisResultFigures result={result} onOpen={onOpen} onBuild={vi.fn()} onReport={vi.fn()}
      onRefit={onRefit} onCreateStatistical={vi.fn()} />);
    expect(screen.queryByText(/No figure-ready output/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open fitted plot" }));
    expect(onOpen).toHaveBeenCalledWith(0);
    expect(screen.getByRole("button", { name: "Send fitted plot to report…" })).toBeDisabled();
    expect(screen.getByRole("note").textContent).toContain("never recorded its X");
    fireEvent.click(screen.getByRole("button", { name: "Re-fit…" }));
    expect(onRefit).toHaveBeenCalled();
  });

  it("Open through that card opens the data without the fit and says so", async () => {
    saveLegacy();
    const opened = await prepareAnalysisResultPlot("analysis-fit-own", 0);
    expect(opened).not.toBeNull();
    expect(useApp.getState().fitOverlay).toBeNull();
    expect(useApp.getState().yKeys).toEqual([0]);
    expect(useApp.getState().status).toContain("opened the plot without the fit: the saved fit never recorded its X");
  });
});

describe("3 -- an X-designated column plotted as Y is never recorded as the fitted Y (I3)", () => {
  it("selectedFitData refuses T2 as a Y, and says why", () => {
    expect(selectedFitData(SHEET, null, [1], null)).toBeNull();
    expect(fitSelectionRefusal(SHEET, null, [1], null)).toContain("T2 is an X column");
    // A real Y is unaffected: R2 against its own X, T2.
    expect(selectedFitData(SHEET, null, [2], null)).toMatchObject({ yKey: 2, xKey: 1 });
    expect(fitSelectionRefusal(SHEET, null, [2], null)).toBeNull();
  });

  it("a saved spec that recorded an X column as its Y is not replayed onto it", async () => {
    const { fitDataForSpec } = await import("../../lib/fitselection");
    expect(fitDataForSpec(SHEET, { model: "Linear", xKey: null, yKey: 1 }, null, [0], null)).toBeNull();
  });
});
