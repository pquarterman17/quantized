// resolveDatasets: ONE StatusBar entry with a "k/N" count while several lazy
// book previews load, instead of a "fetching full data" toast per book
// (RESULT_ACCEPTANCE_AUDIT part 4, row 9).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBookData } from "../lib/api";
import { resetBookTransportForTests } from "../lib/bookData";
import type { Dataset, DataStruct } from "../lib/types";
import { usePendingOps } from "./pendingOps";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<Record<string, unknown>>()), fetchBookData: vi.fn() }));

const full: DataStruct = { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["m"], units: ["emu"], metadata: {} };
const book = (id: string): Dataset => ({
  id,
  name: `${id}.opj`,
  data: { time: [0, 2], values: [[1], [3]], labels: ["m"], units: ["emu"], metadata: { lazy_preview: true } },
  pending: { kind: "path", path: `/${id}.opj`, bookId: "Book1", rows: 3, cols: 1 },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetBookTransportForTests();
  usePendingOps.setState({ ops: [] });
  useToasts.setState({ toasts: [] });
});
afterEach(() => vi.useRealTimers());

describe("resolveDatasets count", () => {
  it("counts k/N on one op, raises no per-book toast, and ends the op", async () => {
    useApp.setState({ datasets: [book("a"), book("b"), book("c"), { id: "x", name: "x", data: full }] });
    const gates: Record<string, (d: DataStruct) => void> = {};
    vi.mocked(fetchBookData).mockImplementation((s) => new Promise((r) => { gates[s.path as string] = r; }));

    const p = useApp.getState().resolveDatasets(["a", "b", "c", "x"]);
    expect(usePendingOps.getState().ops.map((o) => o.label)).toEqual(["Loading full data 0/3"]);
    await vi.advanceTimersByTimeAsync(0);
    gates["/a.opj"](full);
    await vi.advanceTimersByTimeAsync(0);
    expect(usePendingOps.getState().ops[0].label).toBe("Loading full data 1/3");
    await vi.advanceTimersByTimeAsync(1000); // past the old 400 ms toast gate
    expect(useToasts.getState().toasts).toHaveLength(0);
    gates["/b.opj"](full);
    gates["/c.opj"](full);
    expect((await p).map((d) => d.id)).toEqual(["a", "b", "c", "x"]);
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  it("a failing book still ends the op and rejects", async () => {
    useApp.setState({ datasets: [book("a"), book("b")] });
    vi.mocked(fetchBookData).mockRejectedValue(new Error("gone"));
    await expect(useApp.getState().resolveDatasets(["a", "b"])).rejects.toThrow("gone");
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  it("one pending book keeps the single-book path (no op, slow toast)", async () => {
    useApp.setState({ datasets: [book("a")] });
    let release!: (d: DataStruct) => void;
    vi.mocked(fetchBookData).mockImplementation(() => new Promise((r) => (release = r)));
    const p = useApp.getState().resolveDatasets(["a"]);
    expect(usePendingOps.getState().ops).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(450);
    expect(useToasts.getState().toasts.at(-1)?.msg).toContain('fetching full data for "a.opj"');
    release(full);
    await p;
  });
});
