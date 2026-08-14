import { describe, expect, it } from "vitest";

import { originSheetGroups } from "./grouping";
import type { Dataset, FolderNode } from "./types";
import { deriveWorkbooks, reconcileWorkbookRefs, sanitizeWorkbooks } from "./workbooks";

/** A fresh, deterministic id generator — same shape every test uses so
 *  determinism assertions are meaningful (a real Date.now()/Math.random() id
 *  would make "run twice, compare" trivially false for the wrong reason). */
function counterGenId(prefix = "wb"): () => string {
  let n = 0;
  return () => `${prefix}${n++}`;
}

/** Minimal Dataset builder. `originBook` stamps `data.metadata.origin_book`
 *  (the sole signal `deriveWorkbooks` reads to recognize an Origin sheet);
 *  everything else mirrors the real optional Dataset fields verbatim so a
 *  fixture reads like the store objects it stands in for. */
function ds(
  id: string,
  name: string,
  opts: {
    originBook?: string;
    folderId?: string;
    source?: { kind: "path"; path: string };
    importedAt?: string;
    pending?: boolean;
  } = {},
): Dataset {
  const metadata: Record<string, unknown> = {};
  if (opts.originBook) metadata.origin_book = opts.originBook;
  const d: Dataset = {
    id,
    name,
    data: { time: [0], values: [[0]], labels: ["y"], units: [""], metadata },
  };
  if (opts.folderId) d.folderId = opts.folderId;
  if (opts.source) d.source = opts.source;
  if (opts.importedAt) d.importedAt = opts.importedAt;
  if (opts.pending) {
    d.pending = { kind: "path", path: "/p.opj", bookId: opts.originBook ?? id, rows: 1, cols: 1 };
  }
  return d;
}

function folder(id: string, name: string, parentId: string | null, order = 0): FolderNode {
  return { id, name, parentId, order };
}

describe("deriveWorkbooks", () => {
  it("empty inputs -> empty outputs", () => {
    const result = deriveWorkbooks([], [], counterGenId());
    expect(result).toEqual({ workbooks: [], membership: {}, convertedFolderIds: [], warnings: [] });
  });

  it("is deterministic: identical inputs + a deterministic genId -> identical output", () => {
    const datasets = [
      ds("a", "Proj:Book4", { originBook: "Book4" }),
      ds("b", "Proj:Book4@2", { originBook: "Book4@2" }),
      ds("c", "scan.csv", { source: { kind: "path", path: "/data/scan.csv" }, importedAt: "t1" }),
      ds("d", "orphan-upload"),
    ];
    const folders: FolderNode[] = [];
    const r1 = deriveWorkbooks(datasets, folders, counterGenId());
    const r2 = deriveWorkbooks(datasets, folders, counterGenId());
    expect(r2).toEqual(r1);
  });

  it("totality: every dataset id appears exactly once, mapped to a real workbook", () => {
    const datasets = [
      ds("a", "Proj:Book4", { originBook: "Book4" }),
      ds("b", "Proj:Book4@2", { originBook: "Book4@2" }),
      ds("c", "scan.csv", { source: { kind: "path", path: "/data/scan.csv" }, importedAt: "t1" }),
      ds("d", "orphan-upload"),
    ];
    const result = deriveWorkbooks(datasets, [], counterGenId());
    const workbookIds = new Set(result.workbooks.map((w) => w.id));
    expect(Object.keys(result.membership).sort()).toEqual(["a", "b", "c", "d"]);
    for (const id of Object.keys(result.membership)) {
      expect(workbookIds.has(result.membership[id])).toBe(true);
    }
  });

  it("L0.2: three plain CSVs (distinct paths, importedAt set) -> three workbooks", () => {
    const datasets = [
      ds("a", "a.csv", { source: { kind: "path", path: "/data/a.csv" }, importedAt: "t1" }),
      ds("b", "b.csv", { source: { kind: "path", path: "/data/b.csv" }, importedAt: "t2" }),
      ds("c", "c.csv", { source: { kind: "path", path: "/data/c.csv" }, importedAt: "t3" }),
    ];
    const result = deriveWorkbooks(datasets, [], counterGenId());
    expect(result.workbooks).toHaveLength(3);
    expect(new Set(Object.values(result.membership)).size).toBe(3);
    expect(result.workbooks.map((w) => w.name)).toEqual(["a", "b", "c"]);
  });

  it("one path, two importedAt values -> two workbooks", () => {
    const datasets = [
      ds("a", "a.csv", { source: { kind: "path", path: "/data/a.csv" }, importedAt: "t1" }),
      ds("b", "a.csv", { source: { kind: "path", path: "/data/a.csv" }, importedAt: "t2" }),
    ];
    const result = deriveWorkbooks(datasets, [], counterGenId());
    expect(result.workbooks).toHaveLength(2);
    expect(result.membership.a).not.toBe(result.membership.b);
  });

  it("same path, importedAt absent on both -> two singletons (rule 3 fallback to rule 4)", () => {
    const datasets = [
      ds("a", "a.csv", { source: { kind: "path", path: "/data/a.csv" } }),
      ds("b", "a.csv", { source: { kind: "path", path: "/data/a.csv" } }),
    ];
    const result = deriveWorkbooks(datasets, [], counterGenId());
    expect(result.workbooks).toHaveLength(2);
    expect(result.membership.a).not.toBe(result.membership.b);
    // Rule 4 names a singleton after the DATASET, not the path stem.
    expect(result.workbooks.map((w) => w.name)).toEqual(["a.csv", "a.csv"]);
  });

  it("multi-sheet Origin book -> one workbook, members sheet-ordered, originBook set", () => {
    // Deliberately out of sheet order in the input array.
    const datasets = [
      ds("s3", "Proj:Book4@3", { originBook: "Book4@3" }),
      ds("s1", "Proj:Book4", { originBook: "Book4" }),
      ds("s2", "Proj:Book4@2", { originBook: "Book4@2" }),
    ];
    const result = deriveWorkbooks(datasets, [], counterGenId());
    expect(result.workbooks).toHaveLength(1);
    const wb = result.workbooks[0];
    expect(wb.name).toBe("Book4");
    expect(wb.originBook).toBe("Book4");
    expect(result.membership.s1).toBe(wb.id);
    expect(result.membership.s2).toBe(wb.id);
    expect(result.membership.s3).toBe(wb.id);
  });

  it("two Origin imports each containing 'Book1' (different stems) -> two workbooks, never merged", () => {
    const datasets = [
      ds("a", "ProjA:Book1", { originBook: "Book1" }),
      ds("b", "ProjB:Book1", { originBook: "Book1" }),
    ];
    const result = deriveWorkbooks(datasets, [], counterGenId());
    expect(result.workbooks).toHaveLength(2);
    expect(result.membership.a).not.toBe(result.membership.b);
    expect(result.workbooks.every((w) => w.originBook === "Book1")).toBe(true);
  });

  it("single-sheet Origin book still gets a visible workbook container", () => {
    const datasets = [ds("a", "Proj:Book1", { originBook: "Book1" })];
    const result = deriveWorkbooks(datasets, [], counterGenId());
    expect(result.workbooks).toHaveLength(1);
    expect(result.workbooks[0].originBook).toBe("Book1");
    expect(result.membership.a).toBe(result.workbooks[0].id);
  });

  it("a lazy pending Origin sheet carries data.metadata.origin_book and groups normally", () => {
    // Verified against store/useApp.test.ts ("builds a pending dataset from a
    // lazy entry's preview + book_source"): addFromPayload copies the
    // LazyBookEntry's own `metadata` verbatim onto the created dataset's
    // `data.metadata`, so `origin_book` survives on a pending dataset exactly
    // as it does on an eager one. Not a contract gap — no special-casing needed.
    const datasets = [
      ds("s1", "Proj:Book2", { originBook: "Book2" }),
      ds("s2", "Proj:Book2@2", { originBook: "Book2@2", pending: true }),
    ];
    expect(datasets[1].pending).toBeDefined();
    expect((datasets[1].data.metadata as Record<string, unknown>).origin_book).toBe("Book2@2");
    const result = deriveWorkbooks(datasets, [], counterGenId());
    expect(result.workbooks).toHaveLength(1);
    expect(result.membership.s1).toBe(result.membership.s2);
  });

  describe("surrogate folder conversion (rule 2)", () => {
    const sheets = () => [
      ds("s1", "Proj:Book4", { originBook: "Book4", folderId: "bookF" }),
      ds("s2", "Proj:Book4@2", { originBook: "Book4@2", folderId: "bookF" }),
    ];

    it("exact match -> converted, workbook lands at the surrogate folder's parent", () => {
      const folders = [folder("proj", "Proj", null), folder("bookF", "Book4", "proj")];
      const result = deriveWorkbooks(sheets(), folders, counterGenId());
      expect(result.convertedFolderIds).toEqual(["bookF"]);
      expect(result.workbooks[0].folderId).toBe("proj");
      expect(result.warnings).toEqual([]);
    });

    it("renamed surrogate folder -> NOT converted", () => {
      const folders = [folder("proj", "Proj", null), folder("bookF", "Book4 (renamed)", "proj")];
      const result = deriveWorkbooks(sheets(), folders, counterGenId());
      expect(result.convertedFolderIds).toEqual([]);
      expect(result.workbooks[0].folderId).toBe("bookF");
    });

    it("an extra unrelated occupant -> NOT converted", () => {
      const folders = [folder("proj", "Proj", null), folder("bookF", "Book4", "proj")];
      const datasets = [...sheets(), ds("other", "unrelated", { folderId: "bookF" })];
      const result = deriveWorkbooks(datasets, folders, counterGenId());
      expect(result.convertedFolderIds).toEqual([]);
      const wb = result.workbooks.find((w) => w.originBook === "Book4")!;
      expect(wb.folderId).toBe("bookF");
    });

    it("a child folder under the surrogate -> NOT converted", () => {
      const folders = [
        folder("proj", "Proj", null),
        folder("bookF", "Book4", "proj"),
        folder("child", "Sub", "bookF"),
      ];
      const result = deriveWorkbooks(sheets(), folders, counterGenId());
      expect(result.convertedFolderIds).toEqual([]);
      expect(result.workbooks[0].folderId).toBe("bookF");
    });

    it("members spread across two folders -> NOT converted, deterministic placement + warning", () => {
      const folders = [folder("A", "A", null), folder("B", "B", null)];
      const datasets = [
        ds("s1", "Proj:Book4", { originBook: "Book4", folderId: "A" }),
        ds("s2", "Proj:Book4@2", { originBook: "Book4@2", folderId: "A" }),
        ds("s3", "Proj:Book4@3", { originBook: "Book4@3", folderId: "B" }),
      ];
      const result = deriveWorkbooks(datasets, folders, counterGenId());
      expect(result.convertedFolderIds).toEqual([]);
      expect(result.workbooks[0].folderId).toBe("A"); // majority (2 of 3)
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/more than one folder/);
    });

    it("a 1-1 folder split ties broken by the first member", () => {
      const folders = [folder("A", "A", null), folder("B", "B", null)];
      const datasets = [
        ds("s1", "Proj:Book4", { originBook: "Book4", folderId: "B" }),
        ds("s2", "Proj:Book4@2", { originBook: "Book4@2", folderId: "A" }),
      ];
      const result = deriveWorkbooks(datasets, folders, counterGenId());
      expect(result.workbooks[0].folderId).toBe("B"); // first member's folder wins the tie
    });
  });

  it("agrees with lib/grouping.ts's originSheetGroups on the multi-sheet partition", () => {
    const datasets = [
      ds("m1", "Proj:Book4", { originBook: "Book4" }),
      ds("m2", "Proj:Book4@2", { originBook: "Book4@2" }),
      ds("single", "Proj:Book9", { originBook: "Book9" }), // excluded by originSheetGroups
      ds("plain", "notes.csv", { source: { kind: "path", path: "/data/notes.csv" }, importedAt: "t1" }),
    ];
    const renderGroups = originSheetGroups(datasets);
    expect(renderGroups).toHaveLength(1); // the single-sheet book is excluded here

    const result = deriveWorkbooks(datasets, [], counterGenId());
    for (const g of renderGroups) {
      const wb = result.workbooks.find((w) => w.originBook === g.parent)!;
      expect(wb).toBeDefined();
      const memberIdsInWorkbook = Object.entries(result.membership)
        .filter(([, wbId]) => wbId === wb.id)
        .map(([dsId]) => dsId);
      expect(memberIdsInWorkbook.sort()).toEqual(g.members.map((d) => d.id).sort());
    }
    // ...but deriveWorkbooks still gives the excluded single-sheet book its
    // own workbook (the acceptance gate originSheetGroups deliberately skips).
    const singleWb = result.workbooks.find((w) => w.originBook === "Book9");
    expect(singleWb).toBeDefined();
    expect(result.membership.single).toBe(singleWb!.id);
  });
});

describe("sanitizeWorkbooks", () => {
  it("valid entries pass through unchanged", () => {
    const raw = [{ id: "w1", name: "Book1", folderId: "f1", order: 2, originBook: "Book1" }];
    const result = sanitizeWorkbooks(raw, new Set(["f1"]));
    expect(result).toEqual([{ id: "w1", name: "Book1", folderId: "f1", order: 2, originBook: "Book1" }]);
  });

  it("drops malformed entries (missing id/name, non-object, duplicate id)", () => {
    const raw = [
      { name: "no id" },
      { id: "w1" }, // no name
      null,
      "not an object",
      { id: "w2", name: "ok" },
      { id: "w2", name: "duplicate, dropped" },
    ];
    const result = sanitizeWorkbooks(raw, new Set());
    expect(result).toEqual([{ id: "w2", name: "ok" }]);
  });

  it("clears (but keeps) a workbook whose folderId names no known folder", () => {
    const raw = [{ id: "w1", name: "Book1", folderId: "ghost" }];
    const result = sanitizeWorkbooks(raw, new Set(["real"]));
    expect(result).toEqual([{ id: "w1", name: "Book1" }]);
  });

  it("drops bad optional fields without dropping the workbook", () => {
    const raw = [{ id: "w1", name: "Book1", order: "not a number", source: { kind: "path" } }];
    const result = sanitizeWorkbooks(raw, new Set());
    expect(result).toEqual([{ id: "w1", name: "Book1" }]);
  });

  it("non-array input -> empty", () => {
    expect(sanitizeWorkbooks(undefined, new Set())).toEqual([]);
    expect(sanitizeWorkbooks({ not: "an array" }, new Set())).toEqual([]);
  });
});

describe("reconcileWorkbookRefs", () => {
  it("leaves an already-valid membership untouched", () => {
    const workbooks = [{ id: "w1", name: "Book1" }];
    const datasets = [ds("a", "Proj:Book1", { originBook: "Book1" })];
    datasets[0].workbookId = "w1";
    const result = reconcileWorkbookRefs(datasets, workbooks, [], counterGenId());
    expect(result.membership.a).toBe("w1");
    expect(result.workbooks).toEqual(workbooks);
    expect(result.warnings).toEqual([]);
  });

  it("re-derives a workbook for a dangling workbookId and warns", () => {
    const workbooks = [{ id: "w1", name: "Book1" }];
    const datasets = [ds("a", "Proj:Book1", { originBook: "Book1" })];
    datasets[0].workbookId = "does-not-exist";
    const result = reconcileWorkbookRefs(datasets, workbooks, [], counterGenId());
    expect(result.membership.a).toBeDefined();
    expect(result.membership.a).not.toBe("w1");
    expect(result.workbooks).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
  });

  it("re-derives silently (no warning) for a dataset with no workbookId at all", () => {
    const datasets = [ds("a", "plain")];
    const result = reconcileWorkbookRefs(datasets, [], [], counterGenId());
    expect(result.membership.a).toBeDefined();
    expect(result.warnings).toEqual([]);
  });

  it("totality across a mix of valid and orphaned datasets", () => {
    const workbooks = [{ id: "w1", name: "Book1" }];
    const a = ds("a", "Proj:Book1", { originBook: "Book1" });
    a.workbookId = "w1";
    const b = ds("b", "plain-upload"); // no workbookId
    const c = ds("c", "Proj:Book2", { originBook: "Book2" });
    c.workbookId = "gone";
    const result = reconcileWorkbookRefs([a, b, c], workbooks, [], counterGenId());
    expect(Object.keys(result.membership).sort()).toEqual(["a", "b", "c"]);
    expect(result.membership.a).toBe("w1");
  });
});
