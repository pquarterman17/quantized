import { describe, expect, it } from "vitest";

import { buildTreeRows, type TreeRow } from "./useLibraryTree";
import type { OriginFigureEntry } from "../../lib/originFigures";
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
const fig = (id: string, datasetId: string | null, siblingIds: string[] = []): OriginFigureEntry => ({
  id,
  stem: id,
  figure: {
    name: id,
    x_from: 0,
    x_to: 1,
    x_log: false,
    y_from: 0,
    y_to: 1,
    y_log: false,
    n_curves: 1,
    annotations: [],
  },
  datasetId,
  siblingIds,
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

describe("buildTreeRows — figures nest under their project folder", () => {
  it("emits a figure under its bound dataset's folder, after the datasets", () => {
    const rows = buildTreeRows(
      [fld("f1", null, 0)],
      [ds("a", "f1", 0)],
      new Set(["f1"]),
      [fig("g1", "a")],
    );
    expect(rows.map(label)).toEqual(["[f1]", "·a", "·g1"]);
    expect(rows[2].kind).toBe("figure");
  });

  it("homes an unresolved figure (null datasetId) via its first sibling's folder", () => {
    const rows = buildTreeRows(
      [fld("f1", null, 0)],
      [ds("a", "f1", 0)],
      new Set(["f1"]),
      [fig("g1", null, ["a"])],
    );
    expect(rows.map(label)).toEqual(["[f1]", "·a", "·g1"]);
  });

  it("emits a figure with no resolvable dataset at the tree root", () => {
    const rows = buildTreeRows(
      [fld("f1", null, 0)],
      [ds("a", "f1", 0)],
      new Set(["f1"]),
      [fig("g1", "gone", ["also-gone"])],
    );
    expect(rows.map(label)).toEqual(["[f1]", "·a", "g1"]); // g1 at depth 0
    expect(rows[2].depth).toBe(0);
  });

  it("hides a figure whose folder is collapsed", () => {
    const rows = buildTreeRows([fld("f1", null, 0)], [ds("a", "f1", 0)], new Set(), [fig("g1", "a")]);
    expect(rows.map(label)).toEqual(["[f1]"]); // folder collapsed → its figure hidden too
  });

  it("places a figure whose dataset is at root at the tree root, after datasets", () => {
    const rows = buildTreeRows([], [ds("a")], new Set(), [fig("g1", "a")]);
    expect(rows.map((r) => r.id)).toEqual(["a", "g1"]);
    expect(rows[1].kind).toBe("figure");
  });
});
