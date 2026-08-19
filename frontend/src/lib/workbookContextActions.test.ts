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
import { useQuickPlotWithDialog } from "../store/quickPlotWithDialog";
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
    plotWindows: [],
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

  it("Configure Quick Plot… is disabled only when the workbook has no worksheets", () => {
    const item = menuItemFor(find("workbook.configureQuickPlot"), target({ id: "w1", name: "W" }));
    expect(item.disabled).toBe(true);
    expect(item.title).toBe("this workbook has no worksheets");
  });

  it("Configure Quick Plot… opens the remembered worksheet even when it is unknown", () => {
    const wb: WorkbookNode = { id: "w1", name: "W" };
    const d1 = recognizedDataset("d1", "w1");
    const unknown = { ...recognizedDataset("d2", "w1"), data: { ...d1.data, metadata: { technique: "generic" } } };
    useApp.setState({ datasets: [d1, unknown], workbooks: [wb], workbookLastChild: { w1: "worksheet:d2" } });
    const item = menuItemFor(find("workbook.configureQuickPlot"), target(wb, [d1, unknown]));
    expect(item.disabled).toBe(false);
    item.run();
    expect(useApp.getState().quickFigureBuilderDatasetId).toBe("d2");
    expect(useApp.getState().editableFigures).toEqual([]);
  });

  // Review fix #2 (CONTRACT DECISION, red-first probe): a remembered
  // worksheet that fails quickPlotAvailability refuses OUTRIGHT -- the menu
  // must show DISABLED with sheet1's specific reason, never silently plot
  // sheet2 instead. The old gate derived enabled/reason purely from
  // pickQuickPlotWorksheet's (silently-substituting) result, so this read
  // enabled:true and a run() would have plotted sheet2.
  it("a remembered generic sheet1 + a recognized sheet2: DISABLED with sheet1's reason (fix #2)", () => {
    const wb: WorkbookNode = { id: "w1", name: "W" };
    const generic: Dataset = {
      ...recognizedDataset("sheet1", "w1"),
      data: { ...recognizedDataset("sheet1", "w1").data, metadata: { technique: "generic" } },
    };
    const good = recognizedDataset("sheet2", "w1");
    useApp.setState({ workbookLastChild: { w1: "worksheet:sheet1" } });
    const item = menuItemFor(find("workbook.quickPlot"), target(wb, [generic, good]));
    expect(item.disabled).toBe(true);
    expect(item.title).toBe(
      "unrecognized data — Configure Quick Plot arrives with the Quick Figure Builder (PR G)",
    );
  });

  // Review fix #6 (red-first): `run`'s local `picked` comes from the
  // TARGET's own hierarchy snapshot (t.node.children), which can be stale
  // relative to the live store by the time a click actually fires (menu
  // built, then the dataset vanished from the store before the click lands
  // -- the same class of race L0.7's fail-closed contract exists for).
  // `picked` alone being truthy is NOT enough; quickPlotDataset's OWN
  // re-check against the live store is what actually decides success, and
  // its (false) return is what run() must gate onStageOpen on. The OLD
  // code called onStageOpen unconditionally once picked was truthy.
  it("run() does NOT invoke onStageOpen when quickPlotDataset itself fails closed, even though the local pick looked valid (fix #6)", () => {
    const wb: WorkbookNode = { id: "w1", name: "W" };
    const d1 = recognizedDataset("d1", "w1");
    // The live store's datasets no longer contains d1 -- quickPlotDataset's
    // own re-check refuses even though `t.node.children` (built from a
    // snapshot that DID include d1) still resolves a pick.
    useApp.setState({ datasets: [] });
    const onStageOpen = vi.fn();
    const item = menuItemFor(find("workbook.quickPlot"), target(wb, [d1], { onStageOpen }));
    item.run();
    expect(useApp.getState().editableFigures).toHaveLength(0);
    expect(onStageOpen).not.toHaveBeenCalled();
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

  // PR M (L0.45): the unconditional fail-closed gate is LIFTED — Delete is
  // enabled again, and the confirm message is the real dependency-aware
  // gate (see the impact-preview tests below).
  it("Delete is enabled (the PR M gate lift) and actually deletes on run()", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    useApp.setState({ workbooks: [{ id: "w1", name: "W" }], datasets: [], history: [] });
    const deleteAction = workbookDeleteActions.find((a) => a.id === "workbook.delete")!;
    const t = target({ id: "w1", name: "W" });
    expect(deleteAction.enabled?.(t)).toBe(true);
    const item = menuItemFor(deleteAction, t);
    expect(item.disabled).toBeFalsy();
    item.run();
    await Promise.resolve();
    expect(useApp.getState().workbooks).toEqual([]);
  });

  // PR M (L0.45 + L0.55): the confirm message names the FULL downstream
  // dependency impact — bgRef chains, derived worksheets, fits — computed
  // via lib/dependencyImpact.ts (the K graph, same closure the recalc
  // engine itself uses), not just the raw worksheet count.
  describe("dependency impact preview in the confirm message (PR M)", () => {
    it("names a derived worksheet AND its fit as affected", () => {
      const source: Dataset = {
        id: "d1",
        name: "d1.dat",
        workbookId: "w1",
        data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
      };
      const derived: Dataset = {
        id: "d2",
        name: "derived-sheet",
        data: { time: [0], values: [[2]], labels: ["A"], units: [""], metadata: {} },
        derivedFrom: { datasetId: "d1", pipeline: "x" },
        fitSpec: { model: "Linear" },
      };
      useApp.setState({ datasets: [source, derived] });
      const deleteAction = workbookDeleteActions.find((a) => a.id === "workbook.delete")!;
      const t = target({ id: "w1", name: "W" }, [source]);
      const spec = deleteAction.confirm!(t);
      expect(spec.message).toContain("derived-sheet");
      expect(spec.message).toMatch(/marked stale/);
    });

    it("adds nothing extra when nothing depends on the workbook's members", () => {
      const source: Dataset = {
        id: "d1",
        name: "d1.dat",
        workbookId: "w1",
        data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
      };
      useApp.setState({ datasets: [source] });
      const deleteAction = workbookDeleteActions.find((a) => a.id === "workbook.delete")!;
      const t = target({ id: "w1", name: "W" }, [source]);
      const spec = deleteAction.confirm!(t);
      expect(spec.message).not.toMatch(/marked stale/);
    });
  });
});

describe("workbook.quickPlotWith (PR H, L0.37)", () => {
  const template = {
    id: "qpt-1",
    name: "T",
    createdAt: "x",
    modifiedAt: "x",
    scope: { kind: "schema" as const },
    technique: "magnetometry.mvsh" as const,
    signature: { channels: [] },
    mapping: { xKey: null, yKeys: [0], errorBindings: [], ignoredKeys: [] },
    style: "line" as const,
    labels: {},
  };

  it("hidden when zero templates exist", () => {
    const wb: WorkbookNode = { id: "w1", name: "W" };
    const d1 = recognizedDataset("d1", "w1");
    useApp.setState({ quickPlotTemplates: [] });
    const item = actionMenuItem(find("workbook.quickPlotWith"), target(wb, [d1]));
    expect(item).toBeNull();
  });

  it("hidden when the workbook has no worksheets, even with templates saved", () => {
    const wb: WorkbookNode = { id: "w1", name: "W" };
    useApp.setState({ quickPlotTemplates: [template] });
    const item = actionMenuItem(find("workbook.quickPlotWith"), target(wb, []));
    expect(item).toBeNull();
  });

  it("shown once a template exists and the workbook has a worksheet", () => {
    const wb: WorkbookNode = { id: "w1", name: "W" };
    const d1 = recognizedDataset("d1", "w1");
    useApp.setState({ quickPlotTemplates: [template] });
    const item = actionMenuItem(find("workbook.quickPlotWith"), target(wb, [d1]));
    expect(item).not.toBeNull();
  });

  // Review-round P2b (the orphan bug's manage-affordance half): reviewer's
  // exact probe shape -- a workbook-scoped template must stay reachable even
  // after its workbook loses its only dataset (ordinary removeDatasets),
  // because the workbook itself is still alive, only memberless.
  describe("memberless-but-alive workbook (review-round P2b)", () => {
    const workbookScoped = { ...template, id: "qpt-scoped", scope: { kind: "workbook" as const, workbookId: "w1" } };

    it("stays SHOWN (never hidden) for a memberless workbook that owns a workbook-scoped template", () => {
      const wb: WorkbookNode = { id: "w1", name: "W" };
      useApp.setState({ quickPlotTemplates: [workbookScoped] });
      const item = actionMenuItem(find("workbook.quickPlotWith"), target(wb, [] /* no worksheet children */));
      expect(item).not.toBeNull();
    });

    it("stays hidden for a memberless workbook whose ONLY templates are scoped to a DIFFERENT workbook", () => {
      const wb: WorkbookNode = { id: "w1", name: "W" };
      const otherWorkbookScoped = { ...workbookScoped, id: "qpt-other", scope: { kind: "workbook" as const, workbookId: "w2" } };
      useApp.setState({ quickPlotTemplates: [otherWorkbookScoped] });
      const item = actionMenuItem(find("workbook.quickPlotWith"), target(wb, []));
      expect(item).toBeNull();
    });

    it("reviewer's exact probe: save workbook-scoped template, remove the workbook's only dataset, menu still offers the chooser", () => {
      const wb: WorkbookNode = { id: "w1", name: "W" };
      const d1 = recognizedDataset("d1", "w1");
      useApp.setState({ workbooks: [wb], datasets: [d1] });
      useApp.getState().saveQuickPlotTemplate(
        "d1",
        { xKey: null, yKeys: [0], errorBindings: [], ignoredKeys: [1] },
        "line",
        "Scoped",
        { kind: "workbook", workbookId: "w1" },
      );
      // Ordinary removal of the workbook's only dataset -- the workbook
      // itself is untouched (still in `workbooks`), just now memberless.
      useApp.getState().removeDatasets(["d1"]);
      expect(useApp.getState().datasets).toHaveLength(0);

      const item = actionMenuItem(find("workbook.quickPlotWith"), target(wb, []));
      expect(item).not.toBeNull();
    });

    it("run() opens the chooser in workbook-only mode (openQuickPlotWithForWorkbook) when there is no worksheet to target", () => {
      const wb: WorkbookNode = { id: "w1", name: "W" };
      useApp.setState({ quickPlotTemplates: [workbookScoped] });
      useQuickPlotWithDialog.getState().close();
      menuItemFor(find("workbook.quickPlotWith"), target(wb, [])).run();
      expect(useQuickPlotWithDialog.getState().workbookId).toBe("w1");
      expect(useQuickPlotWithDialog.getState().datasetId).toBeNull();
    });
  });
});

// PR I: Copy/Duplicate (L0.23/L0.36 — these two now have a contract; Paste
// stays a folder/root-target command, not a per-workbook menu row, see
// commands/workbookTransferCommands.ts).
describe("Copy / Duplicate (PR I)", () => {
  const wb: WorkbookNode = { id: "w1", name: "W" };

  it("Copy calls copyWorkbookToClipboard for this workbook and is disabled with a reason when memberless", () => {
    const d1 = recognizedDataset("d1", "w1");
    useApp.setState({ workbooks: [wb], datasets: [d1] });
    const copyWorkbookToClipboard = vi.fn();
    useApp.setState({ copyWorkbookToClipboard });
    menuItemFor(find("workbook.copy"), target(wb, [d1])).run();
    expect(copyWorkbookToClipboard).toHaveBeenCalledWith("w1");

    expect(menuItemFor(find("workbook.copy"), target(wb, [])).disabled).toBe(true);
  });

  it("Duplicate calls duplicateWorkbook for this workbook and is disabled with a reason when memberless", () => {
    const d1 = recognizedDataset("d1", "w1");
    useApp.setState({ workbooks: [wb], datasets: [d1] });
    const duplicateWorkbook = vi.fn();
    useApp.setState({ duplicateWorkbook });
    menuItemFor(find("workbook.duplicate"), target(wb, [d1])).run();
    expect(duplicateWorkbook).toHaveBeenCalledWith("w1");

    expect(menuItemFor(find("workbook.duplicate"), target(wb, [])).disabled).toBe(true);
  });
});
