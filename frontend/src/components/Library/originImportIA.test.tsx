// UX-R3 (plans/ORIGIN_REPLACEMENT_ONE_WEEK_SPRINT.md, "Owner-observed field
// issues"): "imported projects reveal hierarchy progressively; plain,
// visually distinct object types ... with useful summaries; the common path
// must not require understanding Origin internals." This file exercises the
// acceptance points end to end against the actual Tree/Details renderers —
// the store-level collapse contract itself is pinned in
// store/importWorkbooks.test.ts (the import action that PRODUCES this
// state); this file pins what the Library UI does with it.
//
// F2 (review fix round): the fixture used to hand-clear `activeId`/
// `selectedIds` after building its own folders/workbooks/datasets by hand —
// that masked F1 (a real import always leaves a dataset active/selected via
// `addDataset`, and this fixture was quietly erasing that). It now runs the
// REAL import path (mocked `uploadFile`, exactly like
// store/importWorkbooks.test.ts) so activation, folder/workbook membership,
// and the F1 disclosure patch are all whatever production code actually
// produces — nothing here is asserted into existence.

import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryDetails from "./LibraryDetails";
import LibraryTree from "./LibraryTree";
import { useLibraryHierarchyRows, useLibraryHierarchyModel } from "./useLibraryHierarchyRows";
import { uploadFile } from "../../lib/api";
import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";

vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  uploadFile: vi.fn(),
  importFile: vi.fn(),
}));

const noop = () => {};

function TreeHarness() {
  const rows = useLibraryHierarchyRows();
  return <LibraryTree rows={rows} onFilterTag={noop} />;
}

function DetailsHarness({ query }: { query: string }) {
  const { hierarchy } = useLibraryHierarchyModel();
  return <LibraryDetails hierarchy={hierarchy} searchQuery={query} />;
}

const folderRow = (id: string) => document.querySelector(`[data-lib-row="folder:${id}"]`) as HTMLElement;
const workbookRow = (id: string) => document.querySelector(`[data-lib-row="workbook:${id}"]`) as HTMLElement;
const worksheetRow = (id: string) => document.querySelector(`[data-ds-id="${id}"]`) as HTMLElement;
const caretOf = (row: HTMLElement) => row.querySelector(".qzk-group-caret") as HTMLElement;

const raw: DataStruct = { time: [0, 1], values: [[1, 2]], labels: ["M"], units: [""], metadata: {} };

/** An Origin book entry, mirroring the real payload shape (routes/parsers.py
 *  `_build_book`), same helper as store/importWorkbooks.test.ts. */
const book = (short: string, path?: string[]): DataStruct => ({
  ...raw,
  metadata: { origin_book: short, ...(path ? { origin_folder_path: path } : {}) },
});

const fakeFile = (name: string) => new File(["x"], name);

interface SeededIds {
  proj: string;
  sub: string;
  wb1: string;
  wb2: string;
  d1: string;
  d2: string;
}

/** Run the REAL multi-book Origin import (a two-workbook project, one nested
 *  Project-Explorer subfolder — small enough to assert on directly, but
 *  structurally identical to what a real .opju import produces) and hand
 *  back the ids production code actually assigned. Nothing about
 *  activation, membership, or the F1 disclosure patch is asserted into the
 *  fixture — it all comes from `addFromPayload` (store/importDatasets.ts)
 *  running for real. */
async function seedMultiBookImport(): Promise<SeededIds> {
  vi.mocked(uploadFile).mockResolvedValue({
    ...raw,
    books: [book("Book1", ["Field sweeps"]), book("Book2", ["Field sweeps"])],
  });
  await useApp.getState().importFiles([fakeFile("Moke.opj")]);
  const st = useApp.getState();

  const proj = st.folders.find((f) => f.parentId === null)!.id;
  const sub = st.folders.find((f) => f.parentId === proj)!.id;
  const wb1 = st.workbooks.find((w) => w.originBook === "Book1")!.id;
  const wb2 = st.workbooks.find((w) => w.originBook === "Book2")!.id;
  const d1 = st.datasets.find((d) => d.workbookId === wb1)!.id;
  const d2 = st.datasets.find((d) => d.workbookId === wb2)!.id;
  return { proj, sub, wb1, wb2, d1, d2 };
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    folders: [],
    workbooks: [],
    datasets: [],
    originFigures: [],
    editableFigures: [],
    figureDocs: [],
    pages: [],
    reports: [],
    expandedFolders: [],
    expandedWorkbookIds: [],
    librarySelection: null,
    workbookLastChild: {},
    activeId: null,
    selectedIds: [],
    history: [],
    future: [],
  });
});

describe("UX-R3 + F1 — a multi-book Origin import reveals hierarchy progressively, but the active row is never hidden", () => {
  it("addFromPayload leaves the LAST book's dataset active and selected (the behavior F1 must not hide)", async () => {
    const { d2 } = await seedMultiBookImport();
    const st = useApp.getState();
    expect(st.activeId).toBe(d2);
    expect(st.selectedIds).toEqual([d2]);
  });

  it("F1: the active dataset's own ancestor chain is expanded by default — its workbook and folder path — while every sibling folder/workbook it did NOT land on stays collapsed", async () => {
    const { proj, sub, wb1, wb2, d2 } = await seedMultiBookImport();
    render(<TreeHarness />);

    // The active dataset's ancestor chain: project folder -> subfolder -> its
    // own workbook, all disclosed without any click.
    expect(caretOf(folderRow(proj)).textContent).toBe("▾");
    expect(folderRow(sub)).toBeInTheDocument();
    expect(caretOf(folderRow(sub)).textContent).toBe("▾");
    expect(workbookRow(wb2)).toBeInTheDocument();
    expect(caretOf(workbookRow(wb2)).textContent).toBe("▾");
    expect(worksheetRow(d2)).toBeInTheDocument();

    // The sibling workbook under the SAME already-expanded folder is visible
    // as a row (the folder disclosure is shared) but its OWN group stays
    // collapsed — this import did not land on it.
    expect(workbookRow(wb1)).toBeInTheDocument();
    expect(caretOf(workbookRow(wb1)).textContent).toBe("▸");
  });

  it("the collapsed sibling workbook's worksheet stays hidden until its own caret is clicked, independent of the active branch", async () => {
    const { wb1, d1, d2 } = await seedMultiBookImport();
    render(<TreeHarness />);

    expect(worksheetRow(d1)).not.toBeInTheDocument();
    expect(worksheetRow(d2)).toBeInTheDocument(); // the active branch, already open

    fireEvent.click(caretOf(workbookRow(wb1)));
    expect(worksheetRow(d1)).toBeInTheDocument();
    expect(worksheetRow(d2)).toBeInTheDocument(); // unaffected by the sibling's own toggle
  });

  it("the project folder's count chip reflects the full subtree", async () => {
    const { proj } = await seedMultiBookImport();
    render(<TreeHarness />);
    expect(folderRow(proj).querySelector(".qzk-group-count")?.textContent).toBe("2");
  });

  it("folder and workbook rows carry distinct icons/type labels", async () => {
    const { proj, wb1 } = await seedMultiBookImport();
    render(<TreeHarness />);
    expect(folderRow(proj).querySelector('[title="Folder"]')).toBeInTheDocument();
    expect(workbookRow(wb1).querySelector('[title="Workbook"]')).toBeInTheDocument();
  });

  it("search still finds a worksheet tucked inside the still-collapsed sibling workbook group", async () => {
    const { d1 } = await seedMultiBookImport();
    // Nothing clicked — wb1 (Book1's workbook) stays collapsed per F1.
    render(<DetailsHarness query="Book1" />);
    const name = useApp.getState().datasets.find((d) => d.id === d1)!.name;
    expect(screen.getByText(name)).toBeInTheDocument();
  });
});
