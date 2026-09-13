import { beforeEach, describe, expect, it, vi } from "vitest";

import { askParams } from "../components/overlays/ParamDialog";
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

/** F7 (2026-09-13 round-2 review): the F4 test below (~line 230ish)
 *  permanently overrides `askParams`'s resolved value with a Promise that
 *  never settles — `vi.clearAllMocks()` clears CALL history, not this
 *  implementation override, and there is no `restoreMocks`/`mockReset` in
 *  `vitest.config.ts`, so without this the next test added to either
 *  describe below that awaits a real `askParams()` call would hang for the
 *  full 20s timeout. Restored explicitly every test, same as the `status`
 *  reset the second describe already added for the identical leaked-state
 *  reason. Sabotage: delete this line and add any test after the F4 one
 *  that calls `runExportSpatialPageCommand` again — it times out. */
function resetAskParamsMock(): void {
  vi.mocked(askParams).mockResolvedValue({ fmt: "pdf", dpi: 300 });
}

describe("runExportSpatialPageCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAskParamsMock(); // F7 — see this function's own doc
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
    resetAskParamsMock(); // F7 — see this function's own doc
    // N8 (2026-09-13 round-2 review): explicit, not just incidental — this
    // file has no real `useToasts` store to reset (`toast` is replaced
    // wholesale by the `toastSpy` shim above), so the "no toast" assertions
    // below rely on `vi.clearAllMocks()` also clearing `toastSpy`'s call
    // history. That is true today but easy to break quietly (e.g. a future
    // `mockImplementationOnce` that isn't a plain call-tracking `vi.fn()`
    // anymore); make the reset explicit here alongside `status`'s.
    toastSpy.mockClear();
    usePendingOps.setState({ ops: [] });
    useApp.setState({
      // Reset explicitly (not just merged datasets/composition below): a
      // status left over from a PRIOR test in this file would otherwise
      // make a same-string assertion here a false positive that doesn't
      // exercise this test's own code path at all — exactly the gap that
      // let the F3 "resolving panel datasets" cancel-status test below pass
      // even while sabotaged, until this reset was added.
      status: "",
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

  // F3 (2026-09-13 adversarial review of d6e67fb7): a cancel landing WHILE
  // resolving a panel's dataset used to hit a bare `if (aborted) return;`
  // with no status/toast at all (exportActive.ts's own copy of this bug is
  // covered by its own test file; this is the exportPageCommand.ts copy).
  it("sets a cancelled status when cancel lands while resolving panel datasets (not silent)", async () => {
    type Ds = ReturnType<typeof useApp.getState>["datasets"][number];
    let resolveDs!: (v: Ds | undefined) => void;
    useApp.setState({
      resolveDataset: vi.fn(() => new Promise<Ds | undefined>((r) => (resolveDs = r))),
    });

    const p = runExportSpatialPageCommand(useApp.getState);
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));

    usePendingOps.getState().ops[0].cancel!();
    resolveDs(useApp.getState().datasets[0]); // resolves AFTER the cancel
    await p;

    expect(exportFigurePage).not.toHaveBeenCalled();
    expect(useApp.getState().status).toBe("export cancelled");
    expect(toastSpy).not.toHaveBeenCalled();
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  // F4 (2026-09-13 adversarial review of d6e67fb7): `beginOp` used to run
  // BEFORE `askParams`, so a pendingOp (and its Cancel control) existed for
  // the whole time the dialog was open — a control that was actually
  // unreachable in the real DOM, since ParamDialog's backdrop `onMouseDown`
  // resolves the dialog with `null` on any click behind it, including one
  // aimed at a Cancel control drawn under that backdrop. Sabotage: move
  // `beginOp` back above the `askParams` call and this fails (ops.length > 0
  // while the mocked dialog is still pending).
  // F6 (2026-09-13 round-2 review): this used to poll for the mocked dialog
  // function having been invoked, wrapped the way `vi.mocked` wraps a mock —
  // a weak-wait shape that evaded architecture.test.ts's ratchet only
  // because that regex required a BARE identifier inside `expect(...)`, not
  // a wrapped one (fixed alongside this, in architecture.test.ts itself).
  // Rewritten to await a deferred that `askParams`'s own mock resolves —
  // real synchronisation on the dialog actually having been opened, not a
  // poll for "was the mock called yet".
  it("registers no pendingOp while the params dialog is open (prompt precedes beginOp)", async () => {
    let resolveParams!: (v: { fmt: string; dpi: number } | null) => void;
    let dialogOpened!: () => void;
    const opened = new Promise<void>((r) => (dialogOpened = r));
    vi.mocked(askParams).mockImplementation(() => {
      dialogOpened();
      return new Promise((r) => (resolveParams = r));
    });

    const p = runExportSpatialPageCommand(useApp.getState);
    await opened;
    expect(usePendingOps.getState().ops).toHaveLength(0);

    resolveParams(null); // user cancels the dialog itself
    await p;
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });
});
