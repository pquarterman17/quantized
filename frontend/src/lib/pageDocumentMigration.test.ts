// PRIMARY_SOFTWARE_AUDIT_PLAN — "Migration fixtures for supported
// contract/workspace versions". Exercises the FROZEN v1 fixture in
// `./__fixtures__/pageDocument/` (see that directory's README for
// provenance) through the REAL public load path (`sanitizePageDocument`).

import { describe, expect, it } from "vitest";

import v1 from "./__fixtures__/pageDocument/v1.json";
import { DEFAULT_LAYOUT, PAGE_DOCUMENT_VERSION, sanitizePageDocument } from "./pageDocument";
import { serializePageDocument } from "./pageDocumentActions";

describe("pageDocument migration — frozen v1 fixture", () => {
  it("parses without throwing and migrates to the current version", () => {
    const doc = sanitizePageDocument(v1);
    expect(doc).not.toBeNull();
    expect(doc!.version).toBe(PAGE_DOCUMENT_VERSION);
  });

  it("a pre-F3.5 document with no `layout` field migrates to DEFAULT_LAYOUT (today's exact rendering)", () => {
    const doc = sanitizePageDocument(v1)!;
    expect(doc.layout).toEqual(DEFAULT_LAYOUT);
  });

  it("identity, grid, and panel references survive verbatim", () => {
    const doc = sanitizePageDocument(v1)!;
    expect(doc.id).toBe("page-legacy-1");
    expect(doc.name).toBe("Figure Page 1");
    expect(doc.rows).toBe(2);
    expect(doc.cols).toBe(1);
    expect(doc.panels).toEqual([
      { figureId: "fig-legacy-1", label: null, title: null },
      { figureId: "fig-legacy-2", label: "(custom)", title: "Custom title" },
    ]);
    expect(doc.output.labelFormat).toBe("(a)");
    expect(doc.output.labelPos).toBe("nw");
  });

  it("a document that never had createdAt/modifiedAt defaults them to the epoch, never `undefined`", () => {
    const doc = sanitizePageDocument(v1)!;
    expect(doc.createdAt).toBe(new Date(0).toISOString());
    expect(doc.modifiedAt).toBe(new Date(0).toISOString());
  });

  it("re-saving then reloading is idempotent (round trip stable)", () => {
    const firstLoad = sanitizePageDocument(v1)!;
    const savedOnce = serializePageDocument(firstLoad);
    const secondLoad = sanitizePageDocument(JSON.parse(savedOnce))!;
    const savedTwice = serializePageDocument(secondLoad);
    expect(savedTwice).toBe(savedOnce);
    expect(secondLoad).toEqual(firstLoad);
  });

  it("a future version this build does not understand is rejected outright", () => {
    const future = { ...(v1 as Record<string, unknown>), version: PAGE_DOCUMENT_VERSION + 1 };
    expect(sanitizePageDocument(future)).toBeNull();
  });
});
