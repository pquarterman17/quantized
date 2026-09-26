// The Peaks workshop showing a table the Peak Analyzer's model fit published
// (audit P2.1 uncertainties): each value reads "value ± error", a null error
// reads "± —" with its saved reason on hover, the header names the producer,
// and a legacy table (no errors measured) keeps rendering bare values.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reportEmit } from "../../../lib/api";
import { findPeaks, fitMultiPeak } from "../../../lib/api/peaks";
import { peakDataFingerprint, peakTableFromFit } from "../../../lib/peakTableFit";
import type { Dataset } from "../../../lib/types";
import { askConfirm } from "../../../store/confirmDialog";
import { editPeak, publishPeakTable, removePeaks, setPeakExcluded } from "../../../store/peakTables";
import { useApp } from "../../../store/useApp";
import { modelFitResponse } from "../peakwizard/modelFit.testkit";
import { peakTableFromModelFit } from "../peakwizard/modelFitPeakTable";
import PeaksPanel from "./PeaksPanel";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn(), reportEmit: vi.fn() }));
vi.mock("../../../lib/api/peaks", () => ({ findPeaks: vi.fn(), fitMultiPeak: vi.fn(), fitPeak: vi.fn() }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn() }));

const DS: Dataset = {
  id: "d1",
  name: "x.dat",
  data: { time: [0, 1, 2, 3, 4, 5], values: [[1], [2], [6], [2], [3], [1]], labels: ["I"], units: ["cps"], metadata: {} },
};

function show(ds: Dataset) {
  useApp.setState({
    datasets: [ds], activeId: "d1", xKey: null, yKeys: null, seriesOrder: null,
    peakOverlay: null, annotations: [], history: [], future: [], peaksOpen: true, reports: [],
  });
  render(<PeaksPanel />);
}

// One test holds `resolveDataset` open; every test starts from the real one.
const realResolve = useApp.getState().resolveDataset;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findPeaks).mockResolvedValue({ peaks: [], background: [] });
  useApp.setState({ resolveDataset: realResolve });
});

describe("PeaksPanel — a published model-fit table", () => {
  it("shows value ± error, and a reasoned dash where the fit reported none", async () => {
    const table = peakTableFromModelFit(modelFitResponse(), DS, {
      xKey: null, recipe: null, baseline: "none", bgAtCenter: [0.5, 0.5], fingerprint: peakDataFingerprint(DS),
    }, null);
    show({ ...DS, peakTable: table });
    const grid = await screen.findByRole("table", { name: "fitted peaks" });
    const rows = within(grid).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const cells = (r: number) => within(rows[r]).getAllByRole("cell");
    expect(cells(0)[1]).toHaveTextContent("2.01 ± 0.004"); // centre
    expect(cells(0)[2]).toHaveTextContent("5.2 ± 0.05"); // height
    expect(cells(0)[3]).toHaveTextContent("0.81 ± 0.01"); // FWHM
    // p0's area: no error (its eta is on a bound) — a dash that says why
    const dash = cells(0)[4].querySelector("[data-no-error]");
    expect(dash).toHaveTextContent("± —");
    expect(dash?.getAttribute("title")).toMatch(/on a bound/);
    // p1's centre was fixed
    expect(cells(1)[1].querySelector("[data-no-error]")?.getAttribute("title")).toMatch(/^fixed/);
    expect(cells(1)[4]).toHaveTextContent("1.81 ± 0.03");
    expect(screen.getByText(/Peak Analyzer model fit/)).toBeInTheDocument();
  });

  it("an OPEN panel switches to a table published while it shows another (values AND errors)", async () => {
    const legacy = peakTableFromFit(
      { peaks: [7, 9].map((c) => ({ center: c, fwhm: 0.8, height: 5, bg: 0.5, eta: null, area: 4, status: "fitted", model: "Gaussian" })),
        bgCoeffs: [0.5], R2: 0.9, rmse: 0.1, nPeaks: 2, model: "Gaussian" },
      { datasetId: "d1", datasetName: "x.dat", method: "simultaneous", bgDegree: 0, linkMode: "None",
        constrain: false, wavelengthA: null, fingerprint: peakDataFingerprint(DS) },
    );
    show({ ...DS, peakTable: legacy });
    const grid = await screen.findByRole("table", { name: "fitted peaks" });
    await waitFor(() => expect(within(grid).getAllByRole("cell")[1]).toHaveTextContent("7"));
    const published = peakTableFromModelFit(modelFitResponse(), DS, {
      xKey: null, recipe: null, baseline: "none", bgAtCenter: [0.5, 0.5], fingerprint: peakDataFingerprint(DS),
    }, legacy);
    act(() => publishPeakTable("d1", published)); // same peak count as the old table
    const fresh = await screen.findByRole("table", { name: "fitted peaks" });
    await waitFor(() => expect(within(fresh).getAllByRole("cell")[1]).toHaveTextContent("2.01 ± 0.004"));
    expect(within(fresh).getAllByRole("row")[2]).toHaveTextContent("4");
  });

  it("shows a newly published table's OWN values with its errors at once, even while the refresh is pending", async () => {
    const legacy = peakTableFromFit(
      { peaks: [7, 9].map((c) => ({ center: c, fwhm: 0.8, height: 5, bg: 0.5, eta: null, area: 4, status: "fitted", model: "Gaussian" })),
        bgCoeffs: [0.5], R2: 0.9, rmse: 0.1, nPeaks: 2, model: "Gaussian" },
      { datasetId: "d1", datasetName: "x.dat", method: "simultaneous", bgDegree: 0, linkMode: "None",
        constrain: false, wavelengthA: null, fingerprint: peakDataFingerprint(DS) },
    );
    show({ ...DS, peakTable: legacy });
    const grid = await screen.findByRole("table", { name: "fitted peaks" });
    await waitFor(() => expect(within(grid).getAllByRole("cell")[1]).toHaveTextContent("7"));
    // Hold the panel's refresh (it awaits resolveDataset) so the frame between
    // the store write and the refresh is observable.
    act(() => useApp.setState({ resolveDataset: () => new Promise<undefined>(() => {}) }));
    const published = peakTableFromModelFit(modelFitResponse(), DS, {
      xKey: null, recipe: null, baseline: "none", bgAtCenter: [0.5, 0.5], fingerprint: peakDataFingerprint(DS),
    }, legacy);
    act(() => publishPeakTable("d1", published));
    const now = screen.getByRole("table", { name: "fitted peaks" });
    // The cells read the durable table: the new value WITH its error, never
    // the old fit's 7 beside the new row's error.
    expect(within(now).getAllByRole("cell")[1]).toHaveTextContent("2.01 ± 0.004");
    expect(now).not.toHaveTextContent(/\b7\b/);
  });

  it("a hand edit of FWHM shows the NEW width (error cleared) at once — no stale copy while the refresh is pending", async () => {
    const table = peakTableFromModelFit(modelFitResponse(), DS, {
      xKey: null, recipe: null, baseline: "none", bgAtCenter: [0.5, 0.5], fingerprint: peakDataFingerprint(DS),
    }, null);
    show({ ...DS, peakTable: table });
    const grid = await screen.findByRole("table", { name: "fitted peaks" });
    await waitFor(() => expect(within(grid).getAllByRole("cell")[3]).toHaveTextContent("0.81 ± 0.01"));
    act(() => useApp.setState({ resolveDataset: () => new Promise<undefined>(() => {}) }));
    act(() => void editPeak("d1", table.peaks[0].id, { fwhm: 0.9 }));
    const fwhm = within(screen.getByRole("table", { name: "fitted peaks" })).getAllByRole("cell")[3];
    expect(fwhm).toHaveTextContent("0.9 ± —");
    expect(fwhm.querySelector("[data-no-error]")?.getAttribute("title")).toMatch(/edited by hand/);
  });

  it("asks BEFORE a Peaks-workshop re-fit would replace a model fit; 'no' fits nothing and keeps the table", async () => {
    vi.mocked(findPeaks).mockResolvedValue({
      peaks: [{ center: 2, height: 5, fwhm: 0.8, prominence: 1, localSNR: 10, area: null, bg: 0 }],
      background: [],
    });
    vi.mocked(fitMultiPeak).mockResolvedValue({
      peaks: [{ center: 2.02, fwhm: 0.8, height: 5, bg: 0, eta: null, area: 4, status: "fitted", model: "Gaussian" }],
      bgCoeffs: [0], R2: 0.9, rmse: 0.1, nPeaks: 1, model: "Gaussian",
    });
    const table = peakTableFromModelFit(modelFitResponse(), DS, {
      xKey: null, recipe: null, baseline: "none", bgAtCenter: [0.5, 0.5], fingerprint: peakDataFingerprint(DS),
    }, null);
    show({ ...DS, peakTable: table });
    const fitAll = await screen.findByRole("button", { name: "Fit all together" });
    await waitFor(() => expect(fitAll).toBeEnabled());

    vi.mocked(askConfirm).mockResolvedValueOnce(false);
    await act(async () => fireEvent.click(fitAll)); // flushes the declined confirm
    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(askConfirm).mock.calls[0][1])).toMatch(/Peak Analyzer model fit, with per-peak errors/);
    expect(fitMultiPeak).not.toHaveBeenCalled();
    expect(useApp.getState().datasets[0].peakTable).toBe(table);

    vi.mocked(askConfirm).mockResolvedValueOnce(true);
    fireEvent.click(fitAll);
    await waitFor(() => expect(useApp.getState().datasets[0].peakTable?.provenance.producer).toBeUndefined());
    expect(fitMultiPeak).toHaveBeenCalledTimes(1);
  });

  it("a Peaks re-fit of its OWN (legacy) table asks nothing — one click, as before", async () => {
    vi.mocked(findPeaks).mockResolvedValue({
      peaks: [{ center: 2, height: 5, fwhm: 0.8, prominence: 1, localSNR: 10, area: null, bg: 0 }],
      background: [],
    });
    vi.mocked(fitMultiPeak).mockResolvedValue({
      peaks: [{ center: 2.02, fwhm: 0.8, height: 5, bg: 0, eta: null, area: 4, status: "fitted", model: "Gaussian" }],
      bgCoeffs: [0], R2: 0.9, rmse: 0.1, nPeaks: 1, model: "Gaussian",
    });
    const legacy = peakTableFromFit(
      { peaks: [{ center: 2, fwhm: 0.8, height: 5, bg: 0.5, eta: null, area: 4, status: "fitted", model: "Gaussian" }],
        bgCoeffs: [0.5], R2: 0.9, rmse: 0.1, nPeaks: 1, model: "Gaussian" },
      { datasetId: "d1", datasetName: "x.dat", method: "simultaneous", bgDegree: 0, linkMode: "None",
        constrain: false, wavelengthA: null, fingerprint: peakDataFingerprint(DS) },
    );
    show({ ...DS, peakTable: legacy });
    const fitAll = await screen.findByRole("button", { name: "Fit all together" });
    await waitFor(() => expect(fitAll).toBeEnabled());
    fireEvent.click(fitAll);
    await waitFor(() => expect(useApp.getState().datasets[0].peakTable).not.toBe(legacy));
    expect(askConfirm).not.toHaveBeenCalled();
  });

  it("an unedited model fit with no R² says 'R² undefined', not 'cleared by manual changes'", async () => {
    const res = modelFitResponse({ metrics: { r_squared: null } });
    const table = peakTableFromModelFit(res, DS, {
      xKey: null, recipe: null, baseline: "none", bgAtCenter: [0.5, 0.5], fingerprint: peakDataFingerprint(DS),
    }, null);
    show({ ...DS, peakTable: table });
    await screen.findByRole("table", { name: "fitted peaks" });
    expect(screen.getByText(/R² undefined/)).toBeInTheDocument();
    expect(screen.queryByText(/cleared by manual changes/)).not.toBeInTheDocument();
  });

  it("keeps a legacy table's cells bare — no column of dashes for errors never measured", async () => {
    const legacy = peakTableFromFit(
      { peaks: [{ center: 2, fwhm: 0.8, height: 5, bg: 0.5, eta: null, area: 4, status: "fitted", model: "Gaussian" }],
        bgCoeffs: [0.5], R2: 0.9, rmse: 0.1, nPeaks: 1, model: "Gaussian" },
      { datasetId: "d1", datasetName: "x.dat", method: "simultaneous", bgDegree: 0, linkMode: "None",
        constrain: false, wavelengthA: null, fingerprint: peakDataFingerprint(DS) },
    );
    show({ ...DS, peakTable: legacy });
    const grid = await screen.findByRole("table", { name: "fitted peaks" });
    await waitFor(() => expect(within(grid).getAllByRole("row")).toHaveLength(2));
    expect(grid).not.toHaveTextContent("±");
    expect(screen.queryByText(/Peak Analyzer model fit/)).not.toBeInTheDocument();
  });

  it("→ Report sends each peak's errors (null = none reported) and the fit's objective", async () => {
    vi.mocked(reportEmit).mockResolvedValue({ report: { title: "t", sections: [] } } as never);
    const res = modelFitResponse({ metrics: { objective: "chi2", chi2: 9.5, reduced_chi2: 1.1 } });
    const table = peakTableFromModelFit(res, DS, {
      xKey: null, recipe: null, baseline: "none", bgAtCenter: [0.5, 0.5], fingerprint: peakDataFingerprint(DS),
    }, null);
    show({ ...DS, peakTable: table });
    const grid = await screen.findByRole("table", { name: "fitted peaks" });
    await waitFor(() => expect(within(grid).getAllByRole("cell")[1]).toHaveTextContent("2.01 ± 0.004"));
    fireEvent.click(screen.getByRole("button", { name: "→ Report" }));
    // Wait on STATE (the report landing in the store), not on the mock.
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));
    expect(reportEmit).toHaveBeenCalledTimes(1);
    const body = vi.mocked(reportEmit).mock.calls[0][0];
    expect(body.kind).toBe("multipeak_fit");
    const result = body.result as Record<string, unknown>;
    const peaks = result.peaks as Record<string, unknown>[];
    expect(peaks.map((p) => [p.centerErr, p.fwhmErr, p.heightErr, p.areaErr])).toEqual([
      [0.004, 0.01, 0.05, null],
      [null, 0.01, 0.04, 0.03],
    ]);
    expect(peaks.map((p) => [p.eta, p.etaErr])).toEqual([[1, null], [null, null]]);
    expect(result).toMatchObject({ objective: "chi2", ssr: 0.012, chi2: 9.5, R2: 0.998 });
  });

  it("→ Report reads the durable table even while the panel's copy is stale after a removal, and marks exclusions", async () => {
    vi.mocked(reportEmit).mockResolvedValue({ report: { title: "t", sections: [] } } as never);
    const table = peakTableFromModelFit(modelFitResponse(), DS, {
      xKey: null, recipe: null, baseline: "none", bgAtCenter: [0.5, 0.5], fingerprint: peakDataFingerprint(DS),
    }, null);
    show({ ...DS, peakTable: table });
    const grid = await screen.findByRole("table", { name: "fitted peaks" });
    await waitFor(() => expect(within(grid).getAllByRole("cell")[1]).toHaveTextContent("2.01 ± 0.004"));
    act(() => setPeakExcluded("d1", table.peaks[0].id, true));
    // Hold the panel's refresh so its local fit copy still has BOTH peaks
    // after the store drops one: the rows are then unpaired.
    act(() => useApp.setState({ resolveDataset: () => new Promise<undefined>(() => {}) }));
    act(() => void removePeaks("d1", new Set([table.peaks[1].id])));
    fireEvent.click(screen.getByRole("button", { name: "→ Report" }));
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));
    const result = vi.mocked(reportEmit).mock.calls[0][0].result as Record<string, unknown>;
    const peaks = result.peaks as Record<string, unknown>[];
    expect(peaks).toHaveLength(1);
    expect(peaks[0]).toMatchObject({ center: 2.01, centerErr: 0.004, excluded: true });
    expect(result.objective).toBe("ssr");
  });

  it("→ Report of a legacy table sends the fit result unchanged — no error fields, no objective", async () => {
    vi.mocked(reportEmit).mockResolvedValue({ report: { title: "t", sections: [] } } as never);
    const legacy = peakTableFromFit(
      { peaks: [{ center: 2, fwhm: 0.8, height: 5, bg: 0.5, eta: null, area: 4, status: "fitted", model: "Gaussian" }],
        bgCoeffs: [0.5], R2: 0.9, rmse: 0.1, nPeaks: 1, model: "Gaussian" },
      { datasetId: "d1", datasetName: "x.dat", method: "simultaneous", bgDegree: 0, linkMode: "None",
        constrain: false, wavelengthA: null, fingerprint: peakDataFingerprint(DS) },
    );
    show({ ...DS, peakTable: legacy });
    const grid = await screen.findByRole("table", { name: "fitted peaks" });
    await waitFor(() => expect(within(grid).getAllByRole("row")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "→ Report" }));
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));
    expect(vi.mocked(reportEmit).mock.calls[0][0].result).toEqual({
      peaks: [{ center: 2, fwhm: 0.8, height: 5, bg: 0.5, eta: null, area: 4, status: "fitted", model: "Gaussian" }],
      bgCoeffs: [0.5], R2: 0.9, rmse: 0.1, nPeaks: 1, model: "Gaussian",
    });
  });
});
