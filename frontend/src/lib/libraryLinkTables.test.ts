// Origin link-table books gather under one collapsed "Origin link tables" group
// per containing folder; nothing is dropped and mixed books stay put.

import { describe, expect, it } from "vitest";

import { buildLibraryHierarchy, expandedKeySet, flattenLibraryHierarchy } from "./libraryHierarchy";
import { libraryNodeLabel } from "../components/Library/nodeIcons";
import { LINK_TABLES_GROUP_NAME } from "./libraryLinkTables";
import { libraryTileSummary } from "./libraryTileSummary";
import type { Dataset, FolderNode } from "./types";
import type { WorkbookNode } from "./workbooks";

function sheet(id: string, workbookId: string, linkTable: boolean): Dataset {
  return {
    id, name: `sheet ${id}`, workbookId,
    data: {
      time: [], values: [], labels: [], units: [],
      metadata: { origin_book: `B${workbookId}`, ...(linkTable ? { origin_link_table: true } : {}) },
    },
  };
}
const wb = (id: string, folderId?: string): WorkbookNode => ({ id, name: `Book ${id}`, folderId, originBook: id });
const proj: FolderNode = { id: "f1", name: "Proj", parentId: null, order: 0 };

const build = (workbooks: WorkbookNode[], datasets: Dataset[]) =>
  buildLibraryHierarchy({ folders: [proj], workbooks, datasets });

describe("Origin link tables group", () => {
  it("gathers flagged books under ONE group inside their folder, keeping every book", () => {
    const h = build(
      [wb("w1", "f1"), wb("t1", "f1"), wb("t2", "f1")],
      [sheet("d1", "w1", false), sheet("dt1", "t1", true), sheet("dt2", "t2", true)],
    );
    const folder = h.roots[0];
    const group = folder.children.find((n) => n.kind === "origin-group")!;
    expect(group.name).toBe(LINK_TABLES_GROUP_NAME);
    expect(group.kind === "origin-group" && group.entity.variant).toBe("link-tables");
    expect(group.children.map((n) => n.key)).toEqual(["workbook:t1", "workbook:t2"]);
    // the sheets stay reachable under their books; the real book stays a folder child
    expect(h.byKey.has("worksheet:dt1")).toBe(true);
    expect(folder.children.map((n) => n.key)).toContain("workbook:w1");
    expect(folder.children.map((n) => n.key)).not.toContain("workbook:t1");
  });

  it("is collapsed by default and shows its books only when expanded", () => {
    const h = build([wb("t1", "f1")], [sheet("dt1", "t1", true)]);
    const collapsed = flattenLibraryHierarchy(h, expandedKeySet(["f1"], [], []));
    expect(collapsed.map((r) => r.node.key)).toEqual(["folder:f1", "origin-group:link-tables-f1"]);
    const open = flattenLibraryHierarchy(h, expandedKeySet(["f1"], [], ["link-tables-f1"]));
    expect(open.map((r) => r.node.key)).toContain("workbook:t1");
  });

  it("a book with any non-link sheet is NOT grouped (negative control)", () => {
    const h = build([wb("m", "f1")], [sheet("a", "m", true), sheet("b", "m", false)]);
    expect([...h.byKey.keys()].some((k) => k.startsWith("origin-group:"))).toBe(false);
    expect(h.byKey.get("workbook:m")?.parentKey).toBe("folder:f1");
  });

  it("a workbook without sheets is not grouped", () => {
    const h = build([wb("e", "f1")], []);
    expect([...h.byKey.keys()].some((k) => k.startsWith("origin-group:"))).toBe(false);
  });

  it("root-level link tables get a root group; one group per folder", () => {
    const h = build([wb("t1"), wb("t2", "f1")], [sheet("dt1", "t1", true), sheet("dt2", "t2", true)]);
    expect(h.byKey.get("origin-group:link-tables-root")?.parentKey).toBeNull();
    expect(h.byKey.get("origin-group:link-tables-f1")?.parentKey).toBe("folder:f1");
  });

  it("the tile caption carries the count and the unresolved note", () => {
    const h = build([wb("t1", "f1"), wb("t2", "f1")], [sheet("a", "t1", true), sheet("b", "t2", true)]);
    const group = h.byKey.get("origin-group:link-tables-f1")!;
    expect(libraryTileSummary(group)).toMatchObject({ primary: "2 books", secondary: "linked cells not resolved" });
  });

  it("labels the group by its own name, not as unresolved figures", () => {
    const h = build([wb("t1", "f1")], [sheet("a", "t1", true)]);
    expect(libraryNodeLabel(h.byKey.get("origin-group:link-tables-f1")!)).toBe(LINK_TABLES_GROUP_NAME);
  });
});
