// Notes are user content: no operation that rebuilds a sheet may lose them SILENTLY (ROW_RANGE_CONTRACT 7.1,
// orchestrator review of R6). Corrections re-applied or reset, merge and append, re-import, and cut all either
// carry the notes onto the right cells or say how many were not carried.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections as applyCorrectionsApi } from "../lib/api";
import type { CorrectionsRequest } from "../lib/api";
import { noteAt, noteCount } from "../lib/cellNotes";
import { mergeDatasets } from "../lib/merge";
import { CELL_NOTES_KEY } from "../lib/rowSidecars";
import type { CorrectionParams, DataStruct, Dataset } from "../lib/types";
import { setCellNote } from "./cellNotes";
import { applyReimportMerge, computeReimportMerge } from "./reimport";
import { useApp } from "./useApp";

vi.mock("../lib/api", () => ({
  applyCorrections: vi.fn(),
  uploadFile: vi.fn(),
  fetchBookData: vi.fn(),
  importFile: vi.fn(),
  guessImportSettings: vi.fn(),
  parseImportText: vi.fn(),
  fitModel: vi.fn(),
}));
vi.mock("./toasts", () => ({ toast: vi.fn() }));

const base = (): DataStruct => ({
  time: [1, 2, 3, 4],
  values: [[10], [20], [30], [40]],
  labels: ["m"],
  units: ["emu"],
  metadata: {},
});
let trim = 0; // rows the fake backend drops from the top
function fakeCorrections(req: CorrectionsRequest): Promise<DataStruct> {
  const d = req.dataset;
  // Like the real backend, a trim slices the row sidecars (calc/corrections.py, slice_row_sidecars).
  const notes = d.metadata[CELL_NOTES_KEY] as Record<string, Record<string, string>> | undefined;
  const sliced = notes
    ? Object.fromEntries(Object.entries(notes).map(([c, rows]) => [c, Object.fromEntries(Object.entries(rows).filter(([r]) => Number(r) >= trim).map(([r, t]) => [String(Number(r) - trim), t]))]))
    : undefined;
  return Promise.resolve({
    ...d,
    time: d.time.slice(trim),
    values: d.values.slice(trim).map((row) => row.map((v) => v * 2)),
    metadata: sliced ? { ...d.metadata, [CELL_NOTES_KEY]: sliced } : d.metadata,
  });
}

const st = () => useApp.getState();
const ds = () => st().datasets[0];
const note = (row: number, col = 0) => noteAt(ds().data.metadata, row, col);
const P = { smooth: 3 } as CorrectionParams;

beforeEach(() => {
  vi.clearAllMocks();
  trim = 0;
  vi.mocked(applyCorrectionsApi).mockImplementation(fakeCorrections);
  const d: Dataset = { id: "d1", name: "sample", data: base() };
  useApp.setState({ datasets: [d], activeId: "d1", selectedIds: [], history: [], future: [], status: "", recalcMode: "off", staleDatasets: [], staleFits: [] });
});

describe("corrections", () => {
  // `raw` is the sheet as the user had it, notes included, and a corrected sheet takes no cell or note edits
  // (isRederived), so the notes in `raw` are always the user's current ones. The backend slices them with a trim.
  it("apply with a trim carries each note with its row; reset puts them back on the ORIGINAL rows", async () => {
    setCellNote("d1", 1, 0, "second");
    setCellNote("d1", 3, 0, "last");
    trim = 2;
    await st().applyCorrections("d1", P);
    expect(ds().data.time).toEqual([3, 4]);
    expect(note(1)).toBe("last");
    expect(noteCount(ds().data.metadata)).toBe(1); // "second" sat on a trimmed row: gone with the row
    st().resetCorrections("d1");
    expect(ds().data.time).toEqual([1, 2, 3, 4]);
    expect(note(1)).toBe("second");
    expect(note(3)).toBe("last"); // nothing was lost by the round trip
    expect(noteCount(ds().data.metadata)).toBe(2);
  });

  it("re-applying with other parameters rebuilds from raw and keeps every note on its row", async () => {
    setCellNote("d1", 0, 0, "first");
    setCellNote("d1", 3, 0, "last");
    await st().applyCorrections("d1", P);
    trim = 1;
    await st().applyCorrections("d1", { smooth: 5 } as CorrectionParams);
    expect(note(2)).toBe("last");
    expect(note(0)).toBeUndefined(); // the trimmed row's note went with it
    trim = 0;
    await st().applyCorrections("d1", { smooth: 7 } as CorrectionParams);
    expect(note(0)).toBe("first"); // rebuilt from raw: the trimmed row and its note are back
  });

  it("a corrected sheet takes no note edit, and says why (so no note can fall out of step with raw)", async () => {
    await st().applyCorrections("d1", P);
    expect(setCellNote("d1", 0, 0, "x")).toBe(false);
    expect(st().status).toMatch(/recomputed from its source/);
  });
});

describe("merge and append", () => {
  it("notes land on the right cells of the merged rows, each part offset by the rows before it", () => {
    const a = { ...base(), metadata: { [CELL_NOTES_KEY]: { 0: { 1: "from a" } } } };
    const b = { ...base(), metadata: { [CELL_NOTES_KEY]: { 0: { 0: "from b", 3: "b last" } } } };
    const merged = mergeDatasets([a, b], ["a", "b"]);
    expect(merged.time).toHaveLength(8);
    expect(noteAt(merged.metadata, 1, 0)).toBe("from a");
    expect(noteAt(merged.metadata, 4, 0)).toBe("from b");
    expect(noteAt(merged.metadata, 7, 0)).toBe("b last");
    expect(noteCount(merged.metadata)).toBe(3);
    expect(CELL_NOTES_KEY in mergeDatasets([base(), base()], ["a", "b"]).metadata).toBe(false);
  });
});

describe("re-import", () => {
  const reimport = async (fresh: DataStruct) => {
    const merge = await computeReimportMerge(st, ds(), fresh);
    applyReimportMerge(useApp.setState, st, ds(), merge);
    return merge;
  };

  it("an unchanged shape keeps the notes; a stale copy in the fresh file does not replace them", async () => {
    setCellNote("d1", 2, 0, "mine");
    const merge = await reimport({ ...base(), values: [[11], [21], [31], [41]], metadata: { [CELL_NOTES_KEY]: { 0: { 0: "stale" } } } });
    expect(merge.notesDropped).toBe(0);
    expect(note(2)).toBe("mine");
    expect(note(0)).toBeUndefined();
  });

  it("a changed shape drops them and counts them (status and toast), never silently", async () => {
    setCellNote("d1", 0, 0, "a");
    setCellNote("d1", 1, 0, "b");
    const merge = await reimport({ ...base(), time: [1, 2], values: [[1], [2]] });
    expect(merge.notesDropped).toBe(2);
    expect(noteCount(ds().data.metadata)).toBe(0);
    st().undo();
    expect(note(0)).toBe("a");
  });
});
