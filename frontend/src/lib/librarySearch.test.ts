// PR D2 (L0.26): the project-wide search matcher. Worksheets keep the full
// smart-folder grammar; every other node kind offers only its name, so
// field-scoped tag:/format: terms honestly exclude it.

import { describe, expect, it } from "vitest";

import { buildLibraryHierarchy, type LibraryNode } from "./libraryHierarchy";
import { libraryNodeMatches } from "./librarySearch";
import { createPageDocument } from "./pageDocument";
import { parseQuery } from "./smartfolders";

const hierarchy = buildLibraryHierarchy({
  folders: [{ id: "f1", name: "Growth Series", parentId: null, order: 0 }],
  workbooks: [{ id: "w1", name: "MokeRun", folderId: "f1" }],
  datasets: [
    {
      id: "d1",
      name: "loop.dat",
      workbookId: "w1",
      tags: ["MvsH"],
      data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: { parser_name: "import_qd_vsm" } },
    },
  ],
  pages: [createPageDocument({ id: "pg1", name: "Moke Summary", rows: 1, cols: 1 })],
});

const node = (key: string): LibraryNode => {
  const found = hierarchy.byKey.get(key as never);
  if (!found) throw new Error(`fixture: missing ${key}`);
  return found;
};

describe("libraryNodeMatches", () => {
  it("bare terms match any node kind by name — folders, workbooks, and artifacts included", () => {
    expect(libraryNodeMatches(node("folder:f1"), parseQuery("growth"))).toBe(true);
    expect(libraryNodeMatches(node("workbook:w1"), parseQuery("moke"))).toBe(true);
    expect(libraryNodeMatches(node("page:pg1"), parseQuery("moke"))).toBe(true);
    expect(libraryNodeMatches(node("workbook:w1"), parseQuery("nomatch"))).toBe(false);
  });

  it("worksheets keep the full grammar: bare terms match name OR tag; tag:/format: narrow", () => {
    const ws = node("worksheet:d1");
    expect(libraryNodeMatches(ws, parseQuery("mvsh"))).toBe(true); // tag via bare term
    expect(libraryNodeMatches(ws, parseQuery("tag:mvsh"))).toBe(true);
    expect(libraryNodeMatches(ws, parseQuery("format:qd"))).toBe(true);
    expect(libraryNodeMatches(ws, parseQuery("tag:loop"))).toBe(false); // name is not a tag
  });

  it("tag:/format: terms honestly exclude non-worksheet kinds instead of matching vacuously", () => {
    expect(libraryNodeMatches(node("workbook:w1"), parseQuery("tag:moke"))).toBe(false);
    expect(libraryNodeMatches(node("page:pg1"), parseQuery("format:qd"))).toBe(false);
    // name: still works for them — it is a name surface.
    expect(libraryNodeMatches(node("page:pg1"), parseQuery("name:summary"))).toBe(true);
  });

  it("terms AND together across kinds", () => {
    expect(libraryNodeMatches(node("page:pg1"), parseQuery("moke summary"))).toBe(true);
    expect(libraryNodeMatches(node("page:pg1"), parseQuery("moke loop"))).toBe(false);
  });
});
