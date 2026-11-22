// A linked Signal Processing output whose recipe reads the analysis view
// (`inputRows: "analysis-view"`) must follow the source's exclusions and Data
// Filter through the recalc mode, like any linked worksheet (lane SEL4).
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SignalCorrectionRecipe } from "../lib/signalRecipe";
import type { Dataset, DataStruct } from "../lib/types";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  applyCorrections: vi.fn(async ({ dataset }: { dataset: DataStruct }) => structuredClone(dataset)),
}));
import { applyCorrections } from "../lib/api";
import { createSignalWorksheetFromApp } from "./signalWorksheetCommand";
import { useApp } from "./useApp";

const SRC: Dataset = {
  id: "src", name: "Scan",
  data: { time: [1, 2, 3, 4], values: [[10], [20], [30], [40]], labels: ["v"], units: ["V"], metadata: {} },
};
const recipe = (rows: boolean): SignalCorrectionRecipe => ({
  kind: "signal-correction", version: 1, operation: "Smooth", xUnit: "",
  channels: [{ index: 0, label: "v", unit: "V" }],
  params: { signalChannels: [0], smoothEnabled: true, smoothMethod: "moving", smoothWindow: 2 },
  ...(rows ? { inputRows: "analysis-view" as const } : {}),
});
const stale = () => useApp.getState().staleDatasets;
const output = () => useApp.getState().datasets.find((d) => d.id !== "src")!;

async function link(analysisView: boolean): Promise<string> {
  const id = await createSignalWorksheetFromApp("src", recipe(analysisView));
  expect(id).toBeTruthy();
  useApp.setState({ staleDatasets: [] });
  return id!;
}

beforeEach(() => {
  vi.mocked(applyCorrections).mockClear();
  useApp.setState({
    datasets: [SRC], activeId: "src", analysisResults: [], history: [], future: [], selection: null,
    staleDatasets: [], staleFits: [], recalcMode: "manual",
  });
});

describe("analysis-view Signal Processing output", () => {
  it("manual: excluding a row marks the output stale", async () => {
    const id = await link(true);
    useApp.getState().toggleRowExcluded("src", 1);
    expect(stale()).toEqual([id]);
  });

  it("manual: a Data Filter marks the output stale", async () => {
    const id = await link(true);
    useApp.getState().setDatasetFilter("src", [{ col: 0, kind: "range", min: 25 }]);
    expect(stale()).toEqual([id]);
  });

  it("none: tracks nothing", async () => {
    await link(true);
    useApp.setState({ recalcMode: "off" });
    useApp.getState().toggleRowExcluded("src", 1);
    expect(stale()).toEqual([]);
  });

  it("auto: recalculates on the analysis view without the excluded row", async () => {
    const id = await link(true);
    useApp.setState({ recalcMode: "auto" });
    vi.mocked(applyCorrections).mockClear();
    useApp.getState().toggleRowExcluded("src", 1);
    await vi.waitFor(() => expect(stale()).toEqual([]), { timeout: 3000 });
    expect(output().id).toBe(id);
    expect(output().data.time).toEqual([1, 3, 4]);
  });

  it("manual then Recalculate now rebuilds on the analysis view", async () => {
    await link(true);
    useApp.getState().toggleRowExcluded("src", 1);
    await useApp.getState().recalcNow();
    expect(stale()).toEqual([]);
    expect(output().data.time).toEqual([1, 3, 4]);
  });

  // A full-worksheet recipe never reads exclusions, but the link is still the
  // source's data: staleness is conservative (fail closed), the recompute is a
  // no-op on the numbers. Documented in the roadmap.
  it("full-worksheet recipe: marked stale conservatively; recalc keeps every row", async () => {
    await link(false);
    useApp.getState().toggleRowExcluded("src", 1);
    await useApp.getState().recalcNow();
    expect(output().data.time).toEqual([1, 2, 3, 4]);
  });
});
