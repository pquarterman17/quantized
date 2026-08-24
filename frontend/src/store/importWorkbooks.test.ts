// LIBRARY_WORKBOOK_UX_PLAN PR A3 — import-time workbook assignment. Tests the
// workbook wiring store/importDatasets.ts's addFromPayload does (single-file
// + Origin multi-book branches), NOT the surrounding importFiles/importPaths
// mechanics already covered by store/importDatasets.test.ts.
//
// Deliberately its OWN file rather than an addition to store/useApp.test.ts:
// this PR's file partition keeps useApp.ts/useApp.test.ts untouched (a
// parallel PR owns append/merge in that area), and this module only needs
// the import slice + the pure lib/workbooks.ts + lib/workspace.ts functions.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { importFile, uploadFile } from "../lib/api";
import type { DataStruct } from "../lib/types";
import { deriveWorkbooks } from "../lib/workbooks";
import { parseWorkspace, serializeWorkspace, WORKSPACE_FORMAT } from "../lib/workspace";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  importFile: vi.fn(),
  uploadFile: vi.fn(),
}));

const raw: DataStruct = {
  time: [1, 2, 3],
  values: [[10], [20], [30]],
  labels: ["m"],
  units: ["emu"],
  metadata: {},
};

const fakeFile = (name: string) => new File(["x"], name);

/** An Origin book entry, mirroring the real payload shape (routes/parsers.py
 *  `_build_book`): `origin_book` (+ optional Project Explorer path) rides
 *  every book's own metadata. */
const book = (short: string, path?: string[]): DataStruct => ({
  ...raw,
  metadata: { origin_book: short, ...(path ? { origin_folder_path: path } : {}) },
});

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [],
    folders: [],
    workbooks: [],
    activeId: null,
    selectedIds: [],
    expandedFolders: [],
    expandedWorkbookIds: [],
    originFigures: [],
    originFidelity: [],
    history: [],
    future: [],
  });
  vi.mocked(uploadFile).mockResolvedValue(raw);
  vi.mocked(importFile).mockResolvedValue(raw);
});

describe("single-file import creates one workbook (L0.2)", () => {
  it("a path import: workbook named after the stem, carrying source + importedAt, root placement", async () => {
    await useApp.getState().importPaths(["/data/scan.dat"]);
    const st = useApp.getState();

    expect(st.workbooks).toHaveLength(1);
    const wb = st.workbooks[0];
    expect(wb.name).toBe("scan");
    expect(wb.source).toEqual({ kind: "path", path: "/data/scan.dat" });
    expect(wb.importedAt).toBeDefined();
    expect(wb.folderId).toBeUndefined(); // no folder concept for plain imports today
    expect(st.datasets[0].workbookId).toBe(wb.id);
  });

  it("an upload (no source) still creates one workbook, but with no source field", async () => {
    await useApp.getState().importFiles([fakeFile("browser.csv")]);
    const st = useApp.getState();

    expect(st.workbooks).toHaveLength(1);
    const wb = st.workbooks[0];
    expect(wb.source).toBeUndefined();
    expect(st.datasets[0].workbookId).toBe(wb.id);
  });

  it("importing two plain files creates two DISTINCT workbooks", async () => {
    await useApp.getState().importPaths(["/data/a.csv", "/data/b.csv"]);
    const st = useApp.getState();

    expect(st.workbooks).toHaveLength(2);
    expect(new Set(st.datasets.map((d) => d.workbookId)).size).toBe(2);
  });

  it("a single-book Origin project (no `books` array — the backend omits it for len<=1) creates one Origin workbook", async () => {
    // routes/parsers.py's _import_with_books only attaches `books` when
    // len(books) > 1; a single-book project's top-level payload IS the one
    // book's DataStruct, already carrying its own origin_book metadata
    // (io/origin_project's _build_book stamps every book, primary included).
    vi.mocked(uploadFile).mockResolvedValue(book("Book1"));
    await useApp.getState().importFiles([fakeFile("Solo.opj")]);
    const st = useApp.getState();

    expect(st.datasets).toHaveLength(1);
    expect(st.workbooks).toHaveLength(1);
    expect(st.workbooks[0].originBook).toBe("Book1");
    expect(st.datasets[0].workbookId).toBe(st.workbooks[0].id);
  });
});

describe("a workbook created by a SINGLE-FILE import starts expanded (PR C tree disclosure)", () => {
  // The tree-mode analogue of the flat list's "a fresh import's row is
  // immediately visible": with expandedWorkbookIds starting [], a collapsed
  // fresh workbook would hide the just-imported sheet behind its disclosure
  // arrow (the E2E-suite regression this pins). Only workbooks the import
  // CREATES expand — pre-existing ones keep their user-set state. UX-R3
  // narrows this to ordinary (0/1-book) imports only — see the multi-book
  // describe block below for the project-scale exception.
  it("single-file import expands the derived workbook", async () => {
    await useApp.getState().importPaths(["/data/scan.dat"]);
    const st = useApp.getState();
    expect(st.workbooks).toHaveLength(1);
    expect(st.expandedWorkbookIds).toContain(st.workbooks[0].id);
  });
});

describe("UX-R3: a multi-book Origin project import lands COLLAPSED", () => {
  // ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md's UX-R3: "imported projects reveal
  // their hierarchy progressively"; acceptance calls for a realistic
  // multi-book .opju to default to COLLAPSED Folder -> Workbook groups. This
  // supersedes the pre-UX-R3 contract (auto-expand every created
  // folder/workbook), which is exactly the reported "too many similarly
  // weighted objects" complaint at project scale — see importDatasets.ts's
  // comment on this call site. A workbook/folder the import did NOT create
  // (a pre-existing one) keeps whatever expand state the user already left
  // it in, untouched either way.
  it("expands neither the folders nor the workbooks it created, and leaves pre-existing expand state alone", async () => {
    useApp.setState({
      workbooks: [{ id: "wb-old", name: "Existing" }],
      folders: [{ id: "f-old", name: "Existing folder", parentId: null, order: 0 }],
      expandedFolders: ["f-old"], // user had this pre-existing folder open
      expandedWorkbookIds: ["wb-old"], // and this pre-existing workbook open
    });
    vi.mocked(uploadFile).mockResolvedValue({
      ...raw,
      books: [book("Book1", ["Proj"]), book("Book2", ["Proj"])],
    });
    await useApp.getState().importFiles([fakeFile("Two.opj")]);
    const st = useApp.getState();
    const createdWorkbooks = st.workbooks.filter((w) => w.id !== "wb-old");
    const createdFolders = st.folders.filter((f) => f.id !== "f-old");
    expect(createdWorkbooks.length).toBeGreaterThan(0);
    expect(createdFolders.length).toBeGreaterThan(0);
    for (const w of createdWorkbooks) expect(st.expandedWorkbookIds).not.toContain(w.id);
    for (const f of createdFolders) expect(st.expandedFolders).not.toContain(f.id);
    // pre-existing expand state is untouched, not merely "not regressed to empty"
    expect(st.expandedWorkbookIds).toContain("wb-old");
    expect(st.expandedFolders).toContain("f-old");
  });
});

describe("undo removes the workbook an import created (no separate recordHistory call)", () => {
  it("one undo after a single-file import reverts BOTH the dataset and its workbook", async () => {
    await useApp.getState().importPaths(["/data/scan.dat"]);
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().workbooks).toHaveLength(1);

    useApp.getState().undo();

    expect(useApp.getState().datasets).toEqual([]);
    expect(useApp.getState().workbooks).toEqual([]);
  });
});

describe("Origin multi-book import: folders mirror Project Explorer, workbooks mirror books (PR A3)", () => {
  it("plans path folders with NO book-surrogate folder; one workbook per book; sheets carry both memberships", async () => {
    vi.mocked(uploadFile).mockResolvedValue({
      ...raw,
      books: [
        book("Book1", ["Raw normalized"]),
        book("Book4", ["Sub subtraction"]),
        book("Book4@2", ["Sub subtraction"]),
        book("Book4@3", ["Sub subtraction"]),
      ],
    });
    await useApp.getState().importFiles([fakeFile("Moke.opj")]);
    const st = useApp.getState();

    // Only the project + two Project Explorer folders — no "Book4" folder.
    expect(st.folders.map((f) => f.name).sort()).toEqual(["Moke", "Raw normalized", "Sub subtraction"].sort());
    const rawFolder = st.folders.find((f) => f.name === "Raw normalized")!;
    const subFolder = st.folders.find((f) => f.name === "Sub subtraction")!;

    expect(st.workbooks).toHaveLength(2); // Book1 (singleton), Book4 (3-sheet)
    const wbBook1 = st.workbooks.find((w) => w.originBook === "Book1")!;
    const wbBook4 = st.workbooks.find((w) => w.originBook === "Book4")!;
    expect(wbBook1.folderId).toBe(rawFolder.id);
    expect(wbBook4.folderId).toBe(subFolder.id);

    const at = (name: string) => st.datasets.find((d) => d.name === name)!;
    expect(at("Moke:Book1").folderId).toBe(rawFolder.id);
    expect(at("Moke:Book1").workbookId).toBe(wbBook1.id);
    // Sheets land in the PATH folder now, not a per-book folder.
    expect(at("Moke:Book4").folderId).toBe(subFolder.id);
    expect(at("Moke:Book4@2").folderId).toBe(subFolder.id);
    expect(at("Moke:Book4@3").folderId).toBe(subFolder.id);
    expect(at("Moke:Book4").workbookId).toBe(wbBook4.id);
    expect(at("Moke:Book4@2").workbookId).toBe(wbBook4.id);
    expect(at("Moke:Book4@3").workbookId).toBe(wbBook4.id);
  });

  it("includes a lazy (pending) book in the workbook plan, same as an eager one", async () => {
    const primaryMarker = {
      lazy: false as const,
      primary: true as const,
      id: "Book1",
      labels: ["m"],
      units: ["emu"],
      metadata: { origin_book: "Book1" },
      rows: 3,
      cols: 1,
    };
    const lazyEntry = {
      lazy: true as const,
      id: "Book2",
      labels: ["m"],
      units: ["emu"],
      metadata: { origin_book: "Book2" },
      rows: 5000,
      cols: 1,
      preview: { time: [1, 2], values: [[10], [20]] },
    };
    vi.mocked(uploadFile).mockResolvedValue({
      ...raw,
      books: [primaryMarker, lazyEntry],
      book_source: { kind: "path", path: "/data/PNR.opj" },
    });
    await useApp.getState().importFiles([fakeFile("PNR.opj")]);
    const st = useApp.getState();

    expect(st.workbooks).toHaveLength(2);
    const lazy = st.datasets.find((d) => d.name === "PNR:Book2")!;
    expect(lazy.pending).toBeDefined(); // still a lazy dataset
    expect(lazy.workbookId).toBeDefined();
    expect(st.workbooks.some((w) => w.id === lazy.workbookId)).toBe(true);
  });
});

describe("consistency gate: import-time creation and load-time derivation never disagree", () => {
  /** membership map -> sorted list of sorted dataset-id groups, so two
   *  partitions can be compared by EQUIVALENCE CLASS rather than by the
   *  (intentionally different) id namespaces genFolderId/genWorkbookId vs.
   *  a re-derivation's own genId would produce. */
  function classesOf(membership: Record<string, string>): string[][] {
    const byGroup = new Map<string, string[]>();
    for (const [dsId, groupId] of Object.entries(membership)) {
      const arr = byGroup.get(groupId) ?? [];
      arr.push(dsId);
      byGroup.set(groupId, arr);
    }
    return [...byGroup.values()].map((ids) => [...ids].sort()).sort((a, b) => a[0].localeCompare(b[0]));
  }

  it("Origin multi-book: stripping workbooks and re-deriving gives the SAME partition and folder placement", async () => {
    vi.mocked(uploadFile).mockResolvedValue({
      ...raw,
      books: [
        book("Book1", ["Raw normalized"]),
        book("Book4", ["Sub subtraction"]),
        book("Book4@2", ["Sub subtraction"]),
      ],
    });
    await useApp.getState().importFiles([fakeFile("Moke.opj")]);
    const st = useApp.getState();

    const importMembership = Object.fromEntries(st.datasets.map((d) => [d.id, d.workbookId!]));
    let n = 0;
    const stripped = st.datasets.map((d) => ({ ...d, workbookId: undefined }));
    const derived = deriveWorkbooks(stripped, st.folders, () => `re-${++n}`);

    expect(classesOf(derived.membership)).toEqual(classesOf(importMembership));

    // Same folder placement per equivalence class too.
    for (const group of classesOf(importMembership)) {
      const importWb = st.workbooks.find((w) => w.id === st.datasets.find((d) => d.id === group[0])!.workbookId)!;
      const derivedWb = derived.workbooks.find((w) => w.id === derived.membership[group[0]])!;
      expect(derivedWb.folderId).toBe(importWb.folderId);
    }
    expect(derived.warnings).toEqual([]); // a fresh, correct import never spreads a book across folders
  });

  it("single-file import: stripping the workbook and re-deriving gives back an equivalent singleton", async () => {
    await useApp.getState().importPaths(["/data/scan.dat"]);
    const st = useApp.getState();
    const stripped = st.datasets.map((d) => ({ ...d, workbookId: undefined }));
    const derived = deriveWorkbooks(stripped, st.folders, () => "re-1");

    expect(derived.workbooks).toHaveLength(1);
    expect(derived.workbooks[0].name).toBe(st.workbooks[0].name);
    expect(derived.workbooks[0].source).toEqual(st.workbooks[0].source);
  });
});

describe("round-trip: an import-created state survives serialize -> parse identically", () => {
  it("Origin multi-book project: workbooks/memberships/folders (ids included) round-trip", async () => {
    vi.mocked(uploadFile).mockResolvedValue({
      ...raw,
      books: [book("Book1", ["Raw"]), book("Book4", ["Sub"]), book("Book4@2", ["Sub"])],
    });
    await useApp.getState().importFiles([fakeFile("Moke.opj")]);
    const before = useApp.getState();

    const reopened = parseWorkspace(serializeWorkspace(before));

    expect(reopened.workbooks).toEqual(before.workbooks);
    expect(reopened.folders).toEqual(before.folders);
    expect(reopened.datasets.map((d) => ({ id: d.id, folderId: d.folderId, workbookId: d.workbookId }))).toEqual(
      before.datasets.map((d) => ({ id: d.id, folderId: d.folderId, workbookId: d.workbookId })),
    );
  });
});

describe("importFilesAppended's merged dataset self-heals on next save/reopen (PR A4 owns the merge path itself)", () => {
  // useApp.ts's importFilesAppended (off-limits to this PR — a parallel PR
  // owns append/merge reference integrity) strips incoming workbookId today
  // (PR A2's documented interim behaviour), so a freshly-appended dataset is
  // workbook-LESS, not dangling. Prove the self-heal at the parseWorkspace
  // boundary instead of touching useApp.ts: any workbook-less dataset in a
  // v4 document — appended or otherwise — gets its own singleton workbook on
  // the very next save + reopen, via the same reconcileWorkbookRefs orphan
  // path a legacy v1-v3 document already goes through.
  it("a workbook-less dataset in a v4 doc gains a singleton workbook when reparsed", () => {
    const doc = {
      format: WORKSPACE_FORMAT,
      version: 4,
      datasets: [{ id: "merged1", name: "merged.csv", data: raw }], // no workbookId at all
      workbooks: [],
    };
    const ws = parseWorkspace(JSON.stringify(doc));

    expect(ws.datasets[0].workbookId).toBeDefined();
    expect(ws.workbooks).toHaveLength(1);
    expect(ws.workbooks[0].id).toBe(ws.datasets[0].workbookId);
  });
});
