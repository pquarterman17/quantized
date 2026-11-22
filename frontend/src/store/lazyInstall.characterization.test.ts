// Lane LZ characterization (written green BEFORE the install-epoch change): what a
// lazy-book install writes, and what a non-lazy dataset's run key is made of. The
// install-vs-edit behaviour added after this file is in lazyInstall.epoch.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { datasetInputsToken } from "../components/workshops/workbench/inputsKey";
import { fetchBookData } from "../lib/api";
import { resetBookTransportForTests } from "../lib/bookData";
import { PREVIEW_SOURCE_ROWS } from "../lib/rowSidecars";
import type { BookSource, Dataset, DataStruct } from "../lib/types";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  fetchBookData: vi.fn(),
}));

const SOURCE: BookSource = { kind: "path", path: "/book.opj", bookId: "b1", rows: 4, cols: 1, previewSampled: true };
const mk = (values: number[], metadata: DataStruct["metadata"] = {}): DataStruct => ({
  time: values.map((_, i) => i), values: values.map((v) => [v]), labels: ["y"], units: [""], metadata,
});
const FULL = mk([1, 2, 3, 4]);
const ds = (): Dataset => useApp.getState().datasets.find((d) => d.id === "bk")!;
const pendingBook = (over: Partial<Dataset> = {}): Dataset => ({
  id: "bk", name: "Book", data: mk([1, 3]), pending: SOURCE, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetBookTransportForTests();
  vi.mocked(fetchBookData).mockResolvedValue(FULL);
  useApp.setState({
    datasets: [pendingBook()], activeId: "bk", analysisResults: [], history: [], future: [],
    staleDatasets: [], staleFits: [], recalcMode: "manual", status: "",
  });
});

describe("what an install writes (unchanged by lane LZ)", () => {
  it("swaps the data, clears pending, keeps the filter and drops unproven exclusions", async () => {
    const filter = { column: 0, op: ">", value: 0 } as unknown as Dataset["filter"];
    useApp.setState({ datasets: [pendingBook({ excludedRows: [1], filter })] });
    const out = await useApp.getState().resolveDataset("bk");
    expect(out?.data).toBe(FULL);
    expect(ds().pending).toBeUndefined();
    expect(ds().filter).toBe(filter);
    expect(ds().excludedRows).toBeUndefined();
  });

  it("translates exclusions when the preview-to-source map is proven", async () => {
    useApp.setState({ datasets: [pendingBook({ data: mk([1, 3], { [PREVIEW_SOURCE_ROWS]: [0, 2] }), excludedRows: [1] })] });
    await useApp.getState().resolveDataset("bk");
    expect(ds().excludedRows).toEqual([2]);
  });
});

describe("a non-lazy dataset's inputs token", () => {
  const base = (): Dataset => ({ id: "n", name: "N", data: mk([1, 2, 3]) });
  it("moves with the data, exclusions, filter and roles, not with the name", () => {
    const d = base();
    const t = datasetInputsToken(d);
    expect(datasetInputsToken({ ...d, name: "renamed" })).toBe(t);
    expect(datasetInputsToken({ ...d, data: { ...d.data } })).not.toBe(t);
    expect(datasetInputsToken({ ...d, excludedRows: [1] })).not.toBe(t);
    expect(datasetInputsToken({ ...d, errorRoles: {} as never })).not.toBe(t);
    expect(datasetInputsToken(undefined)).toBe("");
  });
});
