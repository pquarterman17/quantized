import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { williamsonHall } from "../../../lib/api/reductions";
import { peakDataFingerprint } from "../../../lib/peakTableFit";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import WilliamsonHallBatchSection from "./WilliamsonHallBatchSection";

vi.mock("../../../lib/api/reductions", () => ({ williamsonHall: vi.fn() }));

function source(id: string, wavelengthA: number): Dataset {
  const base: Dataset = { id, name: `${id}.xrdml`, data: {
    time: [30, 45], values: [[100], [80]], labels: ["Intensity"], units: ["cps"], metadata: {},
  } };
  return { ...base, peakTable: {
    version: 1,
    peaks: [
      { id: `${id}-p1`, center: 30, centerErr: null, fwhm: 0.2, fwhmErr: null, height: 10,
        heightErr: null, area: 2, bg: 1, eta: null, model: "Gaussian", status: "fit", excluded: false },
      { id: `${id}-p2`, center: 45, centerErr: null, fwhm: 0.3, fwhmErr: null, height: 8,
        heightErr: null, area: 2, bg: 1, eta: null, model: "Gaussian", status: "fit", excluded: false },
    ],
    provenance: { datasetId: id, datasetName: base.name, method: "simultaneous", model: "Gaussian",
      bgDegree: 0, linkMode: "None", constrain: false, bgCoeffs: [], R2: 0.99, rmse: 0.1,
      wavelengthA, xLabel: "2θ", xUnit: "deg", fingerprint: peakDataFingerprint(base),
      fittedAt: "2026-10-15T00:00:00Z" },
  } };
}

describe("WilliamsonHallBatchSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const datasets = [source("a", 1.5406), source("b", 0.7107)];
    useApp.setState({ datasets, activeId: "a", selectedIds: ["a", "b"], analysisResults: [],
      openAnalysisResultId: null, history: [], future: [], status: "",
      resolveDataset: vi.fn(async (id: string) => datasets.find((dataset) => dataset.id === id)) });
    vi.mocked(williamsonHall).mockResolvedValue({ grain_size_nm: 24, microstrain: 0.001, r2: 0.98,
      plot_x: [1, 2], plot_y: [0.01, 0.02], fit_line: [0.01, 0.001] });
  });

  it("preflights selected worksheets and publishes one durable comparison", async () => {
    render(<WilliamsonHallBatchSection fallbackWavelengthA={1.2} kFactor={0.9} instrumentalBroadeningDeg={0.05} />);
    fireEvent.click(screen.getByRole("button", { name: /compare selected worksheets/i }));
    expect(screen.getAllByText("Ready")).toHaveLength(2);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Run comparison" })); });
    await waitFor(() => expect(useApp.getState().analysisResults).toHaveLength(1));
    expect(williamsonHall).toHaveBeenNthCalledWith(1, expect.objectContaining({ wavelength_a: 1.5406 }));
    expect(williamsonHall).toHaveBeenNthCalledWith(2, expect.objectContaining({ wavelength_a: 0.7107 }));
    expect(useApp.getState().analysisResults[0]).toMatchObject({
      producer: { id: "williamson-hall-batch" },
      tables: [{ rows: [["a.xrdml", 24, 0.001, 0.98, 2, 1.5406, "Completed",
        "Only two peaks were fitted; R² cannot assess model adequacy."],
      ["b.xrdml", 24, 0.001, 0.98, 2, 0.7107, "Completed",
        "Only two peaks were fitted; R² cannot assess model adequacy."]] }],
    });
    expect(useApp.getState().history).toHaveLength(1);
  });

  it("keeps a failed worksheet visible in the saved comparison", async () => {
    vi.mocked(williamsonHall)
      .mockResolvedValueOnce({ grain_size_nm: 24, microstrain: 0.001, r2: 0.98,
        plot_x: [1, 2], plot_y: [0.01, 0.02], fit_line: [0.01, 0.001] })
      .mockRejectedValueOnce(new Error("fit matrix is singular"));
    render(<WilliamsonHallBatchSection fallbackWavelengthA={1.2} kFactor={0.9} instrumentalBroadeningDeg={0.05} />);
    fireEvent.click(screen.getByRole("button", { name: /compare selected worksheets/i }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Run comparison" })); });
    await waitFor(() => expect(useApp.getState().analysisResults).toHaveLength(1));
    const result = useApp.getState().analysisResults[0];
    expect(result.sources).toEqual([{ datasetId: "a", role: "input" }]);
    expect(result.tables?.[0].rows).toEqual([
      ["a.xrdml", 24, 0.001, 0.98, 2, 1.5406, "Completed",
        "Only two peaks were fitted; R² cannot assess model adequacy."],
      ["b.xrdml", null, null, null, null, null, "Failed", "fit matrix is singular"],
    ]);
    expect(result.warnings).toContain("b.xrdml: fit matrix is singular");
  });
});
