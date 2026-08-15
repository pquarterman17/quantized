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
