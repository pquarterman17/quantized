// LIBRARY_WORKBOOK_UX_PLAN PR C: the dynamic per-folder "Move to..." list
// workbookRowMenu.ts splices in — mirrors datasetRowMenu.test.ts/
// folderRowMenu's own per-folder list tests.

import { beforeEach, describe, expect, it } from "vitest";

import { buildWorkbookRowMenu } from "./workbookRowMenu";
import { buildLibraryHierarchy, type LibraryNode } from "../../lib/libraryHierarchy";
import type { WorkbookNode } from "../../lib/workbooks";
import { useApp } from "../../store/useApp";
import type { ContextMenuItem } from "../overlays/ContextMenu";

function node(workbook: WorkbookNode) {
  const hierarchy = buildLibraryHierarchy({ folders: useApp.getState().folders, workbooks: [workbook], datasets: [] });
  return hierarchy.byKey.get(`workbook:${workbook.id}`) as Extract<LibraryNode, { kind: "workbook" }>;
}

const label = (items: ContextMenuItem[], text: string) =>
  items.find((i) => "label" in i && i.label === text) as { label: string; run: () => void; disabled?: boolean } | undefined;

describe("buildWorkbookRowMenu — dynamic Move-to-folder list", () => {
  beforeEach(() => {
    useApp.setState({
      folders: [
        { id: "f1", name: "Alpha", parentId: null, order: 0 },
        { id: "f2", name: "Beta", parentId: null, order: 1 },
      ],
      workbooks: [],
    });
  });

  it("offers every folder, disabling the one it's already in", () => {
    const wb: WorkbookNode = { id: "w1", name: "W", folderId: "f1" };
    const items = buildWorkbookRowMenu(node(wb), () => {});
    expect(label(items, 'Move to "Alpha"')?.disabled).toBe(true);
    expect(label(items, 'Move to "Beta"')?.disabled).toBe(false);
  });

  it("moves the workbook and syncs member datasets on click", () => {
    useApp.setState({
      workbooks: [{ id: "w1", name: "W" }],
      datasets: [{
        id: "d1", name: "d1.dat", workbookId: "w1",
        data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
      }],
    });
    const wb = useApp.getState().workbooks[0];
    const items = buildWorkbookRowMenu(node(wb), () => {});
    label(items, 'Move to "Beta"')!.run();
    const s = useApp.getState();
    expect(s.workbooks[0].folderId).toBe("f2");
    expect(s.datasets[0].folderId).toBe("f2");
  });

  it("offers 'Move to top level' only when currently in a folder", () => {
    const rooted: WorkbookNode = { id: "w1", name: "W" };
    expect(label(buildWorkbookRowMenu(node(rooted), () => {}), "Move to top level")).toBeUndefined();

    const foldered: WorkbookNode = { id: "w1", name: "W", folderId: "f1" };
    expect(label(buildWorkbookRowMenu(node(foldered), () => {}), "Move to top level")).toBeDefined();
  });

  it("with no folders at all, the Move-to block is entirely absent", () => {
    useApp.setState({ folders: [] });
    const wb: WorkbookNode = { id: "w1", name: "W" };
    const items = buildWorkbookRowMenu(node(wb), () => {});
    expect(items.some((i) => "label" in i && i.label.startsWith("Move to"))).toBe(false);
  });
});
