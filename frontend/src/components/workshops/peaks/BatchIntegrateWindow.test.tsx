// Batch integrate window, end to end through the store: pick datasets, seed
// windows from the panel's peaks, run one integrate-batch request, read the
// dataset x window table, export it as CSV, and land the trend (integrated
// intensity vs temperature) in the library with its provenance.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveBlob } from "../../../lib/download";
import { integratePeaksBatch, type IntegrateBatchPeak } from "../../../lib/api/peaks";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import BatchIntegrateWindow from "./BatchIntegrateWindow";

vi.mock("../../../lib/api/peaks", () => ({ integratePeaksBatch: vi.fn() }));
vi.mock("../../../lib/download", () => ({ saveBlob: vi.fn() }));

const scan = (temperature: string, labels = ["I"]): DataStruct => ({
  time: [0, 1, 2, 3, 4, 5],
  values: [[1], [5], [2], [6], [2], [1]],
  labels,
  units: labels.map(() => "cps"),
  metadata: { temperature },
});

const peak = (area: number): IntegrateBatchPeak => ({
  region: [0.5, 1.5], area, area_pct: 100, centroid: 1, height: 5, position: 1, fwhm: 0.5,
});

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [
      { id: "d1", name: "hot", data: scan("300 K") },
      { id: "d2", name: "cold", data: scan("100 K") },
      { id: "d3", name: "other", data: scan("200 K", ["Q"]) },
    ],
    activeId: "d1",
    selectedIds: ["d1", "d2", "d3"],
    xKey: null,
    yKeys: null,
    seriesOrder: null,
  });
  vi.mocked(integratePeaksBatch).mockResolvedValue({
    regions: [[0.5, 1.5]], n_spectra: 2, n_regions: 1, aligned: false, reference: 0,
    baseline: "linear", n_failed: 0,
    results: [
      { index: 0, label: "hot", ok: true, shift_samples: 0, shift_x: 0, total_area: 3, peaks: [peak(3)] },
      { index: 1, label: "cold", ok: true, shift_samples: 0, shift_x: 0, total_area: 7, peaks: [peak(7)] },
    ],
  });
});

describe("BatchIntegrateWindow", () => {
  it("integrates the picked datasets, tabulates, exports CSV and adds the trend vs temperature", async () => {
    render(<BatchIntegrateWindow seedPeaks={[{ center: 1, fwhm: 0.5 }]} onClose={() => {}} />);

    // Seeded from the panel's peak: 1 ± 0.5.
    expect(screen.getByLabelText("window 1 low")).toHaveValue("0.5");
    fireEvent.click(screen.getByRole("button", { name: "Integrate" }));

    const table = await screen.findByRole("region", { name: "batch integration results" });
    // Every picked dataset has a row: "other" has no "I" column and says so.
    expect(within(table).getByText("hot")).toBeInTheDocument();
    expect(within(table).getByText('no column named "I"')).toBeInTheDocument();
    const body = vi.mocked(integratePeaksBatch).mock.calls[0][0];
    expect(body.labels).toEqual(["hot", "cold"]);
    expect(body.regions).toEqual([[0.5, 1.5]]);

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    const blob = vi.mocked(saveBlob).mock.calls[0][0];
    expect((await blob.text()).split("\n")[1]).toMatch(/^hot,1,0.5,1.5,ok,3,/);

    const field = screen.getByLabelText("trend x field");
    const temperature = within(field).getByRole("option", { name: "temperature" }) as HTMLOptionElement;
    fireEvent.change(field, { target: { value: temperature.value } });
    fireEvent.click(screen.getByRole("button", { name: "Add trend dataset" }));
    const trend = useApp.getState().datasets.find((d) => d.data.metadata.source === "peak-batch-integrate");
    expect(trend?.data.time).toEqual([100, 300]);
    expect(trend?.data.values.map((r) => r[0])).toEqual([7, 3]);
    expect(trend?.data.metadata.x_column_unit).toBe("K");
    expect(trend?.data.metadata.peakIntegrateBatch).toMatchObject({ windows: [[0.5, 1.5]] });
  });

  it("blocks the run, saying why, when there is no window", () => {
    render(<BatchIntegrateWindow seedPeaks={[]} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Integrate" })).toBeDisabled();
    expect(screen.getByText("add at least one integration window")).toBeInTheDocument();
  });
});
