// "By" (run once per level of a categorical column) for Find Peaks, Peak
// analyzer, Baseline and Signal Processing, over the shared byrun section.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections } from "../../../lib/api";
import { baselineALS } from "../../../lib/api/baseline";
import { findPeaks } from "../../../lib/api/peaks";
import { runSpectralWorkbench } from "../../../lib/api/spectralWorkbench";
import { DEFAULT_RECIPE } from "../../../lib/peakwizard";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import BaselineByLevel from "../baseline/BaselineByLevel";
import { DEFAULT_PEAK_FIND } from "../peaks/peakFindParams";
import PeakByLevelSection from "../peaks/PeakByLevelSection";
import PeakWizardByLevel from "../peakwizard/PeakWizardByLevel";
import SignalScopeAndBy, { signalLevelSummary } from "../signalprocessing/SignalScopeAndBy";
import { DEFAULT_SIGNAL_SETTINGS, settingsToParams } from "../signalprocessing/signalProcessingModel";

vi.mock("../../../lib/api", () => ({ applyCorrections: vi.fn(), fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/peaks", () => ({ findPeaks: vi.fn() }));
vi.mock("../../../lib/api/spectralWorkbench", () => ({ runSpectralWorkbench: vi.fn() }));
vi.mock("../../../lib/api/baseline", () => ({
  baselineALS: vi.fn(), baselineAnchor: vi.fn(), baselineEstimate: vi.fn(), baselineModPoly: vi.fn(),
  baselineRegion: vi.fn(), baselineRollingBall: vi.fn(), baselineShirley: vi.fn(), baselineXrdLowAngle: vi.fn(),
}));

// Column 0 = Group (two levels of six rows), column 1 = Signal.
const DATA: DataStruct = {
  time: Array.from({ length: 12 }, (_, i) => i),
  values: Array.from({ length: 12 }, (_, i) => [i < 6 ? 0 : 1, (i < 6 ? 1 : 11) + (i % 6)]),
  labels: ["Group", "Signal"],
  units: ["", "cps"],
  metadata: {},
};

function setup(data: DataStruct = DATA, pending = false) {
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data, ...(pending ? { pending: { kind: "path" as const, path: "/r.opj", bookId: "B", rows: 12, cols: 2 } } : {}) }],
    activeId: "d1", xKey: null, yKeys: [1], seriesOrder: null,
  });
}

const pickGroup = () => fireEvent.change(screen.getByLabelText(/By \(optional\)/), { target: { value: "0" } });
const bodyRows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);

beforeEach(() => {
  vi.clearAllMocks();
  setup();
});

describe("Find Peaks By", () => {
  it("runs the detector once per level on that level's own rows", async () => {
    vi.mocked(findPeaks).mockImplementation(async ({ y }) => ({
      peaks: [{ center: y[0]!, prominence: 1, localSNR: 7 }], background: [],
    }) as never);
    render(<PeakByLevelSection params={{ ...DEFAULT_PEAK_FIND }} />);
    expect(screen.queryByRole("table")).toBeNull(); // nothing runs until a By column is chosen
    expect(findPeaks).not.toHaveBeenCalled();
    pickGroup();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(vi.mocked(findPeaks).mock.calls.map(([req]) => req.y)).toEqual([[1, 2, 3, 4, 5, 6], [11, 12, 13, 14, 15, 16]]);
    const [first, second] = bodyRows().map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(first?.slice(1)).toEqual(["6", "1", "1", "7"]);
    expect(second?.[3]).toBe("11");
  });

  it("reports a failing level as an error row and still shows the others", async () => {
    vi.mocked(findPeaks).mockImplementation(async ({ y }) => {
      if (y[0] === 11) throw new Error("detector exploded");
      return { peaks: [], background: [] } as never;
    });
    render(<PeakByLevelSection params={{ ...DEFAULT_PEAK_FIND }} />);
    pickGroup();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(bodyRows()[1]).toHaveTextContent("detector exploded");
    expect(bodyRows()[0]).not.toHaveTextContent("detector exploded");
  });

  it("re-runs when a detector setting changes", async () => {
    // The mock finds a peak only at the raised threshold, so the table shows which run it is.
    vi.mocked(findPeaks).mockImplementation(async (req) => ({
      peaks: req.snr_threshold === 9 ? [{ center: 1, prominence: 1, localSNR: 9 }] : [], background: [],
    }) as never);
    const view = render(<PeakByLevelSection params={{ ...DEFAULT_PEAK_FIND }} />);
    pickGroup();
    await waitFor(() => expect(bodyRows()[0]).toHaveTextContent("0"));
    view.rerender(<PeakByLevelSection params={{ ...DEFAULT_PEAK_FIND, snr_threshold: 9 }} />);
    await waitFor(() => expect(within(bodyRows()[0]!).getAllByRole("cell")[2]).toHaveTextContent("1"));
  });

  it("offers no By when no column is categorical", () => {
    setup({ ...DATA, values: DATA.values.map((row, i) => [i * 0.37, row[1]!]) });
    render(<PeakByLevelSection params={{ ...DEFAULT_PEAK_FIND }} />);
    expect(screen.queryByLabelText(/By \(optional\)/)).toBeNull();
  });

  it("says why instead of running on a lazy preview", async () => {
    setup(DATA, true);
    render(<PeakByLevelSection params={{ ...DEFAULT_PEAK_FIND }} />);
    pickGroup();
    await waitFor(() => expect(bodyRows()[0]).toHaveTextContent("wait for the full dataset"));
    expect(findPeaks).not.toHaveBeenCalled();
  });
});

describe("Peak analyzer By", () => {
  it("applies the recipe's baseline then its find on every level", async () => {
    vi.mocked(baselineALS).mockImplementation(async ({ y }) => ({ baseline: y.map(() => 1) }) as never);
    vi.mocked(findPeaks).mockResolvedValue({ peaks: [{ center: 3, prominence: 2, localSNR: 9 }], background: [] } as never);
    const recipe = { ...DEFAULT_RECIPE, baseline: { ...DEFAULT_RECIPE.baseline, method: "als" as const, lam: 1e5, p: 0.02 } };
    render(<PeakWizardByLevel recipe={recipe} />);
    pickGroup();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(baselineALS).toHaveBeenCalledTimes(2);
    // The find sees the baseline-subtracted trace of each level.
    expect(vi.mocked(findPeaks).mock.calls.map(([req]) => req.y)).toEqual([[0, 1, 2, 3, 4, 5], [10, 11, 12, 13, 14, 15]]);
  });
});

describe("Baseline By", () => {
  const params = { lam: 1e6, p: 0.01, radius: 100, order: 5, maxWindowDeg: 2, regionXMin: NaN, regionXMax: NaN, regionYMin: NaN, regionYMax: NaN, maxIter: 50, anchorMethod: "pchip" };

  it("estimates the baseline per level and reports its range and the residual", async () => {
    vi.mocked(baselineALS).mockImplementation(async ({ y }) => ({ baseline: y.map((v) => v - 2) }) as never);
    render(<BaselineByLevel b={{ method: "als", params }} />);
    pickGroup();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(vi.mocked(baselineALS).mock.calls.map(([req]) => req.y[0])).toEqual([1, 11]);
    expect(bodyRows()[0]!.textContent).toContain("-1"); // baseline min of level 1 = 1 - 2
    expect(within(bodyRows()[1]!).getAllByRole("cell")[4]).toHaveTextContent("2"); // residual RMS
  });

  it("does not guess for the hand-placed anchor method", async () => {
    render(<BaselineByLevel b={{ method: "anchor", params }} />);
    pickGroup();
    await waitFor(() => expect(bodyRows()[0]).toHaveTextContent("placed by hand"));
  });
});

describe("Signal Processing By", () => {
  const settings = DEFAULT_SIGNAL_SETTINGS;
  const out = (mean: number): DataStruct => ({ time: [0, 1], values: [[mean], [mean]], labels: ["Signal"], units: [""], metadata: {} });

  it("runs the configured correction on each level's rows", async () => {
    vi.mocked(applyCorrections).mockImplementation(async ({ dataset }) => out(dataset.values[0]![1]!) as never);
    const params = settingsToParams(settings, [1]);
    const source = useApp.getState().datasets[0]!;
    render(<SignalScopeAndBy source={source} secondary={null} params={params} spectralRecipe={null} blockedReason={null} settingsKey="k" />);
    pickGroup();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    const sent = vi.mocked(applyCorrections).mock.calls.map(([req]) => req.dataset.values.map((r) => r[1]));
    expect(sent).toEqual([[1, 2, 3, 4, 5, 6], [11, 12, 13, 14, 15, 16]]);
    expect(within(bodyRows()[1]!).getAllByRole("cell")[4]).toHaveTextContent("11");
  });

  it("runs the spectral workbench per level for a spectral recipe", async () => {
    vi.mocked(runSpectralWorkbench).mockResolvedValue(out(5) as never);
    const source = useApp.getState().datasets[0]!;
    render(<SignalScopeAndBy source={source} secondary={null} params={null} spectralRecipe={{ op: "fft" } as never} blockedReason={null} settingsKey="s" />);
    pickGroup();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(runSpectralWorkbench).toHaveBeenCalledTimes(2);
  });

  it("shows the blocking reason instead of running", async () => {
    const source = useApp.getState().datasets[0]!;
    render(<SignalScopeAndBy source={source} secondary={null} params={null} spectralRecipe={null} blockedReason="Select at least one signal column." settingsKey="k" />);
    pickGroup();
    await waitFor(() => expect(bodyRows()[0]).toHaveTextContent("Select at least one signal column."));
    expect(applyCorrections).not.toHaveBeenCalled();
  });

  it("summarises an all-gap output as an error, not zeros", () => {
    expect(() => signalLevelSummary({ time: [0], values: [[NaN]], labels: ["a"], units: [""], metadata: {} })).toThrow(/no finite output/);
  });
});
