import { beforeEach, describe, expect, it, vi } from "vitest";

import { askParams } from "../components/overlays/ParamDialog";
import { exportFigurePage } from "./api";
import { spatialComposition } from "./composition";
import { GREYSCALE_FIELD } from "./exportFigureCommand";
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

/** F7 (2026-09-13 round-2 review; completed in round 3): tests below
 *  permanently override THREE things `vi.clearAllMocks()` does not restore
 *  (it clears CALL history, not implementations, and there is no
 *  `restoreMocks`/`mockReset` in `vitest.config.ts`): the F4 test resolves
 *  `askParams` with a Promise that never settles; two cancel tests give
 *  `exportFigurePage` a never-settling implementation; and the
 *  resolve-race test writes a never-settling `resolveDataset` into the app
 *  store, which Zustand's merging `setState` then LEAKS into every later
 *  test. Any test appended after them that awaits a real
 *  `runExportSpatialPageCommand` would hang for the full 20 s timeout; the
 *  round-3 reviewer showed that restoring `askParams` alone (round 2's fix)
 *  still hangs — either of the other two leaks alone is enough. All three
 *  are restored every test, the same pattern `exportActive.test.ts` uses
 *  for `defaultResolveDataset`. Sabotage: drop any ONE of the three
 *  restores and append a test after the F4 one that calls
 *  `runExportSpatialPageCommand` — it times out. */
const defaultResolveDataset = useApp.getState().resolveDataset;
function resetLeakedMocks(): void {
  vi.mocked(askParams).mockResolvedValue({ fmt: "pdf", dpi: 300 });
  vi.mocked(exportFigurePage).mockResolvedValue(undefined);
  useApp.setState({ resolveDataset: defaultResolveDataset });
}

describe("runExportSpatialPageCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLeakedMocks(); // F7 — see this function's own doc
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

// PRIMARY_SOFTWARE_AUDIT_PLAN P3.3 residual close: "page-route greyscale is
// API-only today" — the backend's `PagePanel.greyscale` was already honored
// (calc/figure_page.py, routes/export_page.py), but this dialog offered only
// fmt/dpi, with no way to reach it from the UI. Closed by reusing
// lib/exportFigureCommand.ts's own GREYSCALE_FIELD (never duplicating the
// label/hint) and threading the answer onto EVERY panel's own figure spec —
// one page-level choice, since this dialog has no per-panel affordance.
describe("runExportSpatialPageCommand — P3.3 greyscale residual (page export)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLeakedMocks(); // F7 — see this function's own doc
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
      // TWO panels — "every panel" is not vacuously true with just one.
      composition: spatialComposition([
        {
          datasetId: "d1",
          xKey: null,
          yKeys: [0],
          xLim: [0, 1],
          yLim: [1, 2],
          xLog: false,
          yLog: false,
          row: 0,
          col: 0,
          pageRect: { left: 0.05, top: 0.05, width: 0.4, height: 0.4 },
        },
        {
          datasetId: "d1",
          xKey: null,
          yKeys: [0],
          xLim: [0, 1],
          yLim: [1, 2],
          xLog: false,
          yLog: false,
          row: 0,
          col: 1,
          pageRect: { left: 0.55, top: 0.05, width: 0.4, height: 0.4 },
        },
      ]),
      pageSetup: defaultPageSetup(),
      xFmt: { mode: "auto", digits: 2 },
      yFmt: { mode: "auto", digits: 2 },
      showGrid: true,
      showAxisBox: false,
    });
  });

  it("offers a greyscale field matching the single-figure dialog's own definition", async () => {
    await runExportSpatialPageCommand(useApp.getState);
    const fields = vi.mocked(askParams).mock.calls[0][1];
    const field = fields.find((f) => f.key === "greyscale");
    expect(field).toEqual(GREYSCALE_FIELD);
  });

  it("threads greyscale: true onto EVERY panel's figure spec when the checkbox is on", async () => {
    vi.mocked(askParams).mockResolvedValueOnce({ fmt: "pdf", dpi: 300, greyscale: true });
    await runExportSpatialPageCommand(useApp.getState);
    const body = vi.mocked(exportFigurePage).mock.calls[0][0];
    expect(body.panels).toHaveLength(2);
    expect(body.panels[0].figure.greyscale).toBe(true);
    expect(body.panels[1].figure.greyscale).toBe(true);
  });

  it("omits greyscale from every panel when the dialog's default (false) goes unchanged", async () => {
    vi.mocked(askParams).mockResolvedValueOnce({ fmt: "pdf", dpi: 300, greyscale: false });
    await runExportSpatialPageCommand(useApp.getState);
    const body = vi.mocked(exportFigurePage).mock.calls[0][0];
    expect("greyscale" in body.panels[0].figure).toBe(false);
    expect("greyscale" in body.panels[1].figure).toBe(false);
  });

  it("omits greyscale from every panel when the dialog result carries no greyscale key at all", async () => {
    vi.mocked(askParams).mockResolvedValueOnce({ fmt: "pdf", dpi: 300 });
    await runExportSpatialPageCommand(useApp.getState);
    const body = vi.mocked(exportFigurePage).mock.calls[0][0];
    expect("greyscale" in body.panels[0].figure).toBe(false);
    expect("greyscale" in body.panels[1].figure).toBe(false);
  });
});

// PRIMARY_SOFTWARE_AUDIT_PLAN P3.4 (safe cancel for long export operations) —
// the "page" export kind. This command does NOT route through
// lib/exportActive.ts's shared chokepoint (see its own header), so it is
// covered separately rather than by exportActive.test.ts.
describe("runExportSpatialPageCommand — safe cancel (P3.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLeakedMocks(); // F7 — see this function's own doc
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
