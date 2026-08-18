import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import type { LoadedWorkspace } from "./workspace";
import { mergeWorkspace } from "./workspaceMerge";
import type { WorkbookNode } from "./workbooks";

// Moved out of workspace.test.ts alongside the RSM_CUTS_PLAN item 13
// extraction (mergeWorkspace -> lib/workspaceMerge.ts) — same tests,
// unchanged, now living beside the module they exercise. Extended for
// LIBRARY_WORKBOOK_UX_PLAN PR A4 (workbook transfer replaces A2's blanket
// `workbookId` strip) — see the "workbook transfer (PR A4)" describe block.

function makeDataset(id: string, name: string): Dataset {
  return {
    id,
    name,
    data: {
      time: [0, 1, 2],
      values: [[10, 100], [20, 200], [30, 300]],
      labels: ["A", "B"],
      units: ["emu", "Oe"],
      metadata: { source: "test" },
    },
  };
}

function makeWorkbook(id: string, name: string): WorkbookNode {
  return { id, name };
}

describe("mergeWorkspace (MAIN_PLAN #16 — Append workspace)", () => {
  // A minimal LoadedWorkspace wrapper — mergeWorkspace only ever reads
  // `.datasets` and (as of PR A4) `.workbooks` (see the module's doc for why
  // every other field is ignored).
  function asLoaded(datasets: Dataset[], workbooks: WorkbookNode[] = []): LoadedWorkspace {
    return {
      datasets,
      folders: [],
      workbooks,
      activeId: null,
      selectedIds: [],
      expandedFolders: [],
      originFigures: [],
      originFidelity: [],
      smartFolders: [],
      reports: [],
      macroSteps: [],
      recalcMode: "auto",
      figureDocs: [],
      editableFigures: [],
      pages: [],
      migrationWarnings: [],
      plotWindows: [],
      focusedWindowId: null,
      toolWindowLayout: {},
      savedPlotSpecs: [],
      techniqueViewMemory: {},
      savedRois: [],
      quickPlotTemplates: [],
      librarySelection: null,
      workbookLastChild: {},
      expandedWorkbookIds: [],
    };
  }

  let idSeq = 0;
  const genId = () => `merged-${++idSeq}`;
  let wbSeq = 0;
  const genWorkbookId = () => `wb-merged-${++wbSeq}`;
  beforeEach(() => {
    idSeq = 0;
    wbSeq = 0;
  });

  // Used by every test that doesn't care about workbook-id collisions with
  // the destination — the vast majority of the dataset-focused tests below
  // predate PR A4 and never touch a workbook.
  const noCurrentWorkbookIds = new Set<string>();

  it("appends with no collisions: ids/names untouched, per-dataset fields ride along", () => {
    const current = [makeDataset("a", "first")];
    const incoming = makeDataset("b", "second");
    incoming.tags = ["MvsH"];
    incoming.notes = "sample notes";
    incoming.formulas = [{ name: "ratio", expr: "A/B" }];

    const result = mergeWorkspace(
      current,
      asLoaded([incoming]),
      genId,
      noCurrentWorkbookIds,
      genWorkbookId,
    );

    expect(result.datasets).toHaveLength(2);
    expect(result.datasets[0]).toBe(current[0]); // current is reused, not cloned
    expect(result.datasets[1].id).toBe("b");
    expect(result.datasets[1].name).toBe("second");
    expect(result.datasets[1].tags).toEqual(["MvsH"]);
    expect(result.datasets[1].notes).toBe("sample notes");
    expect(result.datasets[1].formulas).toEqual([{ name: "ratio", expr: "A/B" }]);
    expect(result.remapped).toBe(0);
    expect(result.renamed).toBe(0);
    expect(result.droppedBgRefs).toBe(0);
    expect(result.droppedFolderRefs).toBe(0);
    expect(result.droppedWorkbookRefs).toBe(0);
    expect(result.workbooks).toEqual([]);
  });

  it("remaps an incoming dataset id that collides with a CURRENT id (existing dataset untouched)", () => {
    const current = [makeDataset("a", "first")];
    const incoming = makeDataset("a", "duplicate-id");

    const result = mergeWorkspace(
      current,
      asLoaded([incoming]),
      genId,
      noCurrentWorkbookIds,
      genWorkbookId,
    );

    expect(result.datasets[0]).toBe(current[0]); // existing "a" is untouched
    expect(result.datasets[1].id).toBe("merged-1"); // incoming "a" got a fresh id
    expect(result.datasets[1].name).toBe("duplicate-id");
    expect(result.remapped).toBe(1);
  });

  it("remaps incoming-vs-incoming id collisions too (a hand-edited/duplicated .dwk)", () => {
    const dup1 = makeDataset("x", "first-x");
    const dup2 = makeDataset("x", "second-x");

    const result = mergeWorkspace(
      [],
      asLoaded([dup1, dup2]),
      genId,
      noCurrentWorkbookIds,
      genWorkbookId,
    );

    expect(result.datasets[0].id).toBe("x"); // first keeps the original id
    expect(result.datasets[1].id).toBe("merged-1"); // second gets remapped
    expect(result.remapped).toBe(1);
  });

  it("suffixes an incoming NAME collision Origin-style: ' (2)', ' (3)', …", () => {
    const current = [makeDataset("a", "sample")];
    const incoming = [makeDataset("b", "sample"), makeDataset("c", "sample")];

    const result = mergeWorkspace(
      current,
      asLoaded(incoming),
      genId,
      noCurrentWorkbookIds,
      genWorkbookId,
    );

    expect(result.datasets.map((d) => d.name)).toEqual(["sample", "sample (2)", "sample (3)"]);
    expect(result.renamed).toBe(2);
  });

  it("remaps a bgRef pointing at ANOTHER incoming dataset, including a forward reference", () => {
    // "data" (index 0) references "bg" (index 1) — a forward reference, the
    // case the two-pass id assignment exists to handle.
    const data = { ...makeDataset("data", "sample"), bgRef: { datasetId: "bg", interp: "pchip" } };
    const bg = makeDataset("bg", "background");

    const result = mergeWorkspace(
      [],
      asLoaded([data, bg]),
      genId,
      noCurrentWorkbookIds,
      genWorkbookId,
    );

    const dataDs = result.datasets.find((d) => d.name === "sample")!;
    const bgDs = result.datasets.find((d) => d.name === "background")!;
    expect(dataDs.bgRef).toEqual({ datasetId: bgDs.id, interp: "pchip" });
    expect(result.droppedBgRefs).toBe(0);
  });

  it("remaps a bgRef to the target's REMAPPED id when the target's original id collides", () => {
    const current = [makeDataset("bg", "existing background")]; // occupies id "bg"
    const data = { ...makeDataset("data", "sample"), bgRef: { datasetId: "bg", interp: "linear" } };
    const bg = makeDataset("bg", "incoming background"); // collides -> remapped

    const result = mergeWorkspace(
      current,
      asLoaded([data, bg]),
      genId,
      noCurrentWorkbookIds,
      genWorkbookId,
    );

    const dataDs = result.datasets.find((d) => d.name === "sample")!;
    const bgDs = result.datasets.find((d) => d.name === "incoming background")!;
    expect(bgDs.id).not.toBe("bg");
    expect(dataDs.bgRef?.datasetId).toBe(bgDs.id);
    expect(result.remapped).toBe(1);
    expect(result.droppedBgRefs).toBe(0);
  });

  it("drops a bgRef targeting an id outside the incoming batch (counted, never crashes)", () => {
    const incoming = {
      ...makeDataset("a", "sample"),
      bgRef: { datasetId: "does-not-exist", interp: "linear" },
    };

    const result = mergeWorkspace(
      [],
      asLoaded([incoming]),
      genId,
      noCurrentWorkbookIds,
      genWorkbookId,
    );

    expect(result.datasets[0].bgRef).toBeUndefined();
    expect(result.droppedBgRefs).toBe(1);
  });

  it("drops folderId on every incoming dataset — no folder tree is merged in (non-reference fields like order ride along)", () => {
    const incoming = { ...makeDataset("a", "in-folder"), folderId: "f1", order: 3 };

    const result = mergeWorkspace(
      [],
      asLoaded([incoming]),
      genId,
      noCurrentWorkbookIds,
      genWorkbookId,
    );

    expect(result.datasets[0].folderId).toBeUndefined();
    expect(result.datasets[0].order).toBe(3);
    expect(result.droppedFolderRefs).toBe(1);
    expect(result.droppedWorkbookRefs).toBe(0);
  });

  // LIBRARY_WORKBOOK_UX_PLAN PR A4: supersedes A2's blanket strip. A2's test
  // here ("strips workbookId on every incoming dataset") asserted that EVERY
  // incoming `workbookId` was cleared, unconditionally, because A4 didn't
  // exist yet. Now a RESOLVABLE `workbookId` gets real transfer (see the
  // "workbook transfer (PR A4)" describe block below) — only a genuinely
  // unresolvable ref (names no incoming workbook at all: a hand-edited or
  // corrupt .dwk) still gets cleared. This is a deliberate contract change,
  // not a weakening — droppedWorkbookRefs is narrower on purpose.
  it("clears a workbookId that resolves to NO incoming workbook (unresolvable — narrowed from A2's blanket strip)", () => {
    const incoming = [
      { ...makeDataset("a", "dangling-ref"), workbookId: "does-not-exist" },
      makeDataset("c", "workbook-less"), // never had one
    ];

    const result = mergeWorkspace(
      [],
      asLoaded(incoming), // no incoming.workbooks at all
      genId,
      noCurrentWorkbookIds,
      genWorkbookId,
    );

    expect(result.datasets.every((d) => d.workbookId === undefined)).toBe(true);
    expect(result.droppedWorkbookRefs).toBe(1); // "c" never had one, doesn't count
    expect(result.workbooks).toEqual([]);
    // No dangling reference anywhere — the field is simply absent, not
    // pointing at an id that resolves to nothing.
    expect(result.datasets.every((d) => !("workbookId" in d) || d.workbookId === undefined)).toBe(
      true,
    );
  });

  it("appending an empty incoming workspace is a no-op over current", () => {
    const current = [makeDataset("a", "first")];
    const result = mergeWorkspace(
      current,
      asLoaded([]),
      genId,
      noCurrentWorkbookIds,
      genWorkbookId,
    );
    expect(result.datasets).toEqual(current);
    expect(result.remapped).toBe(0);
    expect(result.renamed).toBe(0);
    expect(result.workbooks).toEqual([]);
  });

  describe("workbook transfer (PR A4)", () => {
    it("transfers a referenced workbook with a FRESH id, folderId cleared, provenance intact", () => {
      const wb: WorkbookNode = {
        id: "src-wb-1",
        name: "Book4",
        folderId: "some-folder",
        order: 5,
        originBook: "Book4",
      };
      const d1 = { ...makeDataset("a", "sheet1"), workbookId: "src-wb-1" };
      const d2 = { ...makeDataset("b", "sheet2"), workbookId: "src-wb-1" };

      const result = mergeWorkspace(
        [],
        asLoaded([d1, d2], [wb]),
        genId,
        noCurrentWorkbookIds,
        genWorkbookId,
      );

      expect(result.workbooks).toHaveLength(1);
      const transferred = result.workbooks[0];
      expect(transferred.id).not.toBe("src-wb-1"); // never reuses the incoming id
      expect(transferred.name).toBe("Book4");
      expect(transferred.originBook).toBe("Book4");
      expect(transferred.folderId).toBeUndefined(); // lands at Library root
      expect(transferred.order).toBeUndefined();

      for (const ds of result.datasets) {
        expect(ds.workbookId).toBe(transferred.id);
      }
      expect(result.droppedWorkbookRefs).toBe(0);
    });

    it("round-trip: a multi-member Origin book + a single-member path import both transfer; every appended workbookId resolves (zero dangling refs)", () => {
      const bookWb: WorkbookNode = {
        id: "src-book",
        name: "Book7",
        originBook: "Book7",
        folderId: "origin-folder",
      };
      const pathWb: WorkbookNode = {
        id: "src-path",
        name: "scan1",
        source: { kind: "path", path: "C:/data/scan1.dat" },
        importedAt: "2026-08-01T00:00:00.000Z",
      };
      const sheet1 = { ...makeDataset("s1", "Book7 sheet1"), workbookId: "src-book" };
      const sheet2 = { ...makeDataset("s2", "Book7 sheet2"), workbookId: "src-book" };
      const scan = { ...makeDataset("s3", "scan1.dat"), workbookId: "src-path" };

      const result = mergeWorkspace(
        [],
        asLoaded([sheet1, sheet2, scan], [bookWb, pathWb]),
        genId,
        noCurrentWorkbookIds,
        genWorkbookId,
      );

      expect(result.workbooks).toHaveLength(2);
      const byOriginBook = result.workbooks.find((w) => w.originBook === "Book7");
      const byPath = result.workbooks.find((w) => w.source?.path === "C:/data/scan1.dat");
      expect(byOriginBook).toBeDefined();
      expect(byPath).toBeDefined();
      expect(byOriginBook!.id).not.toBe("src-book");
      expect(byPath!.id).not.toBe("src-path");
      expect(byPath!.importedAt).toBe("2026-08-01T00:00:00.000Z");
      expect(byOriginBook!.folderId).toBeUndefined();
      expect(byPath!.folderId).toBeUndefined();

      // Exhaustive: every workbookId anywhere in the result resolves to a
      // transferred workbook — no dangling reference.
      const transferredIds = new Set(result.workbooks.map((w) => w.id));
      for (const ds of result.datasets) {
        expect(ds.workbookId).toBeDefined();
        expect(transferredIds.has(ds.workbookId!)).toBe(true);
      }
      expect(result.droppedWorkbookRefs).toBe(0);
    });

    it("fresh-id policy: an incoming workbook id identical to a CURRENT workbook id transfers under a DIFFERENT id — both present, incoming id never appears", () => {
      const currentWorkbookIds = new Set(["wb-shared"]);
      const wb: WorkbookNode = { id: "wb-shared", name: "incoming book" };
      const d = { ...makeDataset("a", "sheet"), workbookId: "wb-shared" };

      const result = mergeWorkspace(
        [],
        asLoaded([d], [wb]),
        genId,
        currentWorkbookIds,
        genWorkbookId,
      );

      expect(result.workbooks).toHaveLength(1);
      expect(result.workbooks[0].id).not.toBe("wb-shared");
      expect(currentWorkbookIds.has(result.workbooks[0].id)).toBe(false);
      expect(result.datasets[0].workbookId).toBe(result.workbooks[0].id);
    });

    it("fresh-id policy: an incoming workbook id with NO collision at all still never appears in the result (unconditional freshness)", () => {
      const wb = makeWorkbook("totally-unique-id", "Book1");
      const d = { ...makeDataset("a", "sheet"), workbookId: "totally-unique-id" };

      const result = mergeWorkspace(
        [],
        asLoaded([d], [wb]),
        genId,
        noCurrentWorkbookIds, // empty — no collision is even possible
        genWorkbookId,
      );

      expect(result.workbooks[0].id).not.toBe("totally-unique-id");
      expect(result.workbooks.some((w) => w.id === "totally-unique-id")).toBe(false);
    });

    it("does not transfer a workbook referenced by ZERO incoming datasets (memberless clutter)", () => {
      const wb = makeWorkbook("orphan-wb", "nobody references me");
      const d = makeDataset("a", "standalone"); // no workbookId at all

      const result = mergeWorkspace(
        [],
        asLoaded([d], [wb]),
        genId,
        noCurrentWorkbookIds,
        genWorkbookId,
      );

      expect(result.workbooks).toEqual([]);
      expect(result.datasets[0].workbookId).toBeUndefined();
      expect(result.droppedWorkbookRefs).toBe(0); // "a" never had a workbookId to drop
    });

    it("clears+counts a workbookId that names no incoming workbook, without disturbing OTHER datasets' resolvable transfers", () => {
      const wb = makeWorkbook("src-wb", "real book");
      const good = { ...makeDataset("a", "sheet1"), workbookId: "src-wb" };
      const dangling = { ...makeDataset("b", "corrupt-ref"), workbookId: "does-not-exist" };

      const result = mergeWorkspace(
        [],
        asLoaded([good, dangling], [wb]),
        genId,
        noCurrentWorkbookIds,
        genWorkbookId,
      );

      expect(result.workbooks).toHaveLength(1);
      const goodDs = result.datasets.find((d) => d.name === "sheet1")!;
      const danglingDs = result.datasets.find((d) => d.name === "corrupt-ref")!;
      expect(goodDs.workbookId).toBe(result.workbooks[0].id);
      expect(danglingDs.workbookId).toBeUndefined();
      expect(result.droppedWorkbookRefs).toBe(1);
    });

    it("is deterministic with counter generators: identical input twice -> identical workbook transfer", () => {
      const wb = makeWorkbook("src", "Book1");
      const d = { ...makeDataset("a", "sheet"), workbookId: "src" };
      const ws = asLoaded([d], [wb]);

      idSeq = 0;
      wbSeq = 0;
      const r1 = mergeWorkspace([], ws, genId, noCurrentWorkbookIds, genWorkbookId);
      idSeq = 0;
      wbSeq = 0;
      const r2 = mergeWorkspace([], ws, genId, noCurrentWorkbookIds, genWorkbookId);

      expect(r1.workbooks).toEqual(r2.workbooks);
      expect(r1.datasets.map((d) => d.workbookId)).toEqual(r2.datasets.map((d) => d.workbookId));
    });
  });
});

describe("mergeWorkspace never imports the LIBRARY_WORKBOOK_UX_PLAN PR E2 session fields (PR C's existing precedent)", () => {
  // The module header's field matrix already lists activeId/selectedIds/
  // plotWindows/etc. as "never merged in at all" — E2's three new
  // LoadedWorkspace fields (librarySelection/workbookLastChild/
  // expandedWorkbookIds) join that same list: an append only ever reads
  // `.datasets` and `.workbooks` off the incoming doc.
  it("ignores librarySelection/workbookLastChild/expandedWorkbookIds on the incoming doc", () => {
    const current = [makeDataset("a", "first")];
    const incoming: LoadedWorkspace = {
      datasets: [makeDataset("b", "second")],
      folders: [],
      workbooks: [],
      activeId: null,
      selectedIds: [],
      expandedFolders: [],
      originFigures: [],
      originFidelity: [],
      smartFolders: [],
      reports: [],
      macroSteps: [],
      recalcMode: "auto",
      figureDocs: [],
      editableFigures: [],
      pages: [],
      migrationWarnings: [],
      plotWindows: [],
      focusedWindowId: null,
      toolWindowLayout: {},
      savedPlotSpecs: [],
      techniqueViewMemory: {},
      savedRois: [],
      quickPlotTemplates: [],
      // "Poisoned" values a merge that DID read these would leak/react to.
      librarySelection: { kind: "folder", id: "poison" },
      workbookLastChild: { poison: "worksheet:x" },
      expandedWorkbookIds: ["poison"],
    };
    const genId2 = () => "unused";
    const genWorkbookId2 = () => "unused-wb";

    const result = mergeWorkspace(current, incoming, genId2, new Set<string>(), genWorkbookId2);

    // The merge succeeds exactly as it would with those fields absent...
    expect(result.datasets.map((d) => d.id)).toEqual(["a", "b"]);
    // ...and the result carries none of them through.
    expect(result).not.toHaveProperty("librarySelection");
    expect(result).not.toHaveProperty("workbookLastChild");
    expect(result).not.toHaveProperty("expandedWorkbookIds");
  });
});
