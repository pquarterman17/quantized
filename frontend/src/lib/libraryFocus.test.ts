import { describe, expect, it } from "vitest";

import { focusLibraryHierarchy } from "./libraryFocus";
import { buildLibraryHierarchy } from "./libraryHierarchy";

const hierarchy = buildLibraryHierarchy({
  folders: [
    { id: "project-a", name: "Project A", parentId: null, order: 0 },
    { id: "nested", name: "Nested", parentId: "project-a", order: 0 },
    { id: "project-b", name: "Project B", parentId: null, order: 1 },
  ],
  workbooks: [
    { id: "book-a", name: "Book A", folderId: "nested", order: 0 },
    { id: "book-b", name: "Book B", folderId: "project-b", order: 0 },
  ],
  datasets: [
    { id: "sheet-a", name: "Sheet A", workbookId: "book-a", data: { time: [], values: [], labels: [], units: [], metadata: {} } },
    { id: "sheet-b", name: "Sheet B", workbookId: "book-b", data: { time: [], values: [], labels: [], units: [], metadata: {} } },
  ],
});

describe("focusLibraryHierarchy", () => {
  it("roots the view at a folder, rebases depth, and excludes unrelated branches", () => {
    const focused = focusLibraryHierarchy(hierarchy, "folder:nested");

    expect(focused.roots.map((node) => node.key)).toEqual(["folder:nested"]);
    expect(focused.byKey.has("workbook:book-b")).toBe(false);
    expect(focused.byKey.get("folder:nested")?.depth).toBe(0);
    expect(focused.byKey.get("workbook:book-a")?.depth).toBe(1);
    expect(focused.byKey.get("worksheet:sheet-a")?.depth).toBe(2);
    expect(focused.byKey.get("folder:nested")?.parentKey).toBeNull();
  });

  it("accepts a workbook root and leaves the full hierarchy alone for stale or non-container keys", () => {
    const workbook = focusLibraryHierarchy(hierarchy, "workbook:book-a");
    expect(workbook.roots[0]?.key).toBe("workbook:book-a");
    expect(workbook.byKey.get("worksheet:sheet-a")?.depth).toBe(1);
    expect(focusLibraryHierarchy(hierarchy, "folder:missing")).toBe(hierarchy);
    expect(focusLibraryHierarchy(hierarchy, "worksheet:sheet-a")).toBe(hierarchy);
  });
});
