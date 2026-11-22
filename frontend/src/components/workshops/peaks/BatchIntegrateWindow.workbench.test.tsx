// Batch integrate on the workbench shell's out-of-date pattern (lane WB4). The
// run stays a button on its own sequenced request (it resolves several
// datasets first, so it is not a useWorkbenchPreview run) and stamps the table
// with the picks, windows, baseline, alignment, channels and picked datasets'
// data it was launched with. When any moves on the table is marked Out of date
// and neither the CSV export nor the trend dataset (which would write it into
// the library as if current) is available until the next Integrate.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { integratePeaksBatch, type IntegrateBatchPeak, type IntegrateBatchResponse } from "../../../lib/api/peaks";
import { saveBlob } from "../../../lib/download";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import BatchIntegrateWindow from "./BatchIntegrateWindow";
import { analysisResultsReset } from "./batchIntegrateTestSetup";

vi.mock("../../../lib/api/peaks", () => ({ integratePeaksBatch: vi.fn() }));
vi.mock("../../../lib/download", () => ({ saveBlob: vi.fn() }));

const scan = (temperature: string, xs = [0, 1, 2, 3, 4, 5]): DataStruct => ({
  time: xs, values: [[1], [5], [2], [6], [2], [1]], labels: ["I"], units: ["cps"], metadata: { temperature },
});
const peak = (area: number): IntegrateBatchPeak => ({
  region: [0.5, 1.5], area, area_pct: 100, centroid: 1, height: 5, position: 1, fwhm: 0.5,
});
const RESPONSE: IntegrateBatchResponse = {
  regions: [[0.5, 1.5]], n_spectra: 2, n_regions: 1, aligned: false, reference: 0, baseline: "linear", n_failed: 0,
  results: [
    { index: 0, label: "hot", ok: true, shift_samples: 0, shift_x: 0, total_area: 3, peaks: [peak(3)] },
    { index: 1, label: "cold", ok: true, shift_samples: 0, shift_x: 0, total_area: 7, peaks: [peak(7)] },
  ],
};

const OUT_OF_DATE = /Out of date/;
const trends = () => useApp.getState().datasets.filter((d) => d.data.metadata.source === "peak-batch-integrate");

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "hot", data: scan("300 K") }, { id: "d2", name: "cold", data: scan("100 K") }],
    activeId: "d1", selectedIds: ["d1", "d2"], xKey: null, yKeys: null, seriesOrder: null,
    ...analysisResultsReset,
  });
  vi.mocked(integratePeaksBatch).mockResolvedValue(RESPONSE);
});

async function integrated() {
  render(<BatchIntegrateWindow seedPeaks={[{ center: 1, fwhm: 0.5 }]} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Integrate" }));
  await screen.findByRole("region", { name: "batch integration results" });
}

describe("Batch integrate freshness", () => {
  it("characterization: nothing runs on an edit; a fresh table can be exported and added", async () => {
    render(<BatchIntegrateWindow seedPeaks={[{ center: 1, fwhm: 0.5 }]} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("batch baseline"), { target: { value: "none" } });
    await act(async () => {});
    expect(integratePeaksBatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Integrate" }));
    await screen.findByRole("region", { name: "batch integration results" });
    expect(screen.queryByText(OUT_OF_DATE)).toBeNull();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add trend dataset" })).toBeEnabled();
  });

  it("changing the baseline after a run marks the table Out of date and withholds export and the trend", async () => {
    await integrated();
    fireEvent.change(screen.getByLabelText("batch baseline"), { target: { value: "none" } });
    expect(await screen.findByText(OUT_OF_DATE)).toBeInTheDocument();
    const csv = screen.getByRole("button", { name: "Export CSV" });
    const add = screen.getByRole("button", { name: "Add trend dataset" });
    expect(csv).toBeDisabled();
    expect(add).toBeDisabled();
    expect(add.getAttribute("title")).toMatch(/Integrate again/);
    fireEvent.click(csv);
    fireEvent.click(add);
    expect(saveBlob).not.toHaveBeenCalled();
    expect(trends()).toHaveLength(0);
    expect(integratePeaksBatch).toHaveBeenCalledTimes(1); // an edit never reruns

    fireEvent.click(screen.getByRole("button", { name: "Integrate" }));
    await waitFor(() => expect(screen.queryByText(OUT_OF_DATE)).toBeNull());
    expect(screen.getByRole("button", { name: "Add trend dataset" })).toBeEnabled();
  });

  it("changing a window, a pick or an integrated dataset's data does the same", async () => {
    await integrated();
    fireEvent.change(screen.getByLabelText("window 1 low"), { target: { value: "0.4" } });
    await screen.findByText(OUT_OF_DATE);
    fireEvent.change(screen.getByLabelText("window 1 low"), { target: { value: "0.5" } });
    await waitFor(() => expect(screen.queryByText(OUT_OF_DATE)).toBeNull());

    act(() => useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "d2" ? { ...d, data: { ...d.data, time: [0, 1, 2, 3, 4, 9] } } : d)),
    })));
    expect(await screen.findByText(OUT_OF_DATE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add trend dataset" })).toBeDisabled();
  });

  it("forced race: data edited while the request is in flight lands the table out of date", async () => {
    let land!: (r: IntegrateBatchResponse) => void;
    let began!: () => void;
    const started = new Promise<void>((r) => { began = r; });
    vi.mocked(integratePeaksBatch).mockImplementationOnce(() => { began(); return new Promise((r) => { land = r; }); });
    render(<BatchIntegrateWindow seedPeaks={[{ center: 1, fwhm: 0.5 }]} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Integrate" }));
    await started;
    act(() => useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "d1" ? { ...d, data: { ...d.data, time: [0, 1, 2, 3, 4, 9] } } : d)),
    })));
    await act(async () => { land(RESPONSE); });
    await screen.findByRole("region", { name: "batch integration results" });
    expect(screen.getByText(OUT_OF_DATE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add trend dataset" })).toBeDisabled();
  });

  it("a differing x grid with Align on is a refusal alert; a failed request is an error alert", async () => {
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "d2" ? { ...d, data: scan("100 K", [0, 2, 4, 6, 8, 10]) } : d)),
    }));
    render(<BatchIntegrateWindow seedPeaks={[{ center: 1, fwhm: 0.5 }]} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Align to first"));
    fireEvent.click(screen.getByRole("button", { name: "Integrate" }));
    const refusal = await screen.findByRole("alert");
    expect(refusal).toHaveAttribute("data-kind", "refusal");
    expect(integratePeaksBatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Align to first"));
    vi.mocked(integratePeaksBatch).mockRejectedValueOnce(new Error("server down"));
    fireEvent.click(screen.getByRole("button", { name: "Integrate" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveAttribute("data-kind", "error"));
    expect(screen.getByRole("alert")).toHaveTextContent("server down");
  });
});
