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
  useApp.setState({ datasets: [], editableFigures: [], history: [], status: "" });
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
    const ds: Dataset = { ...base, data: { ...base.data, values: [[1], [2], [3]], labels: ["A"], units: [""] } };
    const item = menuItemFor(find("dataset.quickPlot"), target(ds));
    expect(item.disabled).toBe(true);
    expect(item.title).toBe("no plottable columns in this worksheet");
  });

  it("run() calls through to quickPlotDataset and invokes onStageOpen when supplied", () => {
    const ds = dataset("d1");
    useApp.setState({ datasets: [ds] });
    const onStageOpen = vi.fn();
    const item = menuItemFor(find("dataset.quickPlot"), target(ds, { onStageOpen }));
    item.run();
    expect(useApp.getState().editableFigures).toHaveLength(1);
    expect(useApp.getState().editableFigures[0].bindings.datasetId).toBe("d1");
    expect(onStageOpen).toHaveBeenCalledOnce();
  });
});

describe("dataset.configureQuickPlot", () => {
  it("is always disabled with the PR G stub reason", () => {
    const item = menuItemFor(find("dataset.configureQuickPlot"), target(dataset("d1")));
    expect(item.disabled).toBe(true);
    expect(item.title).toBe("arrives with the Quick Figure Builder (PR G)");
  });
});
