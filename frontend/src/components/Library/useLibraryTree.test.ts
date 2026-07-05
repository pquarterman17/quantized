import { describe, expect, it } from "vitest";

import { buildTreeRows, type TreeRow } from "./useLibraryTree";
import type { Dataset, FolderNode } from "../../lib/types";

const ds = (id: string, folderId?: string, order?: number): Dataset => ({
  id,
  name: id,
  data: { time: [], values: [], labels: [], units: [], metadata: {} },
  ...(folderId !== undefined ? { folderId } : {}),
  ...(order !== undefined ? { order } : {}),
});
const fld = (id: string, parentId: string | null, order: number): FolderNode => ({
  id,
  name: id,
  parentId,
  order,
});
const label = (r: TreeRow) => `${"·".repeat(r.depth)}${r.kind === "folder" ? `[${r.id}]` : r.id}`;

describe("buildTreeRows", () => {
  it("renders root datasets flat when there are no folders", () => {
    const rows = buildTreeRows([], [ds("a"), ds("b")], new Set());
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows.every((r) => r.kind === "dataset" && r.depth === 0)).toBe(true);
  });

  it("collapsed folder hides its contents but still shows the header + subtree count", () => {
    const folders = [fld("f1", null, 0)];
    const datasets = [ds("a", "f1", 0), ds("b", "f1", 1), ds("c")]; // c at root
    const rows = buildTreeRows(folders, datasets, new Set()); // nothing expanded
    expect(rows.map(label)).toEqual(["[f1]", "c"]);
    const f1 = rows[0];
    expect(f1.kind === "folder" && f1.count).toBe(2); // subtree dataset count
    expect(f1.kind === "folder" && f1.empty).toBe(false);
  });

  it("expanded folder emits child folders first, then its datasets, indented", () => {
    const folders = [fld("f1", null, 0), fld("f1a", "f1", 0)];
    const datasets = [ds("a", "f1", 0), ds("nested", "f1a", 0), ds("root")];
    const rows = buildTreeRows(folders, datasets, new Set(["f1", "f1a"]));
    // f1 → (child folder f1a → its dataset) → f1's own dataset → then root dataset
    expect(rows.map(label)).toEqual(["[f1]", "·[f1a]", "··nested", "·a", "root"]);
  });

  it("orders folders and datasets by their order key", () => {
    const folders = [fld("b", null, 1), fld("a", null, 0)];
    const datasets = [ds("d2", undefined, 1), ds("d1", undefined, 0)];
    const rows = buildTreeRows(folders, datasets, new Set());
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "d1", "d2"]); // folders first, each sorted
  });

  it("marks a truly empty folder", () => {
    const rows = buildTreeRows([fld("f1", null, 0)], [], new Set());
    expect(rows[0].kind === "folder" && rows[0].empty).toBe(true);
    expect(rows[0].kind === "folder" && rows[0].count).toBe(0);
  });
});
