// BUGS_AND_ISSUES BUG-001, automated-test checklist items 1-3, end to end
// through the ACTUAL render pipeline (not just the pure helpers `lib/plotdata
// .test.ts` and `lib/errorbars.test.ts` already pin in isolation): an NCNR
// reductus `.refl` import's declared roles -- `metadata.default_value_channels`
// (parser) feeding `Dataset.errorRoles` (`store/importErrorRoles.ts`'s
// `parserErrorRoles`) -- must, once this hook renders them, produce (1) only
// the measured channel as a plotted series, (2) no standalone uncertainty/
// resolution series, and (3) a vertical (y) span for the uncertainty and a
// horizontal (x) span for the resolution, on that one plotted column.
//
// `fetchPlot` is mocked to delegate to the REAL `buildColumns` -- the same
// offline fallback a backend-less run already exercises -- so this isolates
// the hook's OWN wiring (effectiveChannels -> plotted -> buildErrorSpans) from
// network variance, matching the established pattern in
// `usePlotPayload.quickFigureParity.test.ts`.

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { importFile } from "../../lib/api";
import { probeSource } from "../../lib/desktopBridge";
import type { ErrorBinding } from "../../lib/errorRoles";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { usePlotPayload, type PlotPayloadParams } from "./usePlotPayload";

vi.mock("../../lib/plotdata", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/plotdata")>();
  return {
    ...actual,
    fetchPlot: async (
      ds: Parameters<typeof actual.buildColumns>[0],
      _yLog: boolean,
      _xLog: boolean,
      yKeys: number[] | null,
      y2Keys: number[] | null,
      xKey: number | null,
    ) => actual.buildColumns(ds, y2Keys, xKey, yKeys),
  };
});

// items 1-2 below also touch the STORE (import + override), unlike the items
// 1-3 block above which hands the hook a plain, hand-built Dataset -- so
// these two need the store's own api/desktopBridge mocks (the same ones
// `store/importDatasets.test.ts` uses for `importPaths`).
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  importFile: vi.fn(),
  uploadFile: vi.fn(),
}));
vi.mock("../../lib/desktopBridge", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  probeSource: vi.fn(),
}));

// The EXACT shape `quantized.io.ncnr._refl_role_metadata` declares for a
// reductus `.refl`: Qz -> time, three value channels, only the first
// (Intensity) in `default_value_channels`, symmetric Y error on it from
// `uncertainty`, symmetric X error (Q resolution) from `resolution`.
const errorRoles: ErrorBinding[] = [
  { channel: 1, target: 0, axis: "y", side: "both" },
  { channel: 2, target: -1, axis: "x", side: "both" },
];

const refl: Dataset = {
  id: "refl-1",
  name: "S3_6500e_From700mT.refl",
  data: {
    time: [0.01, 0.02, 0.03],
    values: [
      [100, 5, 0.001],
      [90, 4.5, 0.001],
      [80, 4, 0.001],
    ],
    labels: ["Intensity", "uncertainty", "resolution"],
    units: ["counts", "counts", "1/Ang"],
    metadata: { default_value_channels: [0] },
  },
  errorRoles,
};

function params(overrides: Partial<PlotPayloadParams> = {}): PlotPayloadParams {
  return {
    active: refl,
    yScale: "log", // reflectometry is always plotted log-Y
    xScale: "linear",
    xKey: null,
    yKeys: null, // untouched default -- must resolve via defaultDenseChannels
    groupKey: null,
    y2Keys: null,
    seriesOrder: null,
    seriesStyles: {},
    seriesLabels: {},
    errKeys: {},
    hiddenChannels: [],
    waterfall: 0,
    excludedDisplay: "hide",
    fitOverlay: null,
    baselineOverlay: null,
    peakOverlay: null,
    derivOverlay: null,
    selection: null,
    xLim: null,
    ...overrides,
  };
}

describe("usePlotPayload — NCNR .refl declared roles render correctly (BUG-001)", () => {
  it("plots only the measured channel; uncertainty/resolution never appear as series", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params(),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());

    expect(result.current.plotted).toEqual([0]);
    expect(result.current.displayPayload!.series).toEqual([
      { label: "Intensity", unit: "counts", axis: 0 },
    ]);
    const labels = result.current.displayPayload!.series.map((s) => s.label);
    expect(labels).not.toContain("uncertainty");
    expect(labels).not.toContain("resolution");
  });

  it("draws a VERTICAL span from the uncertainty binding and a HORIZONTAL span from the resolution binding", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params(),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());

    // Column 1 = uPlot's index for the sole plotted series (column 0 is x).
    const spans = result.current.errorSpans.get(1);
    expect(spans).toBeDefined();
    const y = spans!.find((s) => s.axis === "y");
    const x = spans!.find((s) => s.axis === "x");
    expect(y).toBeDefined(); // vertical whisker
    expect(x).toBeDefined(); // horizontal whisker
    expect(y!.plus).toEqual([5, 4.5, 4]); // the uncertainty column's own values
    expect(x!.plus).toEqual([0.001, 0.001, 0.001]); // the resolution column's own values
  });

  it("keeps the log-Y scale request intact -- the uncertainty binding never alters the underlying data", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params(),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());

    // The measured channel's own plotted values are exactly the source data,
    // untouched by the fact that a vertical whisker will extend below some of
    // these points on a log axis (the plugin, not this hook, decides how a
    // non-positive whisker end is drawn -- see uplotOverlays.test.ts).
    expect(result.current.displayPayload!.data[1]).toEqual([100, 90, 80]);
  });
});

// BUGS_AND_ISSUES BUG-001, implementation checklist item 1 ("Keep every role
// overridable through the import/error-column UI"): generic override
// coverage pre-existed in ErrorRolesCard.test.tsx, but never against an NCNR
// `.refl`'s ACTUAL declared roles, and never through to the rendered plot.
// This imports a real NCNR-reductus-shaped file through the real store
// (`useApp.importPaths`, mocked at the `importFile` boundary -- the values
// below are the fixture's own first five rows, from
// `tests/golden/ncnr_j395_default.json`, the frozen parse of
// `tests/fixtures/ncnr_j395.refl`), confirms the roles the parser declared
// land on the dataset, then overrides ONE of them through
// `useApp.getState().setErrorRoles` -- the EXACT action
// `ErrorRolesCard.tsx`'s Select `onChange` handlers call (see its `patch`
// helper: `setErrorRoles(active.id, roles.map((r, k) => k === i ? {...r,
// ...next} : r))`) -- and confirms both that the override wins in the store
// AND that the next render of the real hook draws accordingly.
describe("NCNR .refl error roles are overridable through the store action ErrorRolesCard calls (BUG-001 checklist item 1)", () => {
  // The parser's OWN declared roles for this file
  // (`quantized.io.ncnr._refl_role_metadata`, pinned by
  // `test_refl_declares_uncertainty_and_resolution_roles` in
  // `tests/test_io_ncnr.py`): symmetric Y error on Intensity from
  // `uncertainty`, symmetric X error (Q resolution) from `resolution`.
  const declaredRoles: ErrorBinding[] = [
    { channel: 1, target: 0, axis: "y", side: "both" },
    { channel: 2, target: -1, axis: "x", side: "both" },
  ];

  const reflPayload = () => ({
    // The fixture's own first five rows (Qz, Intensity, uncertainty,
    // resolution) -- real numbers, not synthesized, so this is genuinely
    // "the NCNR .refl fixture", not a shape lookalike.
    time: [0.0074473497059, 0.0078680679047, 0.008342898412, 0.0088334445027, 0.009338185424],
    values: [
      [1.086612118, 0.020429255703, 0.00091856511932],
      [1.07206817, 0.011740351611, 0.00095669551269],
      [1.0641516064, 0.0093020629222, 0.00097803208734],
      [1.0518306308, 0.0074678843633, 0.0010077631213],
      [1.044353347, 0.0065797453572, 0.0010242748316],
    ],
    labels: ["Intensity", "uncertainty", "resolution"],
    units: ["counts", "counts", "1/Ang"],
    metadata: {
      x_column_name: "Qz",
      parser_name: "import_ncnr_refl",
      default_value_channels: [0],
      error_roles: declaredRoles,
      error_channels: { 0: 1 },
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useApp.setState({ datasets: [], folders: [], activeId: null, selectedIds: [], plotWindows: [] });
    vi.mocked(importFile).mockResolvedValue(reflPayload());
    vi.mocked(probeSource).mockResolvedValue(null);
  });

  it("imports with the parser-declared roles, then a store-action override wins over them", async () => {
    await useApp.getState().importPaths(["/data/j395.refl"]);
    const id = useApp.getState().datasets[0].id;

    // Confirm the inferred/declared roles landed exactly as the parser says.
    expect(useApp.getState().datasets[0].errorRoles).toEqual(declaredRoles);

    // Override ONE role through the identical store action
    // ErrorRolesCard.tsx's Side <Select> calls: `patch(1, { side: "+" })`.
    const roles = useApp.getState().datasets[0].errorRoles!;
    const overridden = roles.map((r, k) => (k === 1 ? { ...r, side: "+" as const } : r));
    useApp.getState().setErrorRoles(id, overridden);

    // The override wins -- it is NOT the declared side, and it is NOT
    // silently reverted by anything else touching the dataset.
    expect(useApp.getState().datasets[0].errorRoles).toEqual(overridden);
    expect(useApp.getState().datasets[0].errorRoles![1].side).toBe("+");
    expect(useApp.getState().datasets[0].errorRoles).not.toEqual(declaredRoles);
  });

  it("the overridden role changes what the NEXT render of the real plot payload draws", async () => {
    await useApp.getState().importPaths(["/data/j395.refl"]);
    const id = useApp.getState().datasets[0].id;
    const roles = useApp.getState().datasets[0].errorRoles!;
    // A lone "+" with no matching "-" is an INCOMPLETE asymmetric pair --
    // `asymmetricPair`/`buildErrorSpans` (lib/errorbars.ts) draw nothing for
    // it rather than invent the missing half. So this override should make
    // the resolution's horizontal (x) whisker disappear from the payload
    // entirely, while the unrelated Y (uncertainty) whisker is untouched.
    useApp.getState().setErrorRoles(id, roles.map((r, k) => (k === 1 ? { ...r, side: "+" as const } : r)));

    const overriddenDataset = useApp.getState().datasets[0];
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params({ active: overriddenDataset }),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());

    expect(result.current.plotted).toEqual([0]); // still only the measured channel
    const spans = result.current.errorSpans.get(1) ?? [];
    const x = spans.find((s) => s.axis === "x");
    const y = spans.find((s) => s.axis === "y");
    expect(x).toBeUndefined(); // the override broke the X pair -- no horizontal whisker now
    expect(y).toBeDefined(); // the untouched Y (uncertainty) binding still draws
    expect(y!.plus).toEqual([0.020429255703, 0.011740351611, 0.0093020629222, 0.0074678843633, 0.0065797453572]);
  });
});

// BUGS_AND_ISSUES BUG-001, the last code-verifiable checklist box: "plot-
// window rebinding (dragging/dropping a dataset onto an existing plot
// window) preserves the declared error roles" -- previously open in the
// item's own Completion record ("plot-window-rebinding preservation of the
// declared roles ... remains unverified"). `rebindWindow` (store/windows.ts)
// is the EXPLICIT drop gesture: it threads `errors: ds?.errorRoles,
// resetErrors: true` into `syncPlotWindow` (store/windowDocuments.ts) for
// BOTH the focused-window path (`focusedRebindPatch`) and the background-
// window path, reading the dataset's CURRENT `errorRoles` off the store at
// rebind time -- not a stale value captured at import. This pins that wiring
// end to end (dataset -> window.document.bindings.errors -> the rendered
// payload) through the real `rebindWindow` action, on the real NCNR .refl
// fixture, mirroring the import-then-assert pattern the describe block above
// already established.
describe("rebindWindow (drag/drop) preserves an NCNR .refl's declared error roles (BUG-001, plot-window rebinding)", () => {
  const declaredRoles: ErrorBinding[] = [
    { channel: 1, target: 0, axis: "y", side: "both" },
    { channel: 2, target: -1, axis: "x", side: "both" },
  ];

  const reflPayload = () => ({
    time: [0.0074473497059, 0.0078680679047, 0.008342898412, 0.0088334445027, 0.009338185424],
    values: [
      [1.086612118, 0.020429255703, 0.00091856511932],
      [1.07206817, 0.011740351611, 0.00095669551269],
      [1.0641516064, 0.0093020629222, 0.00097803208734],
      [1.0518306308, 0.0074678843633, 0.0010077631213],
      [1.044353347, 0.0065797453572, 0.0010242748316],
    ],
    labels: ["Intensity", "uncertainty", "resolution"],
    units: ["counts", "counts", "1/Ang"],
    metadata: {
      x_column_name: "Qz",
      parser_name: "import_ncnr_refl",
      default_value_channels: [0],
      error_roles: declaredRoles,
      error_channels: { 0: 1 },
    },
  });

  // An ordinary dataset with no error roles at all -- "opens a plot window
  // on one dataset" (the pre-rebind state a drop target starts from).
  const plainDataset: Dataset = {
    id: "plain-1",
    name: "plain.dat",
    data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["Y"], units: [""], metadata: {} },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useApp.setState({
      datasets: [],
      folders: [],
      activeId: null,
      selectedIds: [],
      plotWindows: [],
      focusedWindowId: null,
    });
    vi.mocked(importFile).mockResolvedValue(reflPayload());
    vi.mocked(probeSource).mockResolvedValue(null);
  });

  it("a FOCUSED window's rebind onto the NCNR dataset carries its declared roles into the window's own payload", async () => {
    // Import the NCNR dataset FIRST, while no window exists, so import's OWN
    // passive rebind (addDataset -> rebindFocusedPlotWindow) has nothing to
    // touch -- the only rebind this test exercises is the EXPLICIT one below.
    await useApp.getState().importPaths(["/data/j395.refl"]);
    const ncnrId = useApp.getState().datasets[0].id;

    useApp.getState().addDataset(plainDataset);
    const winId = useApp.getState().createWindow(plainDataset.id);
    useApp.getState().focusWindow(winId);
    expect(useApp.getState().plotWindows.find((w) => w.id === winId)?.datasetId).toBe(plainDataset.id);

    // The explicit drag/drop gesture under test.
    useApp.getState().rebindWindow(winId, ncnrId);

    const win = useApp.getState().plotWindows.find((w) => w.id === winId)!;
    expect(win.datasetId).toBe(ncnrId);
    expect(win.document?.bindings.errors).toEqual(declaredRoles);

    // And the window's own PAYLOAD, not just the store record, actually
    // draws from them -- feed usePlotPayload the same `documentErrors`
    // PlotStage threads for the focused window (window.document.bindings.errors).
    const ncnrDataset = useApp.getState().datasets.find((d) => d.id === ncnrId)!;
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params({ active: ncnrDataset, documentErrors: win.document?.bindings.errors }),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
    expect(result.current.plotted).toEqual([0]);
    const spans = result.current.errorSpans.get(1) ?? [];
    expect(spans.find((s) => s.axis === "y")).toBeDefined(); // uncertainty -> vertical whisker
    expect(spans.find((s) => s.axis === "x")).toBeDefined(); // resolution -> horizontal whisker
  });

  it("a BACKGROUND (unfocused) window's rebind onto the NCNR dataset also carries its declared roles, without touching focus", async () => {
    await useApp.getState().importPaths(["/data/j395.refl"]);
    const ncnrId = useApp.getState().datasets[0].id;

    useApp.getState().addDataset(plainDataset);
    const focusedWinId = useApp.getState().createWindow(plainDataset.id);
    useApp.getState().focusWindow(focusedWinId);
    const bgWinId = useApp.getState().createWindow(plainDataset.id); // stays unfocused
    expect(useApp.getState().focusedWindowId).toBe(focusedWinId);

    // This exercises rebindWindow's OTHER branch (store/windows.ts:
    // `windowId === s.focusedWindowId ? ... : ...`).
    useApp.getState().rebindWindow(bgWinId, ncnrId);

    const bgWin = useApp.getState().plotWindows.find((w) => w.id === bgWinId)!;
    expect(bgWin.datasetId).toBe(ncnrId);
    expect(bgWin.document?.bindings.errors).toEqual(declaredRoles);
    // Rebinding the background window never touched focus or the OTHER window.
    expect(useApp.getState().focusedWindowId).toBe(focusedWinId);
    expect(useApp.getState().plotWindows.find((w) => w.id === focusedWinId)?.datasetId).toBe(plainDataset.id);
  });

  it("an explicit setErrorRoles override made BEFORE the rebind survives it (the dataset's CURRENT roles win, not the parser default)", async () => {
    await useApp.getState().importPaths(["/data/j395.refl"]);
    const ncnrId = useApp.getState().datasets[0].id;

    // Override ONE declared role on the NCNR dataset itself -- the same
    // action ErrorRolesCard.tsx calls -- BEFORE the dataset is ever dropped
    // onto a window.
    const overridden = declaredRoles.map((r, k) => (k === 1 ? { ...r, side: "+" as const } : r));
    useApp.getState().setErrorRoles(ncnrId, overridden);
    expect(useApp.getState().datasets.find((d) => d.id === ncnrId)?.errorRoles).toEqual(overridden);

    useApp.getState().addDataset(plainDataset);
    const winId = useApp.getState().createWindow(plainDataset.id);
    useApp.getState().focusWindow(winId);

    useApp.getState().rebindWindow(winId, ncnrId);

    const win = useApp.getState().plotWindows.find((w) => w.id === winId)!;
    // The OVERRIDE landed on the window, not the parser's original declaration.
    expect(win.document?.bindings.errors).toEqual(overridden);
    expect(win.document?.bindings.errors).not.toEqual(declaredRoles);
  });
});
