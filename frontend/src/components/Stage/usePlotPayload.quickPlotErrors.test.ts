// LIBRARY_WORKBOOK_UX_PLAN acceptance scenario: "Right-click a recognized
// shared-X worksheet with Y error columns: errors attach to the correct
// series." Driven end to end: the worksheet row's real "Quick Plot" context
// action creates the figure, and the created window's own view + document
// errors are fed through the actual render hook, exactly as the focused
// Stage does. Before the fix, `datasetViewDefaults` (Quick Plot's canonical
// mapping) never read `Dataset.errorRoles`, so a role-bound error column --
// one not stated by an Origin designation or an `error_channels` hint -- was
// drawn as its own curve beside the series it describes.
//
// `fetchPlot` delegates to the REAL `buildColumns` (the offline fallback), the
// same isolation `usePlotPayload.errorRoles.test.ts` (BUG-001) uses.

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextAction, DatasetActionTarget } from "../../lib/contextActions";
import type { ErrorBinding } from "../../lib/errorRoles";
import type { PlotView } from "../../lib/plotview";
import { CONFIGURE_QUICK_PLOT_REASON, quickPlotFigureSeed } from "../../lib/quickPlot";
import { datasetQuickPlotActions } from "../../lib/quickPlotActions";
import { initialQuickFigureMapping } from "../../lib/quickFigureMappingActions";
import type { Dataset } from "../../lib/types";
import { seedErrorRoles } from "../../store/importErrorRoles";
import { useApp } from "../../store/useApp";
import { datasetViewDefaults } from "../../store/windowDefaults";
import { plotWindowView } from "../../store/windowDocuments";
import { usePlotPayload } from "./usePlotPayload";

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

/** A worksheet as a real file import builds it: `seedErrorRoles` is the
 *  import path's own role seeding (Origin > parser > label inference). */
function imported(id: string, labels: string[], values: number[][], technique = "magnetometry.mvsh"): Dataset {
  const data = {
    time: values.map((_, i) => i),
    values,
    labels,
    units: labels.map(() => ""),
    metadata: technique ? { technique } : {},
  };
  return { id, name: `${id}.dat`, data, ...seedErrorRoles(data) };
}

function target(ds: Dataset): DatasetActionTarget {
  return {
    dataset: ds,
    active: false,
    selected: false,
    selectedIds: [],
    canMoveUp: false,
    canMoveDown: false,
    onRename: () => {},
    onAddTag: () => {},
  };
}

const quickPlot = datasetQuickPlotActions.find((a) => a.id === "dataset.quickPlot") as ContextAction<DatasetActionTarget>;

/** Right-click -> Quick Plot, then read back what the new window holds. */
function rightClickQuickPlot(ds: Dataset): { view: PlotView; errors: ErrorBinding[] } {
  useApp.setState({ datasets: [ds] });
  const t = target(ds);
  expect(quickPlot.enabled?.(t)).toBe(true);
  quickPlot.run(t);
  const { editableFigures, plotWindows } = useApp.getState();
  expect(editableFigures).toHaveLength(1);
  const doc = editableFigures[0];
  const win = plotWindows.find((w) => w.kind === "plot" && w.document?.id === doc.id);
  expect(win).toBeDefined();
  return { view: plotWindowView(win!), errors: doc.bindings.errors };
}

interface Drawn {
  /** Labels of the series actually drawn as curves (not legend-hidden). */
  curves: string[];
  /** Per drawn curve label: its whiskers, as the canvas would draw them. */
  whiskers: Record<string, { axis: "x" | "y"; plus: (number | null)[]; minus: (number | null)[] }[]>;
}

/** Render the window through the focused Stage's hook and report what is
 *  drawn. Rich spans outrank legacy bars per column (`lib/uplotOpts.ts`'s
 *  `legacyBars` filter), so a legacy bar only counts where no span exists. */
async function drawn(ds: Dataset, view: PlotView, documentErrors: ErrorBinding[]): Promise<Drawn> {
  const { result } = renderHook(() =>
    usePlotPayload({
      active: ds,
      yScale: view.yScale,
      xScale: view.xScale,
      xKey: view.xKey,
      yKeys: view.yKeys,
      groupKey: view.groupKey,
      y2Keys: view.y2Keys,
      seriesOrder: view.seriesOrder,
      seriesStyles: view.seriesStyles,
      seriesLabels: view.seriesLabels,
      errKeys: view.errKeys,
      documentErrors,
      hiddenChannels: view.hiddenChannels,
      waterfall: 0,
      excludedDisplay: "hide",
      fitOverlay: null,
      baselineOverlay: null,
      peakOverlay: null,
      derivOverlay: null,
      selection: null,
    }),
  );
  await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
  const { plotted, hidden, errorSpans, errorBars } = result.current;
  const out: Drawn = { curves: [], whiskers: {} };
  plotted.forEach((ch, p) => {
    if (hidden?.[p]) return;
    const label = ds.data.labels[ch];
    out.curves.push(label);
    const col = p + 1;
    const spans = errorSpans.get(col);
    const legacy = errorBars.get(col);
    if (spans) out.whiskers[label] = spans.map((s) => ({ axis: s.axis, plus: s.plus, minus: s.minus }));
    else if (legacy) out.whiskers[label] = [{ axis: "y", plus: legacy, minus: legacy }];
  });
  return out;
}

beforeEach(() => {
  useApp.setState({
    datasets: [],
    activeId: null,
    selectedIds: [],
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    techniqueViewMemory: {},
    quickPlotTemplates: [],
    history: [],
    future: [],
    status: "",
  });
});

describe("Quick Plot on a recognized shared-X worksheet binds Y error columns to their series", () => {
  it("two Y series, each with its own ± error column: two curves, each carrying its own whiskers", async () => {
    const ds = imported("shared", ["M1", "M1_err", "M2", "M2_err"], [
      [10, 1, 100, 5],
      [20, 2, 200, 6],
      [30, 3, 300, 7],
    ]);
    const { view, errors } = rightClickQuickPlot(ds);

    expect(errors).toEqual([
      { channel: 1, target: 0, axis: "y", side: "both" },
      { channel: 3, target: 2, axis: "y", side: "both" },
    ]);
    const out = await drawn(ds, view, errors);
    expect(out.curves).toEqual(["M1", "M2"]); // the error columns are never curves
    expect(out.whiskers).toEqual({
      M1: [{ axis: "y", plus: [1, 2, 3], minus: [1, 2, 3] }],
      M2: [{ axis: "y", plus: [5, 6, 7], minus: [5, 6, 7] }],
    });
  });

  it("asymmetric +/- error columns attach as ONE asymmetric whisker on their series", async () => {
    const ds = imported("asym", ["M", "M err hi", "M err lo"], [
      [10, 1, 0.5],
      [20, 2, 1],
      [30, 3, 1.5],
    ]);
    const { view, errors } = rightClickQuickPlot(ds);

    // Both halves are in the figure's own document -- the legacy errKeys
    // facade cannot express them, so the document must carry them itself.
    expect(errors).toEqual([
      { channel: 1, target: 0, axis: "y", side: "+" },
      { channel: 2, target: 0, axis: "y", side: "-" },
    ]);
    expect(view.errKeys).toEqual({});
    const out = await drawn(ds, view, errors);
    expect(out.curves).toEqual(["M"]);
    expect(out.whiskers).toEqual({ M: [{ axis: "y", plus: [1, 2, 3], minus: [0.5, 1, 1.5] }] });
  });

  it("a Y without an error column is still drawn, with no whiskers invented for it", async () => {
    const ds = imported("partial", ["M1", "M1_err", "M2"], [
      [10, 1, 100],
      [20, 2, 200],
      [30, 3, 300],
    ]);
    const { view, errors } = rightClickQuickPlot(ds);

    expect(errors).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
    const out = await drawn(ds, view, errors);
    expect(out.curves).toEqual(["M1", "M2"]);
    expect(out.whiskers).toEqual({ M1: [{ axis: "y", plus: [1, 2, 3], minus: [1, 2, 3] }] });
  });

  it("a parser-declared X error (NCNR .refl roles) lands in the document and draws on the measured series", async () => {
    const data = {
      time: [0.01, 0.02, 0.03],
      values: [
        [100, 5, 0.001],
        [90, 4.5, 0.002],
        [80, 4, 0.003],
      ],
      labels: ["Intensity", "uncertainty", "resolution"],
      units: ["counts", "counts", "1/Ang"],
      metadata: {
        technique: "reflectometry",
        default_value_channels: [0],
        error_channels: { 0: 1 },
        error_roles: [
          { channel: 1, target: 0, axis: "y", side: "both" },
          { channel: 2, target: -1, axis: "x", side: "both" },
        ],
      },
    };
    const ds: Dataset = { id: "refl", name: "S3.refl", data, ...seedErrorRoles(data) };
    const { view, errors } = rightClickQuickPlot(ds);

    expect(errors).toEqual([
      { channel: 2, target: -1, axis: "x", side: "both" },
      { channel: 1, target: 0, axis: "y", side: "both" },
    ]);
    const out = await drawn(ds, view, errors);
    expect(out.curves).toEqual(["Intensity"]);
    expect(out.whiskers).toEqual({
      Intensity: [
        { axis: "y", plus: [5, 4.5, 4], minus: [5, 4.5, 4] },
        { axis: "x", plus: [0.001, 0.002, 0.003], minus: [0.001, 0.002, 0.003] },
      ],
    });
  });

  it("an unknown CSV stays disabled: no figure, even though its labels pair an error column", () => {
    const ds = imported("unknown", ["y", "y_err"], [
      [1, 0.1],
      [2, 0.2],
    ], "");
    useApp.setState({ datasets: [ds] });
    const t = target(ds);
    expect(quickPlot.enabled?.(t)).toBe(false);
    expect(quickPlot.disabledReason?.(t)).toBe(CONFIGURE_QUICK_PLOT_REASON);
    expect(useApp.getState().quickPlotDataset(ds.id)).toBe(false);
    expect(useApp.getState().editableFigures).toHaveLength(0);
  });
});

describe("Quick Plot's error layer: one resolver, bounded scope", () => {
  const labels = ["M1", "M1_err", "M2", "M2_err"];
  const values = [
    [10, 1, 100, 5],
    [20, 2, 200, 6],
  ];

  it("pairs exactly what the Quick Figure Builder's initial mapping pairs (roles never seeded: pasted data)", () => {
    const pasted: Dataset = { ...imported("pasted", labels, values), errorRoles: undefined };
    const seed = quickPlotFigureSeed(pasted);
    const builder = initialQuickFigureMapping(pasted);
    expect(seed.errors).toEqual(builder.errorBindings);
    expect(seed.view.hiddenChannels).toEqual([1, 3]);
  });

  it("a deliberate 'checked: none' ([] roles) is honored: nothing hidden, no bindings", () => {
    const none: Dataset = { ...imported("none", labels, values), errorRoles: [] };
    const seed = quickPlotFigureSeed(none);
    expect(seed.errors).toEqual([]);
    expect(seed.view.hiddenChannels).toEqual([]);
  });

  it("a role outranks an error_channels hint on the same series, and the hint's column is hidden too", () => {
    const base = imported("hinted", ["M", "dM_old", "dM"], values.map((r) => r.slice(0, 3)));
    const ds: Dataset = {
      ...base,
      data: { ...base.data, metadata: { technique: "magnetometry.mvsh", error_channels: { 0: 1 } } },
      errorRoles: [{ channel: 2, target: 0, axis: "y", side: "both" }],
    };
    const seed = quickPlotFigureSeed(ds);
    expect(seed.view.errKeys).toEqual({ 0: 2 });
    expect(seed.view.hiddenChannels).toEqual([1, 2]);
    expect(seed.errors).toEqual([{ channel: 2, target: 0, axis: "y", side: "both" }]);
  });

  it("a remembered per-technique view still outranks the error layer (memory > defaults)", () => {
    const ds = imported("remembered", labels, values);
    const seed = quickPlotFigureSeed(ds, {
      "magnetometry.mvsh": {
        xKey: null,
        yKeys: [0, 1],
        yScale: "linear",
        xScale: "linear",
        seriesStyles: {},
        seriesLabels: {},
        seriesOrder: null,
        errKeys: {},
        hiddenChannels: [],
        labels: { 0: "M1", 1: "M1_err" },
      },
    });
    expect(seed.view.yKeys).toEqual([0, 1]);
    expect(seed.view.hiddenChannels).toEqual([]);
  });

  it("the silent import/switch rebind is untouched: without the opt-in, no role column is hidden", () => {
    const ds = imported("silent", labels, values);
    const defaults = datasetViewDefaults(ds);
    expect(defaults.hiddenChannels).toEqual([]);
    expect(defaults.errKeys).toEqual({});
  });
});
