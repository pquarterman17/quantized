// LIBRARY_WORKBOOK_UX_PLAN PR L (L0.48/L0.49) — Collections: the pure
// membership derivation + .dwk-boundary sanitizer.

import { describe, expect, it } from "vitest";

import { collectionMembers, sanitizeCollections, type Collection } from "./collections";
import { buildLibraryHierarchy } from "./libraryHierarchy";
import type { Dataset } from "./types";

const ds = (id: string, name: string, opts: { tags?: string[]; workbookId?: string } = {}): Dataset => ({
  id,
  name,
  workbookId: opts.workbookId,
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
  ...(opts.tags ? { tags: opts.tags } : {}),
});

describe("collectionMembers", () => {
  it("derives LIVE members from the current hierarchy — a saved search, not a stored id list", () => {
    const hierarchy = buildLibraryHierarchy({
      folders: [],
      workbooks: [{ id: "w1", name: "Run1" }, { id: "w2", name: "Run2" }],
      datasets: [
        ds("a", "loop1.dat", { tags: ["MvsH"], workbookId: "w1" }),
        ds("b", "xrd.raw", { workbookId: "w2" }),
        ds("c", "loop2.dat", { tags: ["MvsH"], workbookId: "w2" }),
      ],
    });
    const collection: Collection = { id: "col1", name: "Hysteresis loops", query: "tag:mvsh" };
    const members = collectionMembers(hierarchy, collection);
    expect(members.map((m) => m.entityId).sort()).toEqual(["a", "c"]);
  });

  it("the SAME workbook (and its worksheet) can appear in several Collections without duplication or relocation (L0.48)", () => {
    const hierarchy = buildLibraryHierarchy({
      folders: [],
      workbooks: [{ id: "w1", name: "MagneticRun" }],
      datasets: [ds("a", "loop1.dat", { tags: ["MvsH", "urgent"], workbookId: "w1" })],
    });
    const inHysteresis = collectionMembers(hierarchy, { id: "c1", name: "Hysteresis", query: "tag:mvsh" });
    const inUrgent = collectionMembers(hierarchy, { id: "c2", name: "Urgent", query: "tag:urgent" });
    expect(inHysteresis.map((m) => m.entityId)).toEqual(["a"]);
    expect(inUrgent.map((m) => m.entityId)).toEqual(["a"]);
    // Both memberships resolve to the SAME real worksheet node, one location.
    expect(inHysteresis[0]!.key).toBe(inUrgent[0]!.key);
  });

  it("membership updates live when the underlying data changes — never a frozen id list", () => {
    const collection: Collection = { id: "c1", name: "MvsH", query: "tag:mvsh" };
    const before = buildLibraryHierarchy({
      folders: [], workbooks: [{ id: "w1", name: "Run" }],
      datasets: [ds("a", "loop1.dat", { workbookId: "w1" })],
    });
    expect(collectionMembers(before, collection)).toHaveLength(0);
    const after = buildLibraryHierarchy({
      folders: [], workbooks: [{ id: "w1", name: "Run" }],
      datasets: [ds("a", "loop1.dat", { tags: ["MvsH"], workbookId: "w1" })],
    });
    expect(collectionMembers(after, collection)).toHaveLength(1);
  });

  it("folders never match — organization, not addressable content", () => {
    const hierarchy = buildLibraryHierarchy({
      folders: [{ id: "f1", name: "MvsH runs", parentId: null, order: 0 }],
      workbooks: [],
      datasets: [],
    });
    expect(collectionMembers(hierarchy, { id: "c1", name: "x", query: "mvsh" })).toHaveLength(0);
  });

  it("an empty query matches every non-folder node", () => {
    const hierarchy = buildLibraryHierarchy({
      folders: [],
      workbooks: [{ id: "w1", name: "Run" }],
      datasets: [ds("a", "loop1.dat", { workbookId: "w1" })],
    });
    const members = collectionMembers(hierarchy, { id: "c1", name: "all", query: "" });
    expect(members.map((m) => m.kind).sort()).toEqual(["workbook", "worksheet"]);
  });
});

describe("sanitizeCollections (.dwk boundary)", () => {
  it("keeps valid entries and drops malformed ones", () => {
    expect(
      sanitizeCollections([
        { id: "c1", name: "Hysteresis", query: "tag:mvsh" },
        { id: "c2", name: "  ", query: "x" }, // blank name
        { id: 3, name: "bad-id", query: "" }, // non-string id
        { id: "c4", name: "no-query" }, // missing query
        "garbage",
        null,
      ]),
    ).toEqual([{ id: "c1", name: "Hysteresis", query: "tag:mvsh" }]);
  });

  it("non-arrays sanitize to []", () => {
    expect(sanitizeCollections(undefined)).toEqual([]);
    expect(sanitizeCollections({ id: "x" })).toEqual([]);
  });
});
