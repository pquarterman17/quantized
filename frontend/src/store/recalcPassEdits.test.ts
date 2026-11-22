// Lane RP: a USER edit made while a recalc pass runs must not be lost. The
// engine used to drop every touchDataset during a pass (the pass's own writes
// must not re-mark), so a derived worksheet the pass had already re-derived
// from the pre-edit source ended the pass "Current" over stale numbers.
// Every race is forced: the pass is held inside a gated applyCorrections.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, DataStruct } from "../lib/types";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  applyCorrections: vi.fn(async ({ dataset }: { dataset: DataStruct }) => structuredClone(dataset)),
}));
import { applyCorrections } from "../lib/api";
import { createSignalWorksheetFromApp } from "./signalWorksheetCommand";
import { useApp } from "./useApp";

const data = (values: number[]): DataStruct => ({
  time: values.map((_, i) => i), values: values.map((v) => [v]), labels: ["y"], units: [""], metadata: {},
});
const SRC: Dataset = { id: "src", name: "Film", data: data([1, 2, 3, 4]) };
const OTHER: Dataset = { id: "other", name: "Other", data: data([10, 20, 30, 40]) };
const st = () => useApp.getState();
const recipe = (source: string) => ({
  kind: "signal-correction" as const, version: 1 as const, operation: "Smooth", xUnit: "",
  channels: [{ index: 0, label: "y", unit: "" }],
  params: { signalChannels: [0], smoothEnabled: true, smoothMethod: "moving", smoothWindow: 2 },
  source,
});

function editSource(values: number[]): void {
  useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "src" ? { ...d, data: data(values) } : d)) }));
  st().touchDataset("src");
}

/** Linked sheets L (of src) and M (of other), both stale; the pass is held
 *  inside M's recompute, AFTER L was re-derived from the pre-edit source. */
async function heldPass(mode: "auto" | "manual" | "off") {
  useApp.setState({ datasets: [OTHER, SRC], activeId: "src", recalcMode: "manual" });
  const l = await createSignalWorksheetFromApp("src", recipe("src") as never);
  const m = await createSignalWorksheetFromApp("other", recipe("other") as never);
  if (!l || !m) throw new Error("setup");
  useApp.setState({ staleDatasets: [l, m], recalcMode: mode });
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const started = new Promise<void>((r) => { entered = r; });
  vi.mocked(applyCorrections).mockClear();
  vi.mocked(applyCorrections).mockImplementation(async ({ dataset }) => {
    if (dataset.values[0]![0] === 10) { entered(); await gate; }
    return structuredClone(dataset);
  });
  const pass = st().recalcNow();
  await started;
  return { l, m, release, pass };
}

beforeEach(() => {
  useApp.setState({
    datasets: [SRC], activeId: "src", analysisResults: [], history: [], future: [], selection: null,
    staleDatasets: [], staleFits: [], recalcMode: "manual", status: "",
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.mocked(applyCorrections).mockReset();
  vi.mocked(applyCorrections).mockImplementation(async ({ dataset }) => structuredClone(dataset));
});

describe("a user edit made while a recalc pass runs", () => {
  it("Manual: marks the already re-derived sheet stale instead of leaving it Current", async () => {
    const { l, m, release, pass } = await heldPass("manual");
    // L was re-derived from the pre-edit source and is Current right now.
    expect(st().staleDatasets).not.toContain(l);
    editSource([5, 6, 7, 8]);
    release();
    await pass;
    expect(st().staleDatasets).toContain(l);
    expect(st().staleDatasets).not.toContain(m); // the pass's own sheet settled
  });

  it("Auto: the edit re-runs L after the pass (one debounced pass), with no loop", async () => {
    const { l, release, pass } = await heldPass("auto");
    vi.useFakeTimers();
    editSource([5, 6, 7, 8]);
    editSource([5, 6, 7, 9]); // a burst of edits coalesces
    release();
    await pass;
    expect(st().staleDatasets).toContain(l);
    vi.mocked(applyCorrections).mockClear();
    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() => expect(st().staleDatasets).toEqual([]));
    expect(applyCorrections).toHaveBeenCalledTimes(1); // only L, once
    expect(st().datasets.find((d) => d.id === l)!.data.values[0]![0]).toBe(5);
    await vi.advanceTimersByTimeAsync(2000); // the re-run's own writes scheduled nothing
    expect(applyCorrections).toHaveBeenCalledTimes(1);
  });

  it("None: tracks nothing", async () => {
    const { release, pass } = await heldPass("off");
    editSource([5, 6, 7, 8]);
    release();
    await pass;
    expect(st().staleDatasets).toEqual([]);
  });

  it("keeps the redo stack (the replay records no history)", async () => {
    const { l, release, pass } = await heldPass("manual");
    const redo = [{ label: "x", datasets: [SRC] }] as never;
    useApp.setState({ future: redo });
    editSource([5, 6, 7, 8]);
    release();
    await pass;
    expect(st().staleDatasets).toContain(l);
    expect(st().future).toBe(redo);
  });

  it("the pass's own correction writes still never re-mark (no self-feeding)", async () => {
    useApp.setState({ datasets: [SRC, { id: "bgd", name: "Bg", data: data([1, 1, 1, 1]) }], recalcMode: "manual" });
    const corr = { signalChannels: [0], smoothEnabled: true, smoothMethod: "moving", smoothWindow: 2 };
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "src" ? { ...d, raw: d.data, corrections: corr } : d)),
      staleDatasets: ["src"],
    }));
    await st().recalcNow();
    expect(st().staleDatasets).toEqual([]);
  });
});
