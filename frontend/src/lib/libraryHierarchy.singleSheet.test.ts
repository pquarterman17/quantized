// UX8-I: a workbook holding exactly one worksheet is ONE Library row.

import { describe, expect, it } from "vitest";

import { buildLibraryHierarchy, flattenLibraryHierarchy } from "./libraryHierarchy";
import type { Dataset } from "./types";

const ds = (id: string, workbookId: string): Dataset => ({
  id,
  name: id,
  data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} },
  workbookId,
});

const hierarchy = buildLibraryHierarchy({
  folders: [{ id: "f", name: "F", parentId: null, order: 0 }],
  workbooks: [
    { id: "one", name: "one", folderId: "f", order: 0 },
    { id: "two", name: "two", folderId: "f", order: 1 },
  ],
  datasets: [ds("a", "one"), ds("b", "two"), ds("c", "two")],
});
const open = new Set(["folder:f" as const, "workbook:one" as const, "workbook:two" as const]);

describe("flattenLibraryHierarchy collapseSingleSheet", () => {
  it("is off by default: the workbook header and its sheet are two rows", () => {
    expect(flattenLibraryHierarchy(hierarchy, open).map((r) => r.node.key)).toEqual([
      "folder:f", "workbook:one", "worksheet:a", "workbook:two", "worksheet:b", "worksheet:c",
    ]);
  });

  it("renders a one-sheet workbook as its sheet alone, at the workbook's depth and parent", () => {
    const rows = flattenLibraryHierarchy(hierarchy, open, true);
    expect(rows.map((r) => r.node.key)).toEqual(["folder:f", "worksheet:a", "workbook:two", "worksheet:b", "worksheet:c"]);
    const a = rows[1];
    expect(a.node.depth).toBe(1);
    expect(a.node.parentKey).toBe("folder:f");
    expect(a.hasChildren).toBe(false);
  });

  it("keeps the sheet visible while the workbook is 'collapsed', but not a multi-sheet one's", () => {
    const rows = flattenLibraryHierarchy(hierarchy, new Set(["folder:f" as const]), true);
    expect(rows.map((r) => r.node.key)).toEqual(["folder:f", "worksheet:a", "workbook:two"]);
  });
});
