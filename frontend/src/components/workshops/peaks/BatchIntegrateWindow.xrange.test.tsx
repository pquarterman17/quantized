// The trend's recorded inputs (acceptance C9) carry the X range of the column each
// worksheet was integrated against, resolved BY NAME per worksheet: the same X
// channel sits at a different index in each, and neither is the time axis.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { integratePeaksBatch, type IntegrateBatchPeak } from "../../../lib/api/peaks";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { analysisResultsReset } from "./batchIntegrateTestSetup";
import BatchIntegrateWindow from "./BatchIntegrateWindow";

vi.mock("../../../lib/api/peaks", () => ({ integratePeaksBatch: vi.fn() }));

const peak = (area: number): IntegrateBatchPeak => ({
  region: [10.5, 12.5], area, area_pct: 100, centroid: 11, height: 5, position: 11, fwhm: 0.5,
});
const meta = {};
const tFirst: Dataset = {
  id: "d1", name: "first",
  data: { time: [0, 1, 2], values: [[10, 1, 10], [11, 5, 11], [12, 1, 12]], labels: ["T", "I", "T2"], units: ["K", "cps", "K"], metadata: meta },
};
const tSecond: Dataset = {
  id: "d2", name: "second",
  data: { time: [0, 1, 2], values: [[1, 100, 100], [5, 101, 101], [1, 102, 102]], labels: ["I", "T", "T2"], units: ["cps", "K", "K"], metadata: meta },
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [tFirst, tSecond], activeId: "d1", selectedIds: ["d1", "d2"], xKey: 0, yKeys: [1], seriesOrder: null, ...analysisResultsReset,
  });
  vi.mocked(integratePeaksBatch).mockResolvedValue({
    regions: [[10.5, 12.5]], n_spectra: 2, n_regions: 1, aligned: false, reference: 0, baseline: "linear", n_failed: 0,
    results: [
      { index: 0, label: "first", ok: true, shift_samples: 0, shift_x: 0, total_area: 3, peaks: [peak(3)] },
      { index: 1, label: "second", ok: true, shift_samples: 0, shift_x: 0, total_area: 7, peaks: [peak(7)] },
    ],
  });
});

describe("Batch integrate records each worksheet's own X column (acceptance C9)", () => {
  it("a channel X resolved by name gives each source its own column range, not the time axis", async () => {
    render(<BatchIntegrateWindow seedPeaks={[{ center: 11, fwhm: 1 }]} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Integrate" }));
    await screen.findByRole("region", { name: "batch integration results" });
    fireEvent.click(screen.getByRole("button", { name: "Add trend dataset" }));
    expect(useApp.getState().analysisResults[0]?.parameters?.["inputs"]).toMatchObject({
      items: [{ datasetId: "d1", xLabel: "T", xRange: [10, 12] }, { datasetId: "d2", xLabel: "T", xRange: [100, 102] }],
    });
  });
});
