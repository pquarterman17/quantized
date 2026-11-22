// Statistical tests "Out of date" (lane WB6). A test is a deliberate question:
// Run stays the only trigger, and a change to its picks / parameters / test /
// dataset still DROPS the output (unchanged). New: an output whose source rows
// or data changed after it ran is marked out of date and Copy / Export CSV /
// → Report are withheld; an answer for rows changed in flight lands marked;
// a lazy book resolves before the run so its arrival does not mark the output.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { makePending, restoreResolve } from "../workbench/pendingBook.testkit";
import { useStatsTests } from "./useStatsTests";

const { runMock, saveBlobMock, emitMock, copyMock } = vi.hoisted(() => ({
  runMock: vi.fn(), saveBlobMock: vi.fn(), emitMock: vi.fn(), copyMock: vi.fn(),
}));
vi.mock("../../../lib/api/statsTests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/statsTests")>()),
  runStatsTest: runMock,
}));
vi.mock("../../../lib/download", () => ({ saveBlob: saveBlobMock }));
vi.mock("../../../lib/clipboard", () => ({ copyText: copyMock }));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  reportEmit: emitMock,
}));

const DS: Dataset = {
  id: "d1", name: "films",
  data: {
    time: [1, 2, 3, 4, 5], values: [[10, 20], [11, 21], [12, 22], [13, 23], [14, 24]],
    labels: ["Hc", "Ms"], units: ["", ""], metadata: { x_column_name: "T" },
  },
};
const ANDERSON = { id: "anderson", data: { A2: 0.3, N: 5, critical_values: [0.5, 0.6, 0.7, 0.8, 0.9], significance_levels_pct: [15, 10, 5, 2.5, 1], reject_at_5pct: false } };

beforeEach(() => {
  vi.clearAllMocks();
  restoreResolve();
  runMock.mockResolvedValue(ANDERSON);
  emitMock.mockResolvedValue({ report: { id: "r" } });
  copyMock.mockResolvedValue(true);
  useApp.setState({
    datasets: [DS], activeId: "d1", status: "", reports: [], openReportId: null,
    analysisResults: [], openAnalysisResultId: null, history: [], future: [],
  });
});

async function ran() {
  const hook = renderHook(() => useStatsTests());
  await act(async () => { await hook.result.current.run(); });
  return hook;
}

describe("Statistical tests out-of-date state", () => {
  it("characterization: a fresh output is current; copy / export / report work", async () => {
    const { result } = await ran();
    expect(result.current.output).not.toBeNull();
    expect(result.current.stale).toBe(false);
    await act(async () => { await result.current.copy(); });
    act(() => result.current.exportCsv());
    await act(async () => { await result.current.toReport(); });
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(saveBlobMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledTimes(1);
  });

  it("characterization: a changed parameter or test drops the output (not marked)", async () => {
    const { result } = await ran();
    act(() => result.current.setParams({ alpha: 0.01 }));
    expect(result.current.output).toBeNull();
    expect(result.current.stale).toBe(false);
  });

  it("changed source rows mark the output out of date and withhold copy / export / report", async () => {
    const { result } = await ran();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [0] })) })));
    expect(result.current.output).not.toBeNull(); // shown, marked
    expect(result.current.stale).toBe(true);
    await act(async () => { await result.current.copy(); });
    act(() => result.current.exportCsv());
    await act(async () => { await result.current.toReport(); });
    expect(copyMock).not.toHaveBeenCalled(); // fail-before: each handed the old numbers on
    expect(saveBlobMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("running again after a data change clears the mark", async () => {
    const { result } = await ran();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [0] })) })));
    await act(async () => { await result.current.run(); });
    expect(result.current.stale).toBe(false);
    expect(result.current.output).not.toBeNull();
  });

  it("forced race: rows changed while the request is in flight leave the landed output out of date", async () => {
    let land!: (r: unknown) => void;
    runMock.mockImplementationOnce(() => new Promise((r) => { land = r; }));
    const { result } = renderHook(() => useStatsTests());
    let pending!: Promise<void>;
    act(() => { pending = result.current.run(); });
    await act(async () => {});
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [0] })) })));
    await act(async () => { land(ANDERSON); await pending; });
    expect(result.current.output).not.toBeNull();
    expect(result.current.stale).toBe(true); // fail-before: current
  });

  it("a lazy book is resolved before the run, so the fresh output is current", async () => {
    makePending(DS);
    const { result } = await ran();
    expect(result.current.output).not.toBeNull();
    expect(result.current.stale).toBe(false);
  });
});
