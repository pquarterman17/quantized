// A named range's rows are positions, so a row-count change that is NOT an explicit insert or delete (a trim, a
// re-derive, a re-import) leaves them meaning nothing (ROW_RANGE_CONTRACT 5.4). The range is flagged stale: kept,
// never widened to "every row", and refused by its readers until the user keeps or removes the limit.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CorrectionsRequest } from "../lib/api";
import { applyCorrections as applyCorrectionsApi } from "../lib/api";
import { namedRangeIssue } from "../lib/namedRanges";
import type { CorrectionParams, DataStruct, Dataset } from "../lib/types";
import { defineNamedRange, retargetNamedRange } from "./namedRanges";
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
  time: [1, 2, 3, 4, 5, 6],
  values: [[10, 1], [20, 2], [30, 3], [40, 4], [50, 5], [60, 6]],
  labels: ["m", "n"],
  units: ["emu", "emu"],
  metadata: {},
});
let trim = 0;
const fakeCorrections = (req: CorrectionsRequest): Promise<DataStruct> =>
  Promise.resolve({ ...req.dataset, time: req.dataset.time.slice(trim), values: req.dataset.values.slice(trim) });

const st = () => useApp.getState();
const ranges = () => st().namedRanges;
const P = { smooth: 3 } as CorrectionParams;

beforeEach(() => {
  vi.clearAllMocks();
  trim = 0;
  vi.mocked(applyCorrectionsApi).mockImplementation(fakeCorrections);
  const d: Dataset = { id: "d1", name: "sample", data: base() };
  useApp.setState({ datasets: [d, { id: "d2", name: "other", data: base() }], activeId: "d1", history: [], future: [], status: "", recalcMode: "off", staleDatasets: [], staleFits: [], namedRanges: [], workbooks: [] });
  defineNamedRange({ name: "Limited", scope: "sheet", datasetId: "d1", cols: [0], rows: { from: 1, to: 3 } });
  defineNamedRange({ name: "Whole", scope: "sheet", datasetId: "d1", cols: [1], rows: null });
  defineNamedRange({ name: "Elsewhere", scope: "sheet", datasetId: "d2", cols: [0], rows: { from: 1, to: 3 } });
});

/** The marking loads its module on demand (it is not startup code), so let that load land. */
const settle = () => new Promise((r) => setTimeout(r, 30));
const byName = (n: string) => ranges().find((r) => r.name === n)!;

describe("rows replaced outside an insert or delete", () => {
  it("a corrections trim flags the row-limited ranges of THAT sheet, keeps their rows, and the reader refuses with the way out", async () => {
    trim = 2;
    await st().applyCorrections("d1", P);
    await settle();
    expect(byName("Limited").rowsStale).toBe(true);
    expect(byName("Limited").target.rows).toEqual({ from: 1, to: 3 }); // kept, never widened
    expect(byName("Whole").rowsStale).toBeUndefined(); // no row limit: still meaningful
    expect(byName("Elsewhere").rowsStale).toBeUndefined();
    expect(namedRangeIssue(byName("Limited"), st().datasets)).toMatch(/Limited: its worksheet's rows were replaced; open Named Ranges to keep rows 2-4 or remove the row limit/);
    expect(namedRangeIssue(byName("Whole"), st().datasets)).toBeNull();
  });

  it("a correction that keeps every row leaves the ranges alone", async () => {
    await st().applyCorrections("d1", P);
    expect(ranges().some((r) => r.rowsStale)).toBe(false);
  });

  it("choosing the rows again (retarget) clears the flag", async () => {
    trim = 2;
    await st().applyCorrections("d1", P);
    expect(retargetNamedRange(byName("Limited").id, { datasetId: "d1", cols: [0], rows: { from: 0, to: 2 } }).ok).toBe(true);
    expect(byName("Limited").rowsStale).toBeUndefined();
  });

  const reimport = async (fresh: DataStruct) => {
    const ds = st().datasets[0];
    applyReimportMerge(useApp.setState, st, ds, await computeReimportMerge(st, ds, fresh));
    await settle();
  };

  it("a re-import that changes the row count flags the row-limited ranges only", async () => {
    await reimport({ ...base(), time: [1, 2, 3], values: [[1, 1], [2, 2], [3, 3]] });
    expect(byName("Limited").rowsStale).toBe(true);
    expect(byName("Whole").rowsStale).toBeUndefined();
    expect(byName("Elsewhere").rowsStale).toBeUndefined();
  });

  it("a re-import that changes the COLUMNS flags every range on the sheet (the indices name other columns)", async () => {
    await reimport({ ...base(), labels: ["m", "n", "p"], units: ["", "", ""], values: base().values.map((r) => [...r, 0]) });
    expect(byName("Limited").rowsStale).toBe(true);
    expect(byName("Whole").rowsStale).toBe(true);
    expect(byName("Elsewhere").rowsStale).toBeUndefined();
  });

  it("a re-import of the same shape leaves them alone", async () => {
    await reimport({ ...base(), values: base().values.map((r) => r.map((v) => v + 1)) });
    expect(ranges().some((r) => r.rowsStale)).toBe(false);
  });
});
