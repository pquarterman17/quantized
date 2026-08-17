// PR F, L0.36/L0.38: the worksheet-row Quick Plot / Configure Quick Plot…
// menu entries.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { actionMenuItem, type ContextAction, type DatasetActionTarget } from "./contextActions";
import { datasetQuickPlotActions } from "./quickPlotActions";
import type { Dataset } from "./types";
import { useApp } from "../store/useApp";
import type { ContextMenuItem } from "../components/overlays/ContextMenu";

function dataset(id: string, technique = "magnetometry.mvsh"): Dataset {
  return {
    id,
    name: `${id}.dat`,
    data: {
      time: [0, 1, 2],
      values: [[1, 10], [2, 20], [3, 30]],
      labels: ["A", "B"],
      units: ["", ""],
      metadata: { technique },
    },
  };
}

function target(ds: Dataset, extra: Partial<DatasetActionTarget> = {}): DatasetActionTarget {
  return {
    dataset: ds,
    active: false,
    selected: false,
    selectedIds: [],
    canMoveUp: false,
    canMoveDown: false,
    onRename: () => {},
    onAddTag: () => {},
    ...extra,
  };
}

type ActionMenuItem = Extract<ContextMenuItem, { run: () => void }>;
function menuItemFor<T>(a: ContextAction<T>, t: T): ActionMenuItem {
  return actionMenuItem(a, t) as ActionMenuItem;
}

const find = (id: string) => datasetQuickPlotActions.find((a) => a.id === id)!;

beforeEach(() => {
  useApp.setState({ datasets: [], editableFigures: [], plotWindows: [], history: [], status: "" });
});

describe("dataset.quickPlot", () => {
  it("enabled for a recognized, plottable dataset", () => {
    const ds = dataset("d1");
    const item = menuItemFor(find("dataset.quickPlot"), target(ds));
    expect(item.disabled).toBe(false);
    expect(item.title).toBeUndefined();
  });

  it("disabled with the precise unrecognized-technique reason", () => {
    const ds = dataset("d1", "generic");
    const item = menuItemFor(find("dataset.quickPlot"), target(ds));
    expect(item.disabled).toBe(true);
    expect(item.title).toBe(
      "unrecognized data — Configure Quick Plot arrives with the Quick Figure Builder (PR G)",
    );
  });

  it("disabled with the precise no-plottable-columns reason", () => {
    const base = dataset("d1");
    const ds: Dataset = { ...base, data: { ...base.data, values: [[NaN, NaN], [NaN, NaN], [NaN, NaN]] } };
    const item = menuItemFor(find("dataset.quickPlot"), target(ds));
    expect(item.disabled).toBe(true);
    expect(item.title).toBe("no plottable columns in this worksheet");
  });

  // Review fix #1: a single real channel (one labels entry) plotted against
  // time IS available -- no more "bare column" gate.
  it("a single-channel dataset IS enabled (fix #1)", () => {
    const base = dataset("d1");
    const ds: Dataset = { ...base, data: { ...base.data, values: [[1], [2], [3]], labels: ["A"], units: [""] } };
    const item = menuItemFor(find("dataset.quickPlot"), target(ds));
    expect(item.disabled).toBe(false);
  });

  it("run() calls through to quickPlotDataset and invokes onStageOpen on success", () => {
    const ds = dataset("d1");
    useApp.setState({ datasets: [ds] });
    const onStageOpen = vi.fn();
    const item = menuItemFor(find("dataset.quickPlot"), target(ds, { onStageOpen }));
    item.run();
    expect(useApp.getState().editableFigures).toHaveLength(1);
    expect(useApp.getState().editableFigures[0].bindings.datasetId).toBe("d1");
    expect(onStageOpen).toHaveBeenCalledOnce();
  });

  // Review fix #6 (red-first): quickPlotDataset returns false on a
  // fail-closed refusal -- run() must NOT invoke onStageOpen in that case
  // (there is nothing to return the Stage to). The disabled menu item
  // normally prevents this click, but `run` stays dispatchable on a
  // disabled item (the registry convention -- actionMenuItem's own doc),
  // so the guard has to hold even when called directly.
  it("run() does NOT invoke onStageOpen when quickPlotDataset fails closed (fix #6)", () => {
    const ds = dataset("d1", "generic"); // unrecognized -> quickPlotDataset refuses
    useApp.setState({ datasets: [ds] });
    const onStageOpen = vi.fn();
    const item = menuItemFor(find("dataset.quickPlot"), target(ds, { onStageOpen }));
    item.run();
    expect(useApp.getState().editableFigures).toHaveLength(0);
    expect(onStageOpen).not.toHaveBeenCalled();
  });
});

describe("dataset.configureQuickPlot", () => {
  it("opens the Quick Figure Builder for recognized or unknown data without plotting", () => {
    const ds = dataset("d1", "generic");
    useApp.setState({ datasets: [ds], quickFigureBuilderDatasetId: null });
    const item = menuItemFor(find("dataset.configureQuickPlot"), target(ds));
    expect(item.disabled).toBe(false);
    item.run();
    expect(useApp.getState().quickFigureBuilderDatasetId).toBe("d1");
    expect(useApp.getState().editableFigures).toEqual([]);
  });
});

describe("dataset.quickPlotWith (PR H, L0.37)", () => {
  beforeEach(() => {
    useApp.setState({ quickPlotTemplates: [] });
  });

  it("hidden (via actionMenuItem returning null) when zero templates exist", () => {
    const ds = dataset("d1");
    const item = actionMenuItem(find("dataset.quickPlotWith"), target(ds));
    expect(item).toBeNull();
  });

  it("shown once a template exists", () => {
    useApp.setState({
      quickPlotTemplates: [
        {
          id: "qpt-1",
          name: "T",
          createdAt: "x",
          modifiedAt: "x",
          scope: { kind: "schema" },
          technique: "magnetometry.mvsh",
          signature: { channels: [] },
          mapping: { xKey: null, yKeys: [0], errorBindings: [], ignoredKeys: [] },
          style: "line",
          labels: {},
        },
      ],
    });
    const ds = dataset("d1");
    const item = actionMenuItem(find("dataset.quickPlotWith"), target(ds));
    expect(item).not.toBeNull();
  });
});
