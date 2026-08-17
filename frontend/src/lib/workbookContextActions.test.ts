// LIBRARY_WORKBOOK_UX_PLAN PR C, L0.36: disabled workbook commands render
// disabled WITH a reason (the tooltip), never removed.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  workbookCoreActions,
  workbookDeleteActions,
  workbookSourceActions,
  type WorkbookActionTarget,
} from "./workbookContextActions";
import { actionMenuItem, type ContextAction } from "./contextActions";
import { buildLibraryHierarchy, type LibraryNode } from "./libraryHierarchy";
import type { Dataset } from "./types";
import type { WorkbookNode } from "./workbooks";
import { useApp } from "../store/useApp";
import { askConfirm } from "../components/overlays/ConfirmDialog";
import type { ContextMenuItem } from "../components/overlays/ContextMenu";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

function target(
  workbook: WorkbookNode,
  datasets: Dataset[] = [],
  extra: Partial<WorkbookActionTarget> = {},
): WorkbookActionTarget {
  const hierarchy = buildLibraryHierarchy({ folders: [], workbooks: [workbook], datasets });
  const node = hierarchy.byKey.get(`workbook:${workbook.id}`) as Extract<LibraryNode, { kind: "workbook" }>;
  return { node, onRename: vi.fn(), ...extra };
}

function recognizedDataset(id: string, workbookId: string): Dataset {
  return {
    id,
    name: `${id}.dat`,
    workbookId,
    data: {
      time: [0, 1, 2],
      values: [[1, 10], [2, 20], [3, 30]],
      labels: ["A", "B"],
      units: ["", ""],
      metadata: { technique: "magnetometry.mvsh" },
    },
  };
}

const find = (id: string) => workbookCoreActions.find((a) => a.id === id) ?? workbookSourceActions.find((a) => a.id === id)!;

type ActionMenuItem = Extract<ContextMenuItem, { run: () => void }>;

/** `actionMenuItem` always returns the plain action-item variant for a real
 *  registry action (never separator/header/swatches/submenu) — narrow the
 *  return type so the tests can read `disabled`/`title` without `?.`. */
function menuItemFor<T>(a: ContextAction<T>, t: T): ActionMenuItem {
  return actionMenuItem(a, t) as ActionMenuItem;
}

beforeEach(() => {
  useApp.setState({
    workbooks: [],
    datasets: [],
    trash: [],
    history: [],
    editableFigures: [],
    workbookLastChild: {},
  });
});

describe("workbook menu — Quick Plot (PR F, L0.36)", () => {
  it("enabled for a workbook whose remembered worksheet is recognized", () => {
    const wb: WorkbookNode = { id: "w1", name: "W" };
    const d1 = recognizedDataset("d1", "w1");
    const d2 = recognizedDataset("d2", "w1");
    useApp.setState({ workbookLastChild: { w1: "worksheet:d2" } });
    const item = menuItemFor(find("workbook.quickPlot"), target(wb, [d1, d2]));
    expect(item.disabled).toBe(false);
    expect(item.title).toBeUndefined();
  });

  it("disabled with a precise reason for a generic-only workbook", () => {
    const wb: WorkbookNode = { id: "w1", name: "W" };
    const generic: Dataset = {
      ...recognizedDataset("d1", "w1"),
      data: { ...recognizedDataset("d1", "w1").data, metadata: { technique: "generic" } },
    };
    const item = menuItemFor(find("workbook.quickPlot"), target(wb, [generic]));
    expect(item.disabled).toBe(true);
    expect(item.title).toBe(
      "unrecognized data — Configure Quick Plot arrives with the Quick Figure Builder (PR G)",
    );
  });

  it("disabled for an empty workbook", () => {
    const item = menuItemFor(find("workbook.quickPlot"), target({ id: "w1", name: "W" }));
    expect(item.disabled).toBe(true);
    expect(item.title).toBe("this workbook has no worksheets");
  });

  it("run() calls through to quickPlotDataset and invokes onStageOpen when supplied", () => {
    const wb: WorkbookNode = { id: "w1", name: "W" };
    const d1 = recognizedDataset("d1", "w1");
    useApp.setState({ datasets: [d1], workbooks: [wb], history: [], editableFigures: [] });
    const onStageOpen = vi.fn();
    const item = menuItemFor(find("workbook.quickPlot"), target(wb, [d1], { onStageOpen }));
    expect(item.disabled).toBe(false);
    item.run();
    expect(useApp.getState().editableFigures).toHaveLength(1);
    expect(useApp.getState().editableFigures[0].bindings.datasetId).toBe("d1");
    expect(onStageOpen).toHaveBeenCalledOnce();
  });

  it("Configure Quick Plot… is always disabled with the PR G stub reason", () => {
    const item = menuItemFor(find("workbook.configureQuickPlot"), target({ id: "w1", name: "W" }));
    expect(item.disabled).toBe(true);
    expect(item.title).toBe("arrives with the Quick Figure Builder (PR G)");
  });
});

describe("workbook menu — disabled-with-reason items (L0.36)", () => {
  it("Browse is disabled outside Tiles with an honest availability reason", () => {
    const item = menuItemFor(find("workbook.browse"), target({ id: "w1", name: "W" }));
    expect(item.disabled).toBe(true);
    expect(item.title).toBe("available in Tiles view");
  });

  it("Browse runs the Tile workspace callback when supplied", () => {
    const onBrowse = vi.fn();
    const item = menuItemFor(find("workbook.browse"), { ...target({ id: "w1", name: "W" }), onBrowse });
    expect(item.disabled).toBe(false);
    item.run();
    expect(onBrowse).toHaveBeenCalledOnce();
  });

  it("Properties is always disabled with its PR D reason", () => {
    const item = menuItemFor(workbookSourceActions.find((a) => a.id === "workbook.properties")!, target({ id: "w1", name: "W" }));
    expect(item.disabled).toBe(true);
    expect(item.title).toBe("arrives with Details/Properties (PR D)");
  });

  it("Reveal Source is disabled with a reason when no source is recorded", () => {
    const item = menuItemFor(find("workbook.revealSource"), target({ id: "w1", name: "W" }));
    expect(item.disabled).toBe(true);
    expect(item.title).toBe("no source path recorded");
  });

  it("Reveal Source is enabled (no title) when a source path exists", () => {
    const wb: WorkbookNode = { id: "w1", name: "W", source: { kind: "path", path: "C:\\data\\w1.dat" } };
    const item = menuItemFor(find("workbook.revealSource"), target(wb));
    expect(item.disabled).toBe(false);
    expect(item.title).toBeUndefined();
  });

  it("enabled items carry no title", () => {
    const item = menuItemFor(find("workbook.open"), target({ id: "w1", name: "W" }));
    expect(item.disabled).toBe(false);
    expect(item.title).toBeUndefined();
  });
});

describe("workbook menu — Delete (destructive, confirms, names the member count)", () => {
  it("confirm names the worksheet count", () => {
    const ds: Dataset = {
      id: "d1",
      name: "d1.dat",
      workbookId: "w1",
      data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
    };
    const deleteAction = workbookDeleteActions.find((a) => a.id === "workbook.delete")!;
    const t = target({ id: "w1", name: "W" }, [ds]);
    const spec = deleteAction.confirm!(t);
    expect(spec.message).toContain("1 worksheet");
    // P1 fix: the copy must not imply the WORKBOOK itself survives restore —
    // it doesn't (deleteWorkbook removes the WorkbookNode outright).
    expect(spec.message).toContain("grouping itself is removed for good");
  });

  it("Delete renders disabled with the stable PR M reason, and even a forced run() cannot mutate (round 3)", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    useApp.setState({ workbooks: [{ id: "w1", name: "W" }], datasets: [] });
    const deleteAction = workbookDeleteActions.find((a) => a.id === "workbook.delete")!;
    const t = target({ id: "w1", name: "W" });
    expect(deleteAction.enabled?.(t)).toBe(false);
    expect(deleteAction.disabledReason?.(t)).toBe("Workbook Delete arrives with dependency-aware Trash (PR M)");
    // Registry convention keeps run() dispatchable on disabled items (the UI
    // enforces disabled) — the store action itself fails closed regardless.
    const item = menuItemFor(deleteAction, t);
    item.run();
    await Promise.resolve();
    expect(useApp.getState().workbooks).toEqual([{ id: "w1", name: "W" }]);
  });
});
