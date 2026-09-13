import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigurePage } from "./api";
import { spatialComposition } from "./composition";
import { runExportSpatialPageCommand } from "./exportPageCommand";
import { defaultPageSetup } from "./pagesetup";
import { usePendingOps } from "../store/pendingOps";
import { useApp } from "../store/useApp";

vi.mock("./api", () => ({ exportFigurePage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../components/overlays/ParamDialog", () => ({
  askParams: vi.fn().mockResolvedValue({ fmt: "pdf", dpi: 300 }),
}));
const toastSpy = vi.fn();
vi.mock("../store/toasts", () => ({ toast: (...args: unknown[]) => toastSpy(...args) }));

describe("runExportSpatialPageCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "book",
          data: {
            time: [0, 1],
            values: [[1], [2]],
            labels: ["signal"],
            units: [""],
            metadata: {},
          },
        },
      ],
      activeId: "d1",
      composition: spatialComposition([
        {
          datasetId: "d1",
          xKey: null,
          yKeys: [0],
          xLim: [0, 1],
          yLim: [1, 2],
          xLog: false,
          yLog: true,
          row: 0,
          col: 0,
          pageRect: { left: 0.1, top: 0.2, width: 0.7, height: 0.6 },
        },
      ]),
      pageSetup: defaultPageSetup(),
      xFmt: { mode: "eng", digits: 2 },
      yFmt: { mode: "sci", digits: 1 },
      showGrid: false,
      showAxisBox: true,
    });
  });

  it("threads the live page appearance into every nested figure request", async () => {
    await runExportSpatialPageCommand(useApp.getState);
    const body = vi.mocked(exportFigurePage).mock.calls[0][0];
    expect(body.panels[0].figure.x_fmt).toEqual({ mode: "eng", digits: 2 });
    expect(body.panels[0].figure.y_fmt).toEqual({ mode: "sci", digits: 1 });
    expect(body.panels[0].figure.overrides).toMatchObject({
      x_lim: [0, 1],
      y_lim: [1, 2],
      grid: false,
      spines: { top: true, right: true },
      ticks: { minor: true },
    });
  });

  // FIGURE_AUTHORING_WORKFLOW_PLAN flat-path fix: the SAME row-exclusion
  // gap the single-figure flat path had -- this command used to resolve
  // each panel from the raw `ds.data`, so an excluded row could reach the
  // exported page even though the on-screen spatial grid never showed it.
  it("prunes an excluded row from a panel's exported dataset, like the on-screen spatial grid", () => {
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "book",
          data: {
            time: [0, 1],
            values: [[1], [2]],
            labels: ["signal"],
            units: [""],
            metadata: {},
          },
          excludedRows: [0],
        },
      ],
    });

    return runExportSpatialPageCommand(useApp.getState).then(() => {
      const body = vi.mocked(exportFigurePage).mock.calls[0][0];
      expect(body.panels[0].figure.dataset.time).toEqual([1]);
      expect(body.panels[0].figure.dataset.values).toEqual([[2]]);
    });
  });
});

// PRIMARY_SOFTWARE_AUDIT_PLAN P3.4 (safe cancel for long export operations) —
// the "page" export kind. This command does NOT route through
// lib/exportActive.ts's shared chokepoint (see its own header), so it is
// covered separately rather than by exportActive.test.ts.
describe("runExportSpatialPageCommand — safe cancel (P3.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePendingOps.setState({ ops: [] });
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "book",
          data: { time: [0, 1], values: [[1], [2]], labels: ["signal"], units: [""], metadata: {} },
        },
      ],
      activeId: "d1",
      composition: spatialComposition([
        {
          datasetId: "d1",
          xKey: null,
          yKeys: [0],
          xLim: [0, 1],
          yLim: [1, 2],
          xLog: false,
          yLog: true,
          row: 0,
          col: 0,
          pageRect: { left: 0.1, top: 0.2, width: 0.7, height: 0.6 },
        },
      ]),
      pageSetup: defaultPageSetup(),
      xFmt: { mode: "eng", digits: 2 },
      yFmt: { mode: "sci", digits: 1 },
      showGrid: false,
      showAxisBox: true,
    });
  });

  it("threads a real, abortable AbortSignal into exportFigurePage", async () => {
    let capturedSignal: AbortSignal | undefined;
    let reject!: (e: unknown) => void;
    vi.mocked(exportFigurePage).mockImplementation((_body, signal) => {
      capturedSignal = signal;
      return new Promise((_r, rj) => (reject = rj));
    });

    const p = runExportSpatialPageCommand(useApp.getState);
    await vi.waitFor(() => expect(capturedSignal).toBeInstanceOf(AbortSignal));
    expect(capturedSignal!.aborted).toBe(false);

    usePendingOps.getState().ops[0].cancel!();
    expect(capturedSignal!.aborted).toBe(true);

    reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await p;

    expect(useApp.getState().status).toBe("export cancelled");
    expect(toastSpy).not.toHaveBeenCalled(); // no error toast, no "exported origin_page..." toast
  });

  it("registers a Cancel-able op and clears it on cancel, with no download", async () => {
    let reject!: (e: unknown) => void;
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(exportFigurePage).mockImplementation((_body, signal) => {
      capturedSignal = signal;
      return new Promise((_r, rj) => (reject = rj));
    });

    const p = runExportSpatialPageCommand(useApp.getState);
    // Wait on resolved state (the captured signal), not on the mock call.
    await vi.waitFor(() => expect(capturedSignal).toBeInstanceOf(AbortSignal));
    expect(usePendingOps.getState().ops).toHaveLength(1);
    expect(usePendingOps.getState().ops[0].label).toBe("Exporting page…");

    usePendingOps.getState().ops[0].cancel!();
    reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await p;

    expect(usePendingOps.getState().ops).toHaveLength(0);
    expect(toastSpy).not.toHaveBeenCalled(); // no "exported" success toast, no error toast either
  });
});
