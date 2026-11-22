// Lane LZ: an Origin lazy-book INSTALL is told apart from a user EDIT (roadmap WB7
// "known limit kept" and lane IR suspected item 5). Each behaviour here failed
// before the install epoch existed (the install and an edit both just moved the
// data identity, and nothing re-checked a result after the book arrived).
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { datasetInputsToken } from "../components/workshops/workbench/inputsKey";
import { useRunStamp } from "../components/workshops/workbench/useRunStamp";
import { fetchBookData } from "../lib/api";
import { analysisDataFingerprint, snapshotResultState, stampAnalysisResults } from "../lib/analysisResultFreshness";
import { resetBookTransportForTests } from "../lib/bookData";
import { PREVIEW_SOURCE_ROWS } from "../lib/rowSidecars";
import type { AnalysisResult } from "../lib/analysisResult";
import type { BookSource, Dataset, DataStruct } from "../lib/types";
import { commitAnalysisOutput } from "./analysisOutputCommit";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  fetchBookData: vi.fn(),
}));

const SOURCE: BookSource = { kind: "path", path: "/book.opj", bookId: "b1", rows: 4, cols: 1, previewSampled: true };
const mk = (values: number[]): DataStruct => ({
  time: values.map((_, i) => i), values: values.map((v) => [v]), labels: ["y"], units: [""], metadata: {},
});
const FULL = mk([1, 2, 3, 4]);
const PREVIEW = mk([1, 3]);
const bk = (): Dataset => useApp.getState().datasets.find((d) => d.id === "bk")!;
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const stale = () => useApp.getState().staleDatasets;

/** A committed output of `bk` computed on the FULL data, then the book is back to
 *  a lazy preview (how an autosaved project reloads): the load could not judge it. */
function committedThenLazy(over: Partial<Dataset> = {}): string {
  useApp.setState({ datasets: [{ id: "bk", name: "Book", data: FULL, ...over }] });
  const out = commitAnalysisOutput({
    producer: { id: "surface-fit", label: "Surface fit", version: 1 }, sourceId: "bk",
    computedOn: analysisDataFingerprint(bk()), settings: { model: "Plane" },
    output: () => ({ name: "Book (fit)", data: mk([9, 9, 9, 9]) }),
  });
  if (out.kind !== "created") throw new Error("setup");
  // The save stamps each envelope with its sources' fingerprint; the reload then
  // finds the book pending, so the load-side scan could not judge it.
  useApp.setState((s) => ({
    analysisResults: stampAnalysisResults(s.analysisResults, s.datasets, []),
    datasets: s.datasets.map((d) => (d.id === "bk" ? { ...d, data: PREVIEW, pending: SOURCE } : d)),
    staleDatasets: [],
  }));
  return out.outputId;
}

// The re-check is a lazy chunk; load it once so every test sees it settle in a
// macrotask rather than racing the first dynamic import.
beforeAll(async () => { await import("./lazyInstallFreshness"); });

beforeEach(() => {
  vi.clearAllMocks();
  resetBookTransportForTests();
  vi.mocked(fetchBookData).mockResolvedValue(FULL);
  useApp.setState({
    datasets: [{ id: "bk", name: "Book", data: PREVIEW, pending: SOURCE }], activeId: "bk", analysisResults: [],
    history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual", status: "",
  });
});

describe("the install epoch", () => {
  it("is bumped by an install and by nothing else", async () => {
    expect(bk().installEpoch).toBeUndefined();
    await useApp.getState().resolveDataset("bk");
    expect(bk().installEpoch).toBe(1);
    useApp.getState().toggleRowExcluded("bk", 1);
    expect(bk().installEpoch).toBe(1);
  });
});

describe("the inputs token across an install", () => {
  it("is the same before and after an install that changed no rows", async () => {
    const before = datasetInputsToken(bk());
    await useApp.getState().resolveDataset("bk");
    expect(datasetInputsToken(bk())).toBe(before);
  });

  it("moves when a user edit follows the install", async () => {
    await useApp.getState().resolveDataset("bk");
    const installed = datasetInputsToken(bk());
    useApp.getState().toggleRowExcluded("bk", 1);
    expect(datasetInputsToken(bk())).not.toBe(installed);
    useApp.getState().toggleRowExcluded("bk", 1);
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, data: { ...d.data } })) }));
    expect(datasetInputsToken(bk())).not.toBe(installed);
  });

  it("moves when the install drops exclusions (the analysed rows changed)", async () => {
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [1] })) }));
    const before = datasetInputsToken(bk());
    await useApp.getState().resolveDataset("bk");
    expect(datasetInputsToken(bk())).not.toBe(before);
  });

  it("is not shared between two different books", async () => {
    const a = datasetInputsToken(bk());
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, pending: { ...SOURCE, bookId: "b2" } })) }));
    expect(datasetInputsToken(bk())).not.toBe(a);
  });
});

describe("a run stamp across an install", () => {
  const liveKey = () => datasetInputsToken(useApp.getState().datasets.find((d) => d.id === "bk"));
  it("a run launched before the install lands current; an edit during/after it is still caught", async () => {
    const { result, rerender } = renderHook(({ k }) => useRunStamp(k), { initialProps: { k: liveKey() } });
    const launched = result.current.launchKey(); // key taken on the preview, before the book arrives
    await useApp.getState().resolveDataset("bk");
    rerender({ k: liveKey() });
    act(() => result.current.record(launched));
    expect(result.current.stale).toBe(false);

    useApp.getState().toggleRowExcluded("bk", 2); // the user edits the installed rows
    rerender({ k: liveKey() });
    expect(result.current.stale).toBe(true);
  });

  it("forced race: an edit that lands while the install is in flight leaves the run stale", async () => {
    let release!: (d: DataStruct) => void;
    vi.mocked(fetchBookData).mockReturnValueOnce(new Promise<DataStruct>((resolve) => { release = resolve; }));
    const { result, rerender } = renderHook(({ k }) => useRunStamp(k), { initialProps: { k: liveKey() } });
    const launched = result.current.launchKey();
    const installing = useApp.getState().resolveDataset("bk");
    release(FULL);
    await installing;
    useApp.getState().toggleRowExcluded("bk", 0); // right after the install lands
    rerender({ k: liveKey() });
    act(() => result.current.record(launched));
    expect(result.current.stale).toBe(true);
  });
});

describe("results re-checked when a book installs", () => {
  it("marks a committed output stale when the full data no longer matches what it was computed on", async () => {
    const outputId = committedThenLazy();
    vi.mocked(fetchBookData).mockResolvedValue(mk([5, 6, 7, 8]));
    await useApp.getState().resolveDataset("bk");
    await settle();
    expect(stale()).toContain(outputId);
  });

  it("leaves a committed output current when the full data is what it was computed on", async () => {
    committedThenLazy();
    await useApp.getState().resolveDataset("bk");
    await settle();
    expect(stale()).toEqual([]);
  });

  it("tracks nothing in None mode", async () => {
    committedThenLazy();
    useApp.setState({ recalcMode: "off" });
    vi.mocked(fetchBookData).mockResolvedValue(mk([5, 6, 7, 8]));
    await useApp.getState().resolveDataset("bk");
    await settle();
    expect(stale()).toEqual([]);
  });

  it("marks in Auto mode (the pass leaves a committed output stale)", async () => {
    const outputId = committedThenLazy();
    const recalcNow = vi.fn(async () => undefined);
    useApp.setState({ recalcMode: "auto", recalcNow });
    vi.mocked(fetchBookData).mockResolvedValue(mk([5, 6, 7, 8]));
    await useApp.getState().resolveDataset("bk");
    await settle();
    expect(stale()).toContain(outputId);
    useApp.setState({ recalcNow: useApp.getInitialState().recalcNow });
  });

  it("leaves a snapshot result to its fingerprint (nothing is marked)", async () => {
    const snap: AnalysisResult = {
      version: 1, id: "r1", name: "Dist", producer: { id: "distribution-analysis", label: "Distribution", version: 1 },
      sources: [{ datasetId: "bk", role: "input" }], outputs: [], createdAt: "", sourceFingerprint: "old",
    } as unknown as AnalysisResult;
    useApp.setState({ analysisResults: [snap] });
    vi.mocked(fetchBookData).mockResolvedValue(mk([5, 6, 7, 8]));
    await useApp.getState().resolveDataset("bk");
    await settle();
    expect(stale()).toEqual([]);
    expect(snapshotResultState(snap, useApp.getState().datasets)).toBe("out-of-date");
  });
});

describe("exclusions dropped by an install", () => {
  it("marks the committed output of that book stale (Manual)", async () => {
    const outputId = committedThenLazy({ data: FULL });
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [1] })) }));
    await useApp.getState().resolveDataset("bk");
    await settle();
    expect(bk().excludedRows).toBeUndefined();
    expect(stale()).toContain(outputId);
  });

  it("marks nothing in None mode, and nothing when no exclusions were dropped", async () => {
    const outputId = committedThenLazy();
    useApp.setState((s) => ({ recalcMode: "off", datasets: s.datasets.map((d) => ({ ...d, excludedRows: [1] })) }));
    await useApp.getState().resolveDataset("bk");
    await settle();
    expect(stale()).not.toContain(outputId);
  });

  it("does not mark when the exclusions were proven and translated", async () => {
    const outputId = committedThenLazy();
    const withMap = { ...PREVIEW, metadata: { [PREVIEW_SOURCE_ROWS]: [0, 2] } } as DataStruct;
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, data: withMap, excludedRows: [1] })) }));
    await useApp.getState().resolveDataset("bk");
    await settle();
    expect(stale()).not.toContain(outputId);
  });
});
