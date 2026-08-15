import { beforeEach, describe, expect, it } from "vitest";

import { planOriginImport } from "./originFolders";
import type { Dataset } from "./types";

let fseq = 0;
let wseq = 0;
const genFolder = () => `f${++fseq}`;
const genWorkbook = () => `w${++wseq}`;
beforeEach(() => {
  fseq = 0;
  wseq = 0;
});

// `name` mirrors real production naming (store/importDatasets.ts's
// addFromPayload builds every book-sheet dataset as `"<stem>:<label>"`
// BEFORE calling the planner) — deriveWorkbooks's Origin grouping key reads
// that stem prefix off `d.name` (lib/grouping.ts's `importStem`), so a
// fixture using a bare id as the name would scope every sheet into its OWN
// group instead of grouping by book.
const ds = (stem: string, id: string, book?: string, path?: string[]): Dataset => ({
  id,
  name: `${stem}:${book ?? id}`,
  data: {
    time: [],
    values: [],
    labels: [],
    units: [],
    metadata: {
      ...(book !== undefined ? { origin_book: book } : {}),
      ...(path !== undefined ? { origin_folder_path: path } : {}),
    },
  },
});

// folderId → name, for readable assertions
const nameOf = (plan: { folders: { id: string; name: string }[] }) =>
  new Map(plan.folders.map((f) => [f.id, f.name]));

describe("planOriginImport", () => {
  it("fallback: single-sheet books with no folder path sit directly in the project folder", () => {
    const plan = planOriginImport(
      "Moke",
      [ds("Moke", "d1", "Book1"), ds("Moke", "d2", "Book2")],
      genFolder,
      genWorkbook,
    );
    expect(plan.folders.map((f) => f.name)).toEqual(["Moke"]); // just the project folder
    const project = plan.folders[0].id;
    expect(plan.folderMembership).toEqual({ d1: project, d2: project });
    expect(plan.expanded).toEqual([project]);
    // L0.1: EVERY book gets a workbook, including single-sheet ones.
    expect(plan.workbooks).toHaveLength(2);
    expect(plan.workbooks.map((w) => w.name).sort()).toEqual(["Book1", "Book2"]);
    expect(plan.workbooks.every((w) => w.folderId === project)).toBe(true);
    expect(plan.workbookMembership.d1).toBeDefined();
    expect(plan.workbookMembership.d2).toBeDefined();
    expect(plan.workbookMembership.d1).not.toBe(plan.workbookMembership.d2);
  });

  it("a multi-sheet book gets ONE workbook and no book-surrogate folder", () => {
    const plan = planOriginImport(
      "X",
      [ds("X", "s1", "Book4"), ds("X", "s2", "Book4@2"), ds("X", "s3", "Book4@3")],
      genFolder,
      genWorkbook,
    );
    // project "X" only — no "Book4" folder any more (L0.1: the book IS the workbook).
    expect(plan.folders.map((f) => f.name)).toEqual(["X"]);
    const project = plan.folders[0].id;
    expect(plan.folderMembership).toEqual({ s1: project, s2: project, s3: project });
    expect(plan.workbooks).toHaveLength(1);
    const wb = plan.workbooks[0];
    expect(wb.name).toBe("Book4");
    expect(wb.originBook).toBe("Book4");
    expect(wb.folderId).toBe(project);
    expect(plan.workbookMembership).toEqual({ s1: wb.id, s2: wb.id, s3: wb.id });
  });

  it("materializes the Origin Project Explorer folder paths (Moke case), one workbook per book", () => {
    const plan = planOriginImport(
      "Moke",
      [
        ds("Moke", "d1", "Book1", ["Raw normalized"]),
        ds("Moke", "d2", "Book2", ["Raw normalized"]),
        ds("Moke", "d3", "Book4", ["Sub subtraction"]),
        ds("Moke", "d4", "Book4@2", ["Sub subtraction"]),
        ds("Moke", "d5", "Book5", ["Sub subtraction"]),
      ],
      genFolder,
      genWorkbook,
    );
    const names = nameOf(plan);
    // Moke → {Raw normalized, Sub subtraction} — no Book4 folder any more.
    expect(plan.folders.map((f) => f.name)).toEqual(["Moke", "Raw normalized", "Sub subtraction"]);
    const raw = plan.folders[1].id;
    const sub = plan.folders[2].id;
    expect(names.get(plan.folders[1].parentId!)).toBe("Moke");
    expect(names.get(plan.folders[2].parentId!)).toBe("Moke");
    expect(plan.folderMembership.d1).toBe(raw);
    expect(plan.folderMembership.d2).toBe(raw);
    expect(plan.folderMembership.d3).toBe(sub); // sheets of Book4 land in the PATH folder now
    expect(plan.folderMembership.d4).toBe(sub);
    expect(plan.folderMembership.d5).toBe(sub);

    // Four workbooks: Book1, Book2 (each singleton), Book4 (2-sheet), Book5 (singleton).
    expect(plan.workbooks).toHaveLength(4);
    const byBook = new Map(plan.workbooks.map((w) => [w.originBook, w]));
    expect(byBook.get("Book1")!.folderId).toBe(raw);
    expect(byBook.get("Book2")!.folderId).toBe(raw);
    expect(byBook.get("Book4")!.folderId).toBe(sub);
    expect(byBook.get("Book5")!.folderId).toBe(sub);
    expect(plan.workbookMembership.d3).toBe(byBook.get("Book4")!.id);
    expect(plan.workbookMembership.d4).toBe(byBook.get("Book4")!.id);
  });

  it("creates nested intermediate folders for a deep path and reuses them", () => {
    const plan = planOriginImport(
      "P",
      [
        ds("P", "d1", "B1", ["A", "B"]),
        ds("P", "d2", "B2", ["A", "B"]),
        ds("P", "d3", "B3", ["A"]),
      ],
      genFolder,
      genWorkbook,
    );
    const names = nameOf(plan);
    // P → A → B ; A and B each created once, shared
    expect(plan.folders.map((f) => f.name)).toEqual(["P", "A", "B"]);
    const a = plan.folders[1].id;
    const b = plan.folders[2].id;
    expect(names.get(plan.folders[2].parentId!)).toBe("A"); // B under A
    expect(plan.folderMembership.d1).toBe(b);
    expect(plan.folderMembership.d2).toBe(b); // reused, not duplicated
    expect(plan.folderMembership.d3).toBe(a); // one level up
    expect(plan.workbooks).toHaveLength(3); // B1, B2, B3 each their own workbook
  });

  it("all created folders are expanded and the project folder leads", () => {
    const plan = planOriginImport("P", [ds("P", "d1", "B", ["A"])], genFolder, genWorkbook);
    expect(plan.expanded).toEqual(plan.folders.map((f) => f.id));
    expect(plan.folders[0].name).toBe("P");
    expect(plan.folders[0].parentId).toBeNull();
  });

  it("an unstamped dataset (no origin_book) gets its own singleton workbook", () => {
    const plain: Dataset = {
      id: "u1",
      name: "u1",
      data: { time: [], values: [], labels: [], units: [], metadata: {} },
    };
    const plan = planOriginImport("P", [plain], genFolder, genWorkbook);
    expect(plan.workbooks).toHaveLength(1);
    expect(plan.workbookMembership.u1).toBe(plan.workbooks[0].id);
  });

  it("workbook membership is TOTAL: every input dataset appears in both maps exactly once", () => {
    const datasets = [
      ds("P", "d1", "Book1", ["Raw"]),
      ds("P", "d2", "Book4", ["Sub"]),
      ds("P", "d3", "Book4@2", ["Sub"]),
      { id: "d4", name: "d4", data: { time: [], values: [], labels: [], units: [], metadata: {} } }, // unstamped
    ];
    const plan = planOriginImport("P", datasets, genFolder, genWorkbook);
    for (const d of datasets) {
      expect(plan.folderMembership[d.id]).toBeDefined();
      expect(plan.workbookMembership[d.id]).toBeDefined();
    }
  });
});

// These exercise structures the corpus samples don't contain — the real proof
// the planner is general, not tuned to Moke/RockingCurve's shapes.
describe("planOriginImport generality (not tuned to samples)", () => {
  const byId = (plan: ReturnType<typeof planOriginImport>) => new Map(plan.folders.map((f) => [f.id, f]));

  it("a folder named like a nested path does NOT collide with that path", () => {
    const plan = planOriginImport(
      "P",
      [
        ds("P", "d1", "B1", ["Raw normalized"]), // ONE folder literally named "Raw normalized"
        ds("P", "d2", "B2", ["Raw", "normalized"]), // vs the two-level path Raw → normalized
      ],
      genFolder,
      genWorkbook,
    );
    const m = byId(plan);
    const d1f = m.get(plan.folderMembership.d1)!;
    const d2f = m.get(plan.folderMembership.d2)!;
    expect(d1f.name).toBe("Raw normalized");
    expect(m.get(d1f.parentId!)!.name).toBe("P"); // one folder, directly under project
    expect(d2f.name).toBe("normalized");
    expect(m.get(d2f.parentId!)!.name).toBe("Raw"); // genuinely nested, distinct
    expect(plan.folderMembership.d1).not.toBe(plan.folderMembership.d2);
  });

  it("keeps duplicate folder names under different parents distinct", () => {
    const plan = planOriginImport(
      "P",
      [ds("P", "d1", "B1", ["A", "Data"]), ds("P", "d2", "B2", ["B", "Data"])],
      genFolder,
      genWorkbook,
    );
    const data = plan.folders.filter((f) => f.name === "Data");
    expect(data).toHaveLength(2); // two separate "Data" folders
    const m = byId(plan);
    expect(data.map((f) => m.get(f.parentId!)!.name).sort()).toEqual(["A", "B"]);
    expect(plan.folderMembership.d1).not.toBe(plan.folderMembership.d2);
  });

  it("handles arbitrary nesting depth and root-level books together", () => {
    const plan = planOriginImport(
      "P",
      [ds("P", "root", "R"), ds("P", "deep", "D", ["a", "b", "c", "d"])],
      genFolder,
      genWorkbook,
    );
    const byName = new Map(plan.folders.map((f) => [f.name, f]));
    expect(["a", "b", "c", "d"].every((n) => byName.has(n))).toBe(true);
    expect(byName.get("b")!.parentId).toBe(byName.get("a")!.id); // chain a→b→c→d
    expect(byName.get("d")!.parentId).toBe(byName.get("c")!.id);
    expect(plan.folderMembership.root).toBe(plan.folders[0].id); // book with no path → project root
    expect(plan.folderMembership.deep).toBe(byName.get("d")!.id);
    // Books at root and deeply nested both still get their own workbook.
    expect(plan.workbooks.find((w) => w.originBook === "R")!.folderId).toBe(plan.folders[0].id);
    expect(plan.workbooks.find((w) => w.originBook === "D")!.folderId).toBe(byName.get("d")!.id);
  });

  it("preserves unicode / punctuation folder names verbatim", () => {
    const plan = planOriginImport(
      "P",
      [ds("P", "d1", "B", ["Messungen · 2024 (µ₀H)"])],
      genFolder,
      genWorkbook,
    );
    expect(plan.folders.map((f) => f.name)).toContain("Messungen · 2024 (µ₀H)");
  });

  it("two projects each containing 'Book1' (different stems) never merge into one workbook", () => {
    const planA = planOriginImport("ProjA", [ds("ProjA", "a", "Book1")], genFolder, genWorkbook);
    const planB = planOriginImport("ProjB", [ds("ProjB", "b", "Book1")], genFolder, genWorkbook);
    expect(planA.workbooks[0].id).not.toBe(planB.workbooks[0].id);
  });
});
