// Lane LZ: if the lazy re-check chunk cannot load, an install that dropped
// exclusions still marks what reads the book (touchDataset), never nothing.
import { beforeEach, expect, it, vi } from "vitest";

import { fetchBookData } from "../lib/api";
import { resetBookTransportForTests } from "../lib/bookData";
import type { BookSource, DataStruct } from "../lib/types";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), fetchBookData: vi.fn() }));
vi.mock("./lazyInstallFreshness", () => { throw new Error("chunk failed to load"); });

const SOURCE: BookSource = { kind: "path", path: "/book.opj", bookId: "b1", rows: 4, cols: 1, previewSampled: true };
const mk = (values: number[]): DataStruct => ({
  time: values.map((_, i) => i), values: values.map((v) => [v]), labels: ["y"], units: [""], metadata: {},
});
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetBookTransportForTests();
  vi.mocked(fetchBookData).mockResolvedValue(mk([1, 2, 3, 4]));
});

it("falls back to touchDataset when the re-check chunk fails to load", async () => {
  const touchDataset = vi.fn();
  useApp.setState({
    datasets: [{ id: "bk", name: "Book", data: mk([1, 3]), pending: SOURCE, excludedRows: [1] }],
    analysisResults: [], recalcMode: "manual", staleDatasets: [], touchDataset,
  });
  await useApp.getState().resolveDataset("bk");
  await settle();
  expect(touchDataset).toHaveBeenCalledWith("bk");
});
