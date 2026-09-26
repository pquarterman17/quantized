// The Peaks workshop showing a table the Peak Analyzer's model fit published
// (audit P2.1 uncertainties): each value reads "value ± error", a null error
// reads "± —" with its saved reason on hover, the header names the producer,
// and a legacy table (no errors measured) keeps rendering bare values.

import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findPeaks } from "../../../lib/api/peaks";
import { peakDataFingerprint, peakTableFromFit } from "../../../lib/peakTableFit";
import type { Dataset } from "../../../lib/types";
import { publishPeakTable } from "../../../store/peakTables";
import { useApp } from "../../../store/useApp";
import { modelFitResponse } from "../peakwizard/modelFit.testkit";
import { peakTableFromModelFit } from "../peakwizard/modelFitPeakTable";
import PeaksPanel from "./PeaksPanel";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn(), reportEmit: vi.fn() }));
vi.mock("../../../lib/api/peaks", () => ({ findPeaks: vi.fn(), fitMultiPeak: vi.fn(), fitPeak: vi.fn() }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const DS: Dataset = {
  id: "d1",
  name: "x.dat",
  data: { time: [0, 1, 2, 3, 4, 5], values: [[1], [2], [6], [2], [3], [1]], labels: ["I"], units: ["cps"], metadata: {} },
};

function show(ds: Dataset) {
  useApp.setState({
    datasets: [ds], activeId: "d1", xKey: null, yKeys: null, seriesOrder: null,
    peakOverlay: null, annotations: [], history: [], future: [], peaksOpen: true,
  });
  render(<PeaksPanel />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findPeaks).mockResolvedValue({ peaks: [], background: [] });
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
});
