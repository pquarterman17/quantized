// UX audit 10 (P1-7): the Library row menus stay within 16 top-level entries,
// whatever the row (collapsed workbook, multi-selection, corrections, folders),
// and Re-import has one spelling.

import { beforeEach, describe, expect, it } from "vitest";

import { buildDatasetRowMenu } from "./datasetRowMenu";
import { buildWorkbookRowMenu } from "./workbookRowMenu";
import { ROW_MENU_MAX_ITEMS, joinGroups, submenuItem, tidySeparators, topLevelCount } from "./rowMenuGroups";
import { buildLibraryHierarchy, collapsedSheetOf, type LibraryNode } from "../../lib/libraryHierarchy";
import type { Dataset, FolderNode } from "../../lib/types";
import { useApp } from "../../store/useApp";
import type { ContextMenuItem } from "../overlays/ContextMenu";

const folders: FolderNode[] = [
  { id: "f1", name: "Alpha", parentId: null, order: 0 },
  { id: "f2", name: "Beta", parentId: null, order: 1 },
  { id: "f3", name: "Gamma", parentId: null, order: 2 },
];
const ds = (id: string, extra: Partial<Dataset> = {}): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["A"], units: [""], metadata: {} },
  workbookId: `w-${id}`,
  ...extra,
});

function labels(items: ContextMenuItem[]): string[] {
  const out: string[] = [];
  for (const i of items) {
    if ("label" in i) out.push(i.label);
    if ("submenu" in i) out.push(...labels(i.submenu));
  }
  return out;
}

function collapsedRow(d: Dataset) {
  const workbook = { id: d.workbookId!, name: d.name, folderId: d.folderId };
  const h = buildLibraryHierarchy({ folders, workbooks: [workbook], datasets: [d] });
  const node = h.byKey.get(`workbook:${workbook.id}`) as Extract<LibraryNode, { kind: "workbook" }>;
  expect(collapsedSheetOf(node)).not.toBeNull();
  return node;
}

beforeEach(() => {
  useApp.setState({ folders, selectedIds: [], quickPlotTemplates: [] });
});

describe("Library row menu size (P1-7)", () => {
  const worst = ds("d1", { source: { kind: "path", path: "/a/b.dat" } as never, corrections: { a: 1 } as never, folderId: "f1" });
  const build = (selectedIds: string[], collapsed: boolean) => {
    useApp.setState({ selectedIds });
    const node = collapsed ? collapsedRow(worst) : undefined;
    const sel = selectedIds.includes(worst.id);
    return buildDatasetRowMenu(worst, true, sel, folders, true, true, () => {}, () => {}, () => {}, node, () => {});
  };

  it.each([
    ["plain row", [], false],
    ["collapsed workbook row", [], true],
    ["plain row in a multi-selection", ["d1", "d2", "d3"], false],
    ["collapsed row in a multi-selection", ["d1", "d2", "d3"], true],
  ] as const)("%s has at most 16 entries and at most 5 separators", (_n, selected, collapsed) => {
    const items = build([...selected], collapsed);
    expect(topLevelCount(items)).toBeLessThanOrEqual(ROW_MENU_MAX_ITEMS);
    expect(items.filter((i) => "separator" in i).length).toBeLessThanOrEqual(5);
  });

  it("the workbook row menu has at most 16 entries too, and no dead Browse outside Tiles", () => {
    const d = ds("d1", { workbookId: "wb" });
    const h = buildLibraryHierarchy({ folders, workbooks: [{ id: "wb", name: "W", folderId: "f1" }], datasets: [d, ds("d2", { workbookId: "wb" })] });
    const node = h.byKey.get("workbook:wb") as Extract<LibraryNode, { kind: "workbook" }>;
    const items = buildWorkbookRowMenu(node, () => {}, undefined, undefined, undefined, () => {});
    expect(topLevelCount(items)).toBeLessThanOrEqual(ROW_MENU_MAX_ITEMS);
    expect(labels(items)).not.toContain("Browse");
    expect(labels(buildWorkbookRowMenu(node, () => {}, () => {}))).toContain("Browse");
  });

  it("every entry the row used to offer is still reachable (no capability dropped)", () => {
    const all = labels(build([], true));
    for (const want of [
      "Plot (make active)", "Plot in new window", "Open worksheet in window", "Quick Plot", "Configure Quick Plot…", "Show workflow",
      "Rename…", "Add tag…", "Duplicate", "Copy", "Re-import from source", "Auto-update from source", "Re-import all",
      "Re-import available sources", "Reveal source", 'Move to "Beta"', "New folder with this…", "Move up", "Move down",
      "Apply corrections to all", "Create derived worksheet", "Split by column value…", "Combine…", "Properties…", "Delete",
    ]) expect(all, want).toContain(want);
  });

  it("Re-import has one spelling across the row menus", () => {
    const all = [...labels(build([], true)), ...labels(build([], false))].filter((l) => /re-?import/i.test(l));
    expect(all.length).toBeGreaterThan(2);
    for (const l of all) expect(l, l).toMatch(/^Re-import/);
  });

  it("labels follow sentence case (feature names and proper nouns excepted)", () => {
    const exempt = /Quick Plot|Origin|Metadata|Combine|Split|Separate/g;
    for (const l of labels(build([], true))) {
      // Words after the first must not be Capitalized: "Reveal Source", "Create Derived Worksheet".
      const rest = l.replace(exempt, "").replace(/"[^"]*"/g, "").trim().replace(/^\S+ ?/, "");
      expect(rest, l).not.toMatch(/(^|\s)[A-Z][a-z]{2,}\b/);
    }
  });
});

describe("rowMenuGroups helpers", () => {
  const a: ContextMenuItem = { label: "A", run: () => {} };
  const sep: ContextMenuItem = { separator: true };
  it("tidySeparators drops leading, trailing and doubled separators", () => {
    expect(tidySeparators([sep, a, sep, sep, a, sep])).toEqual([a, sep, a]);
  });
  it("submenuItem is absent when it would be empty", () => {
    expect(submenuItem("X", [])).toEqual([]);
    expect(submenuItem("X", [sep])).toEqual([]);
    expect(submenuItem("X", [a])).toEqual([{ label: "X", submenu: [a] }]);
  });
  it("joinGroups separates only the non-empty groups", () => {
    expect(joinGroups([a], [], [a])).toEqual([a, sep, a]);
  });
});
