// Row exclusion / filter are part of a dataset's ANALYSIS VIEW, so they must
// notify the recalc engine exactly like a data edit (`touchDataset`): linked
// derived worksheets and committed outputs go stale (manual), recalculate
// (auto) or track nothing (off); snapshot results follow the analysis-view
// fingerprint in every mode. Lane RX.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { analysisDataFingerprint, snapshotResultState } from "../lib/analysisResultFreshness";
import type { DistributionSnapshot } from "../lib/distributionAnalysisResult";
import type { Dataset, DataStruct } from "../lib/types";
import { commitAnalysisOutput } from "./analysisOutputCommit";
import { publishDistributionResult } from "./distributionResults";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  applyCorrections: vi.fn(),
}));
import { applyCorrections } from "../lib/api";

const data = (values = [1, 2, 3, 4]): DataStruct => ({
  time: values.map((_, i) => i), values: values.map((v) => [v]), labels: ["y"], units: [""], metadata: {},
});
const SRC: Dataset = { id: "src", name: "Film", data: data() };
const SHEET: Dataset = {
  id: "sheet", name: "Film (processed)", data: data([9, 9, 9, 9]),
  derivedFrom: { datasetId: "src", pipeline: "yOff=-1" }, corrections: { yOff: -1 },
};
const stale = () => useApp.getState().staleDatasets;
const live = () => useApp.getState().datasets.find((d) => d.id === "src")!;

/** Every row-state gesture that changes the analysis view, each from a clean source. */
const GESTURES: [string, () => void][] = [
  ["toggle a row", () => useApp.getState().toggleRowExcluded("src", 1)],
  ["exclude a set of rows", () => useApp.getState().setRowsExcluded("src", [0, 2])],
  ["exclude the selection", () => {
    useApp.getState().setRowSelection([1]);
    useApp.getState().excludeSelectedRows();
  }],
  ["keep only the selection", () => {
    useApp.getState().setRowSelection([1]);
    useApp.getState().keepOnlySelectedRows();
  }],
  ["set a data filter", () => useApp.getState().setDatasetFilter("src", [{ col: 0, kind: "range", min: 2 }])],
];
const CLEARS: [string, Partial<Dataset>, () => void][] = [
  ["clear exclusions", { excludedRows: [1] }, () => useApp.getState().clearRowExclusions("src")],
  ["clear the filter", { filter: [{ col: 0, kind: "range", min: 2 }] }, () => useApp.getState().clearDatasetFilter("src")],
];

beforeEach(() => {
  vi.mocked(applyCorrections).mockReset();
  useApp.setState({
    datasets: [SRC, SHEET], activeId: "src", analysisResults: [], history: [], future: [], selection: null,
    staleDatasets: [], staleFits: [], recalcMode: "manual",
  });
});
afterEach(() => vi.useRealTimers());

describe("derived worksheets", () => {
  it.each(GESTURES)("manual: %s marks the linked sheet stale", (_n, run) => {
    run();
    expect(stale()).toEqual(["sheet"]);
  });

  it.each(CLEARS)("manual: %s marks the linked sheet stale", (_n, over, run) => {
    useApp.setState({ datasets: [{ ...SRC, ...over }, SHEET] });
    run();
    expect(stale()).toEqual(["sheet"]);
  });

  it("off tracks nothing", () => {
    useApp.setState({ recalcMode: "off" });
    for (const [, run] of GESTURES) run();
    expect(stale()).toEqual([]);
  });

  it("auto: recalculates once for a burst of filter updates (the engine's own debounce)", async () => {
    vi.mocked(applyCorrections).mockResolvedValue(data([7, 7, 7, 7]));
    useApp.setState({ recalcMode: "auto" });
    for (let min = 1; min <= 6; min++) {
      useApp.getState().setDatasetFilter("src", [{ col: 0, kind: "range", min }]);
    }
    expect(stale()).toEqual(["sheet"]);
    expect(applyCorrections).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(stale()).toEqual([]), { timeout: 3000 });
    expect(applyCorrections).toHaveBeenCalledTimes(1);
    expect(useApp.getState().datasets.find((d) => d.id === "sheet")!.data.values).toEqual([[7], [7], [7], [7]]);
    // One coalesced undo entry for the whole slider run.
    expect(useApp.getState().history).toHaveLength(1);
  });

  it("a no-change filter edit marks nothing", () => {
    useApp.getState().setDatasetFilter("src", []);
    expect(stale()).toEqual([]);
  });

  it("undo and redo still restore the exclusion", () => {
    useApp.getState().toggleRowExcluded("src", 1);
    expect(live().excludedRows).toEqual([1]);
    useApp.getState().undo();
    expect(live().excludedRows).toBeUndefined();
    useApp.getState().redo();
    expect(live().excludedRows).toEqual([1]);
    // Stale marks are conservative: they are never un-marked by undo.
    expect(stale()).toEqual(["sheet"]);
  });
});

describe("committed outputs", () => {
  const commit = () => commitAnalysisOutput({
    producer: { id: "surface-fit", label: "Surface fit", version: 1 },
    sourceId: "src", computedOn: analysisDataFingerprint(live()), settings: { model: "Plane" },
    output: (s) => ({ name: `${s.name} (fit)`, data: data([5, 5, 5, 5]) }),
  });

  it.each(GESTURES)("manual: %s marks the committed output stale", (_n, run) => {
    useApp.setState({ datasets: [SRC] });
    const outcome = commit();
    const outputId = outcome.kind === "created" ? outcome.outputId : "";
    useApp.setState({ activeId: "src" }); // a commit activates the new output
    run();
    expect(stale()).toEqual([outputId]);
  });

  it("off tracks nothing", () => {
    useApp.setState({ datasets: [SRC], recalcMode: "off" });
    commit();
    useApp.getState().toggleRowExcluded("src", 0);
    expect(stale()).toEqual([]);
  });
});

describe("snapshot results", () => {
  const snapshot: DistributionSnapshot = {
    label: "y", byLabel: null, hist: { counts: [2, 1], centers: [15, 25], edges: [10, 20, 30] },
    desc: { N: 3, mean: 20, median: 20, std: 10, min: 10, q1: 15, q3: 25, max: 30 },
    norm: { W: 0.99, p: 0.7, N: 3 }, normNote: null, levels: [], totalLevels: 0, rankedFits: [],
    rankingMetric: "ks_p", quantiles: { q1: 13, median: 20, q3: 27 }, percentileValue: 32, skipped: [],
  };
  const recipe = { col: 0, byCol: null, fitDist: "normal" as const, compareOpen: false, percentileInput: 90 };

  it.each(["auto", "manual", "off"] as const)(
    "goes out of date when rows are excluded or filtered, in %s mode",
    (recalcMode) => {
      useApp.setState({ recalcMode, datasets: [SRC] });
      expect(publishDistributionResult(live(), recipe, snapshot)).toBeTruthy();
      const result = () => useApp.getState().analysisResults[0]!;
      expect(snapshotResultState(result(), [live()])).toBe("current");
      useApp.getState().toggleRowExcluded("src", 1);
      expect(snapshotResultState(result(), [live()])).toBe("out-of-date");
      useApp.getState().clearRowExclusions("src");
      expect(snapshotResultState(result(), [live()])).toBe("current");
      useApp.getState().setDatasetFilter("src", [{ col: 0, kind: "range", min: 2 }]);
      expect(snapshotResultState(result(), [live()])).toBe("out-of-date");
    },
  );
});
