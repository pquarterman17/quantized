// Batch integrate window ▸ baseline mode: the tangent baseline is offered,
// goes on the wire only when chosen, and the default stays linear.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveBlob } from "../../../lib/download";
import { integratePeaksBatch, type IntegrateBatchPeak } from "../../../lib/api/peaks";
import type { DataStruct } from "../../../lib/types";
import { analysisResultsReset } from "./batchIntegrateTestSetup";
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
    ...analysisResultsReset,
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

describe("BatchIntegrateWindow ▸ baseline mode", () => {
  it("defaults to the linear baseline", async () => {
    render(<BatchIntegrateWindow seedPeaks={[{ center: 1, fwhm: 0.5 }]} onClose={() => {}} />);
    expect(screen.getByLabelText("batch baseline")).toHaveValue("linear");
    fireEvent.click(screen.getByRole("button", { name: "Integrate" }));
    await screen.findByRole("region", { name: "batch integration results" });
    expect(vi.mocked(integratePeaksBatch).mock.calls[0][0].baseline).toBe("linear");
  });

  it("offers the tangent baseline and sends it", async () => {
    render(<BatchIntegrateWindow seedPeaks={[{ center: 1, fwhm: 0.5 }]} onClose={() => {}} />);
    const select = screen.getByLabelText("batch baseline");
    expect(within(select).getByRole("option", { name: "Tangent (both flanks)" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "tangent" } });
    fireEvent.click(screen.getByRole("button", { name: "Integrate" }));
    await screen.findByRole("region", { name: "batch integration results" });
    expect(vi.mocked(integratePeaksBatch).mock.calls[0][0].baseline).toBe("tangent");
  });
});
