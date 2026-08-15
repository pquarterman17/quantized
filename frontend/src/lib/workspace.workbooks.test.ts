// PR A2 (LIBRARY_WORKBOOK_UX_PLAN) — workspace/store persistence of the
// workbook layer PR A1 introduced (lib/workbooks.ts's `WorkbookNode`,
// `Dataset.workbookId`). This file owns the parse/serialize/round-trip
// contract; store-level tests (the loadWorkspace field-leak, clearAll, and
// history-undo coverage) live beside their existing suites
// (store/useApp.test.ts, store/history.test.ts) per the project's
// "tests live beside the module they exercise" convention.

import { describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import { parseWorkspace, serializeWorkspace, WORKSPACE_FORMAT } from "./workspace";

/** Minimal Dataset builder — mirrors workspace.test.ts's `makeDataset` plus
 *  the optional fields `deriveWorkbooks`'s grouping rules read (`source`,
 *  `importedAt`, `data.metadata.origin_book`). */
function makeDataset(
  id: string,
  name: string,
  opts: {
    source?: { kind: "path"; path: string };
    importedAt?: string;
    originBook?: string;
    folderId?: string;
  } = {},
): Dataset {
  const metadata: Record<string, unknown> = {};
  if (opts.originBook) metadata.origin_book = opts.originBook;
  const d: Dataset = {
    id,
    name,
    data: { time: [0, 1], values: [[1, 2]], labels: ["y"], units: [""], metadata },
  };
  if (opts.source) d.source = opts.source;
  if (opts.importedAt) d.importedAt = opts.importedAt;
  if (opts.folderId) d.folderId = opts.folderId;
  return d;
}

describe("parseWorkspace workbooks (v4, LIBRARY_WORKBOOK_UX_PLAN PR A2)", () => {
  it("a v3-shaped doc (no workbooks field) derives one workbook per source, deterministically", () => {
    const doc = {
      format: WORKSPACE_FORMAT,
      version: 3,
      datasets: [
        makeDataset("a", "a.csv", { source: { kind: "path", path: "/data/a.csv" }, importedAt: "t1" }),
        makeDataset("b", "b.csv", { source: { kind: "path", path: "/data/b.csv" }, importedAt: "t2" }),
      ],
    };
    const text = JSON.stringify(doc);
    const ws1 = parseWorkspace(text);
    const ws2 = parseWorkspace(text);

    expect(ws1.workbooks).toHaveLength(2); // L0.2: one imported source file -> one workbook
    expect(ws1.datasets.map((d) => d.workbookId)).toEqual(ws1.workbooks.map((w) => w.id));

    // Determinism: the SAME input text parsed twice yields byte-identical
    // output, ids included — the plan's round-trip acceptance gate.
    expect(ws2.workbooks).toEqual(ws1.workbooks);
    expect(ws2.datasets.map((d) => d.workbookId)).toEqual(ws1.datasets.map((d) => d.workbookId));
  });

  it("full round-trip: parse(v3) -> serialize -> v4 doc with workbooks+workbookId -> parse again identically", () => {
    const v3 = {
      format: WORKSPACE_FORMAT,
      version: 3,
      datasets: [
        makeDataset("a", "a.csv", { source: { kind: "path", path: "/data/a.csv" }, importedAt: "t1" }),
      ],
    };
    const ws1 = parseWorkspace(JSON.stringify(v3));
    const serialized = serializeWorkspace(ws1);
    const doc = JSON.parse(serialized) as { version: number; workbooks: unknown[]; datasets: Array<{ workbookId?: string }> };

    expect(doc.version).toBe(4);
    expect(doc.workbooks).toHaveLength(1);
    expect(doc.datasets[0].workbookId).toBe(ws1.workbooks[0].id);

    const ws2 = parseWorkspace(serialized);
    // Identical grouping AND identical workbook ids — no scientific state lost.
    expect(ws2.workbooks).toEqual(ws1.workbooks);
    expect(ws2.datasets).toEqual(ws1.datasets);
  });

  it("a v4 doc with a dangling workbookId is reconciled with a migration warning", () => {
    const doc = {
      format: WORKSPACE_FORMAT,
      version: 4,
      datasets: [{ ...makeDataset("a", "x"), workbookId: "does-not-exist" }],
      workbooks: [{ id: "w1", name: "Elsewhere" }],
    };
    const ws = parseWorkspace(JSON.stringify(doc));

    expect(ws.datasets[0].workbookId).toBeDefined();
    expect(ws.datasets[0].workbookId).not.toBe("does-not-exist");
    expect(ws.workbooks).toHaveLength(2); // "w1" (untouched) + the re-derived one
    expect(ws.migrationWarnings.some((w) => /referenced missing workbook/.test(w))).toBe(true);
  });

  it("a v4 doc with malformed workbooks entries is sanitized without losing datasets", () => {
    const doc = {
      format: WORKSPACE_FORMAT,
      version: 4,
      datasets: [
        { ...makeDataset("a", "a"), workbookId: "w1" }, // points at the one surviving valid entry
        makeDataset("b", "b"), // no workbookId at all -> orphaned, re-derived
      ],
      workbooks: [
        { name: "no id" }, // malformed: missing id
        { id: "w1", name: "Keeper" }, // valid
        { id: "w1", name: "duplicate id, dropped" }, // dropped: duplicate id
        "not an object",
        null,
      ],
    };
    const ws = parseWorkspace(JSON.stringify(doc));

    expect(ws.datasets).toHaveLength(2); // no dataset lost
    expect(ws.datasets.find((d) => d.id === "a")!.workbookId).toBe("w1"); // valid membership preserved
    expect(ws.workbooks.find((w) => w.id === "w1")!.name).toBe("Keeper"); // first-wins, duplicate dropped
    const bWorkbookId = ws.datasets.find((d) => d.id === "b")!.workbookId;
    expect(bWorkbookId).toBeDefined();
    expect(bWorkbookId).not.toBe("w1"); // orphan re-derived into its OWN workbook
    expect(ws.workbooks.some((w) => w.id === bWorkbookId)).toBe(true);
  });

  it("workbook ids colliding with the migration counter pattern are skipped by genId (no duplicate ids)", () => {
    const doc = {
      format: WORKSPACE_FORMAT,
      version: 4,
      datasets: [
        // orphaned -- the FIRST dataset genWorkbookId would derive for is "a",
        // which would normally mint "wbm-1" as the very first generated id.
        makeDataset("a", "a.csv", { source: { kind: "path", path: "/data/a.csv" }, importedAt: "t1" }),
        { ...makeDataset("b", "b"), workbookId: "wbm-1" }, // already-valid membership, untouched
      ],
      workbooks: [{ id: "wbm-1", name: "Occupied" }],
    };
    const ws = parseWorkspace(JSON.stringify(doc));

    const ids = ws.workbooks.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids anywhere
    const aWorkbookId = ws.datasets.find((d) => d.id === "a")!.workbookId;
    expect(aWorkbookId).not.toBe("wbm-1"); // the counter skipped the occupied id
    expect(ws.datasets.find((d) => d.id === "b")!.workbookId).toBe("wbm-1"); // untouched
  });

  it("a v1 group-string doc places its derived workbooks at the Library root (deliberate)", () => {
    // group -> folder promotion happens later, in the STORE (useApp.ts's
    // loadWorkspace -> migrateGroupsToFolders) — see this module's
    // WORKSPACE_VERSION v4 comment. At PARSE time there are no folders yet,
    // so deriveWorkbooks's mostCommonFolderId falls back to root for both.
    // Membership itself is still correct; PR A3 owns any placement polish.
    const doc = {
      format: WORKSPACE_FORMAT,
      version: 1,
      datasets: [
        { ...makeDataset("a", "a.csv", { source: { kind: "path", path: "/data/a.csv" }, importedAt: "t1" }), group: "Batch A" },
        { ...makeDataset("b", "b.csv", { source: { kind: "path", path: "/data/b.csv" }, importedAt: "t2" }), group: "Batch A" },
      ],
    };
    const ws = parseWorkspace(JSON.stringify(doc));

    expect(ws.folders).toEqual([]); // parse-time: no folder migration yet
    expect(ws.workbooks).toHaveLength(2);
    expect(ws.workbooks.every((w) => w.folderId === undefined)).toBe(true);
    expect(ws.datasets.find((d) => d.id === "a")!.workbookId).toBe(
      ws.workbooks.find((w) => w.name === "a")!.id,
    );
    expect(ws.datasets.find((d) => d.id === "b")!.workbookId).toBe(
      ws.workbooks.find((w) => w.name === "b")!.id,
    );
  });

  it("rejects a version 5 document", () => {
    expect(() =>
      parseWorkspace(JSON.stringify({ format: WORKSPACE_FORMAT, version: 5, datasets: [] })),
    ).toThrow(/unsupported workspace version/);
  });

  it("an empty v4 workspace parses to empty workbooks", () => {
    const ws = parseWorkspace(JSON.stringify({ format: WORKSPACE_FORMAT, version: 4, datasets: [], workbooks: [] }));
    expect(ws.workbooks).toEqual([]);
    expect(ws.datasets).toEqual([]);
  });
});

// PR A3: applyWorkbookMigration's surrogate-folder conversion. A pre-A3
// (v1-v3) document that used a folder as a multi-sheet Origin book's
// surrogate — planOriginFolders's old shape, one folder per multi-sheet book
// under its parent — is CONVERTED, not merely derived: the folder disappears
// and its sheets land in the folder that used to be its PARENT, exactly the
// structure a fresh PR A3 import of the same project would produce.
describe("parseWorkspace surrogate-folder conversion (v1-v3, LIBRARY_WORKBOOK_UX_PLAN PR A3)", () => {
  it("a clean surrogate folder is converted: gone from folders/expandedFolders, sheets re-homed, no warning", () => {
    const doc = {
      format: WORKSPACE_FORMAT,
      version: 3,
      datasets: [
        { ...makeDataset("s1", "Proj:Book4", { originBook: "Book4" }), folderId: "bookF" },
        { ...makeDataset("s2", "Proj:Book4@2", { originBook: "Book4@2" }), folderId: "bookF" },
      ],
      folders: [
        { id: "proj", name: "Proj", parentId: null, order: 0 },
        { id: "bookF", name: "Book4", parentId: "proj", order: 0 },
      ],
      expandedFolders: ["proj", "bookF"],
    };
    const ws = parseWorkspace(JSON.stringify(doc));

    expect(ws.folders.map((f) => f.id)).toEqual(["proj"]); // "bookF" is gone
    expect(ws.expandedFolders).toEqual(["proj"]); // and out of expandedFolders too
    expect(ws.datasets.every((d) => d.folderId === "proj")).toBe(true); // re-homed to the parent
    expect(ws.workbooks).toHaveLength(1);
    const wb = ws.workbooks[0];
    expect(wb.originBook).toBe("Book4");
    expect(wb.folderId).toBe("proj");
    expect(ws.datasets.every((d) => d.workbookId === wb.id)).toBe(true);
    // Clean conversion: no warning (a big legacy project would spam dozens).
    expect(ws.migrationWarnings).toEqual([]);
  });

  it("a clean conversion produces the SAME structure a fresh PR A3 import of the equivalent project would", () => {
    const doc = {
      format: WORKSPACE_FORMAT,
      version: 3,
      datasets: [
        { ...makeDataset("s1", "Proj:Book4", { originBook: "Book4" }), folderId: "bookF" },
        { ...makeDataset("s2", "Proj:Book4@2", { originBook: "Book4@2" }), folderId: "bookF" },
      ],
      folders: [
        { id: "proj", name: "Proj", parentId: null, order: 0 },
        { id: "bookF", name: "Book4", parentId: "proj", order: 0 },
      ],
      expandedFolders: ["proj", "bookF"],
    };
    const ws = parseWorkspace(JSON.stringify(doc));

    // A fresh import would: keep only the "Proj" folder (no book-surrogate
    // folder), place the workbook AND every sheet directly at "Proj", one
    // workbook covering both sheets. The converted legacy doc matches.
    expect(ws.folders).toHaveLength(1);
    expect(ws.folders[0].name).toBe("Proj");
    expect(ws.workbooks).toHaveLength(1);
    expect(ws.datasets.map((d) => d.folderId)).toEqual([ws.folders[0].id, ws.folders[0].id]);
    expect(ws.datasets.map((d) => d.workbookId)).toEqual([ws.workbooks[0].id, ws.workbooks[0].id]);
  });

  it("a renamed surrogate folder is NOT converted — stays, no dataset re-homed", () => {
    const doc = {
      format: WORKSPACE_FORMAT,
      version: 3,
      datasets: [
        { ...makeDataset("s1", "Proj:Book4", { originBook: "Book4" }), folderId: "bookF" },
        { ...makeDataset("s2", "Proj:Book4@2", { originBook: "Book4@2" }), folderId: "bookF" },
      ],
      folders: [
        { id: "proj", name: "Proj", parentId: null, order: 0 },
        { id: "bookF", name: "Book4 (renamed)", parentId: "proj", order: 0 },
      ],
      expandedFolders: ["proj", "bookF"],
    };
    const ws = parseWorkspace(JSON.stringify(doc));

    expect(ws.folders.map((f) => f.id).sort()).toEqual(["bookF", "proj"]);
    expect(ws.expandedFolders.sort()).toEqual(["bookF", "proj"]);
    expect(ws.datasets.every((d) => d.folderId === "bookF")).toBe(true); // A1's fallback placement
  });

  it("a surrogate folder with an extra occupant is NOT converted", () => {
    const doc = {
      format: WORKSPACE_FORMAT,
      version: 3,
      datasets: [
        { ...makeDataset("s1", "Proj:Book4", { originBook: "Book4" }), folderId: "bookF" },
        { ...makeDataset("s2", "Proj:Book4@2", { originBook: "Book4@2" }), folderId: "bookF" },
        { ...makeDataset("other", "unrelated.csv"), folderId: "bookF" },
      ],
      folders: [
        { id: "proj", name: "Proj", parentId: null, order: 0 },
        { id: "bookF", name: "Book4", parentId: "proj", order: 0 },
      ],
      expandedFolders: ["proj", "bookF"],
    };
    const ws = parseWorkspace(JSON.stringify(doc));

    expect(ws.folders.map((f) => f.id).sort()).toEqual(["bookF", "proj"]);
    expect(ws.datasets.find((d) => d.id === "s1")!.folderId).toBe("bookF");
  });

  it("a surrogate folder with a child folder is NOT converted", () => {
    const doc = {
      format: WORKSPACE_FORMAT,
      version: 3,
      datasets: [
        { ...makeDataset("s1", "Proj:Book4", { originBook: "Book4" }), folderId: "bookF" },
        { ...makeDataset("s2", "Proj:Book4@2", { originBook: "Book4@2" }), folderId: "bookF" },
      ],
      folders: [
        { id: "proj", name: "Proj", parentId: null, order: 0 },
        { id: "bookF", name: "Book4", parentId: "proj", order: 0 },
        { id: "child", name: "Sub", parentId: "bookF", order: 0 },
      ],
      expandedFolders: ["proj", "bookF", "child"],
    };
    const ws = parseWorkspace(JSON.stringify(doc));

    expect(ws.folders.map((f) => f.id).sort()).toEqual(["bookF", "child", "proj"]);
    expect(ws.datasets.every((d) => d.folderId === "bookF")).toBe(true);
  });

  it("a v4 doc is untouched — no re-conversion, no re-derivation", () => {
    const doc = {
      format: WORKSPACE_FORMAT,
      version: 4,
      datasets: [{ ...makeDataset("s1", "Proj:Book4", { originBook: "Book4" }), folderId: "bookF", workbookId: "w1" }],
      folders: [
        { id: "proj", name: "Proj", parentId: null, order: 0 },
        { id: "bookF", name: "Book4", parentId: "proj", order: 0 },
      ],
      expandedFolders: ["proj", "bookF"],
      workbooks: [{ id: "w1", name: "Book4", folderId: "bookF" }],
    };
    const ws = parseWorkspace(JSON.stringify(doc));

    // "bookF" survives — v4's already-valid membership means the surrogate
    // was never even looked at by reconcileWorkbookRefs's orphan path.
    expect(ws.folders.map((f) => f.id).sort()).toEqual(["bookF", "proj"]);
    expect(ws.expandedFolders.sort()).toEqual(["bookF", "proj"]);
    expect(ws.datasets[0].folderId).toBe("bookF");
    expect(ws.workbooks).toEqual([{ id: "w1", name: "Book4", folderId: "bookF" }]);
  });
});
