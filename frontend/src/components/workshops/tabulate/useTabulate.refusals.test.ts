// Tabulate fail-closed acceptance (OPEN_ITEMS row 14): a queued export / report
// whose full data has no finite rows says so; a lazy preview is labelled.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBookData, reportEmit } from "../../../lib/api";
import { resetBookTransportForTests } from "../../../lib/bookData";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useTabulate } from "./useTabulate";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  reportEmit: vi.fn(),
  fetchBookData: vi.fn(),
}));

const FINITE: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[0, 10], [0, 12], [1, 30], [1, 32]],
  labels: ["grp", "val"],
  units: ["", ""],
  metadata: { x_column_name: "T" },
};
const ALL_NAN: DataStruct = { ...FINITE, values: FINITE.values.map(() => [Number.NaN, Number.NaN]) };
const pendingDs = (data: DataStruct) => ({
  id: "d1", name: "run.dat", data,
  pending: { kind: "upload" as const, bookId: "b1", rows: 4, cols: 2, previewSampled: true },
});

beforeEach(() => {
  resetBookTransportForTests();
  vi.clearAllMocks();
  vi.mocked(fetchBookData).mockReset();
  useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: FINITE }], activeId: "d1", status: "", reports: [] });
});

describe("Tabulate refusals", () => {
  it("lazy preview: the table is labelled as a sampled preview, a loaded one is not", () => {
    useApp.setState({ datasets: [pendingDs(FINITE)] });
    vi.mocked(fetchBookData).mockReturnValue(new Promise(() => {}));
    const lazy = renderHook(() => useTabulate());
    expect(lazy.result.current.previewNote).toMatch(/sampled subset/);
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: FINITE }] });
    const full = renderHook(() => useTabulate());
    expect(full.result.current.previewNote).toBeNull();
  });

  it("non-finite: a queued export whose full data has no finite rows says so and adds nothing", async () => {
    useApp.setState({ datasets: [pendingDs(FINITE)] });
    vi.mocked(fetchBookData).mockResolvedValueOnce(ALL_NAN);
    const { result } = renderHook(() => useTabulate());
    act(() => result.current.exportDataset());
    await waitFor(() => expect(useApp.getState().status).toMatch(/No finite rows to summarize/));
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("non-finite: a queued report whose full data has no finite rows says so and sends nothing", async () => {
    useApp.setState({ datasets: [pendingDs(FINITE)] });
    vi.mocked(fetchBookData).mockResolvedValueOnce(ALL_NAN);
    const { result } = renderHook(() => useTabulate());
    await act(async () => { await result.current.toReport(); });
    await waitFor(() => expect(useApp.getState().status).toMatch(/No finite rows to summarize/));
    expect(reportEmit).not.toHaveBeenCalled();
    expect(result.current.reportBusy).toBe(false);
  });

  it("missing input: with no dataset the table has nothing and Export / Report do nothing silently wrong", async () => {
    useApp.setState({ datasets: [], activeId: null });
    const { result } = renderHook(() => useTabulate());
    expect(result.current.hasData).toBe(false);
    await act(async () => { await result.current.toReport(); });
    expect(reportEmit).not.toHaveBeenCalled();
  });
});
