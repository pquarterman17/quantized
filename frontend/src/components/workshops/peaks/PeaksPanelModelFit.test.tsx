// The Peaks workshop showing a Peak Analyzer MODEL-FIT table (audit P2.1
// per-peak uncertainties): value ± error, "± —" with the producer's reason
// for a missing one, the honest objective in the caption and the report, a
// table published while the panel is open (usePeakManualEdits' refresh), and
// a manual edit dropping the edited field's error.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reportEmit } from "../../../lib/api";
import { findPeaks } from "../../../lib/api/peaks";
import type { PeakTable } from "../../../lib/peakTable";
import { peakDataFingerprint } from "../../../lib/peakTableFit";
import type { DataStruct } from "../../../lib/types";
import { publishPeakTable } from "../../../store/peakTables";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import { askParams } from "../../overlays/ParamDialog";
import { modelFitResponse, modelFitTable } from "../peakwizard/modelFit.testkit";
import PeaksPanel from "./PeaksPanel";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn(), reportEmit: vi.fn() }));
vi.mock("../../../lib/api/peaks", () => ({ findPeaks: vi.fn(), fitMultiPeak: vi.fn(), fitPeak: vi.fn() }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[0.5], [1], [5.7], [1.2], [2.6], [0.6]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
};

function modelTable(res = modelFitResponse()): PeakTable {
  return modelFitTable(res, {
    datasetId: "d1", datasetName: "x.dat", wavelengthA: null, xLabel: "x", xUnit: "",
    fingerprint: peakDataFingerprint({ id: "d1", name: "x.dat", data: DATA }),
  });
}

const fittedRows = () => within(screen.getByRole("table", { name: "fitted peaks" })).getAllByRole("row").slice(1);

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useApp.setState({
    datasets: [{ id: "d1", name: "x.dat", data: DATA, peakTable: modelTable() }],
    activeId: "d1", xKey: null, yKeys: null, seriesOrder: null, peakOverlay: null,
    annotations: [], history: [], future: [], peaksOpen: true, reports: [],
  });
  vi.mocked(findPeaks).mockResolvedValue({ peaks: [], background: [] });
});

describe("PeaksPanel — a model-fit peak table", () => {
  it("shows each value with its standard error, and a reasoned dash where there is none", async () => {
    render(<PeaksPanel />);
    await screen.findByRole("table", { name: "fitted peaks" });
    const [r0, r1] = fittedRows();
    expect(r0).toHaveTextContent("± 0.004"); // p0 centre
    expect(r1).toHaveTextContent("± 0.03"); // p1 area
    // p1's centre was FIXED: a dash whose tooltip says so
    const dash = within(r1).getAllByText("± —")[0];
    expect(dash).toHaveAttribute("title", expect.stringMatching(/^fixed/));
    // p0's area: eta on a bound
    expect(within(r0).getByTitle(/η on a bound/)).toHaveTextContent("± —");
    // the shape rides on the "#" cell
    expect(within(r1).getByTitle("Gaussian")).toHaveTextContent("2");
    expect(screen.getByText(/model fit · SSR = 0\.012/)).toBeInTheDocument();
  });

  it("follows a table published while the panel is open", async () => {
    render(<PeaksPanel />);
    await screen.findByRole("table", { name: "fitted peaks" });
    expect(fittedRows()[0]).toHaveTextContent("2.01");
    const res = modelFitResponse();
    res.peaks[0] = { ...res.peaks[0], center: 2.2, center_stderr: 0.007 };
    act(() => publishPeakTable("d1", { ...modelTable(res), provenance: { ...modelTable(res).provenance, fittedAt: "2026-09-26T00:00:00.000Z" } }));
    await waitFor(() => expect(fittedRows()[0]).toHaveTextContent("± 0.007"));
    expect(fittedRows()[0]).toHaveTextContent("2.2");
  });

  it("→ Report sends each peak's errors and the objective, so the report says what the table shows", async () => {
    vi.mocked(reportEmit).mockResolvedValue({ report: { title: "t", sections: [] } } as never);
    render(<PeaksPanel />);
    await screen.findByRole("table", { name: "fitted peaks" });
    fireEvent.click(screen.getByRole("button", { name: "→ Report" }));
    // Wait on STATE (the report landing in the store), not on the mock.
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));
    expect(reportEmit).toHaveBeenCalledTimes(1);
    const body = vi.mocked(reportEmit).mock.calls[0][0] as { kind: string; result: Record<string, unknown> };
    expect(body.kind).toBe("multipeak_fit");
    const peaks = body.result.peaks as Record<string, unknown>[];
    expect(peaks.map((p) => [p.centerErr, p.areaErr])).toEqual([[0.004, null], [null, 0.03]]);
    expect(body.result.objective).toEqual({ kind: "ssr", value: 0.012, reduced: 0.012 });
  });

  it("a converged model fit with no R² does not claim its metrics were cleared by hand", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "x.dat", data: DATA, peakTable: modelTable(modelFitResponse({ metrics: { r_squared: null } })) }],
    });
    render(<PeaksPanel />);
    await screen.findByRole("table", { name: "fitted peaks" });
    expect(screen.getByText(/R² not available/)).toBeInTheDocument();
    expect(screen.queryByText(/cleared by manual changes/)).not.toBeInTheDocument();
  });

  it("a χ² (weighted) fit's R² is labelled weighted", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "x.dat", data: DATA, peakTable: modelTable(modelFitResponse({
        metrics: { objective: "chi2", chi2: 9.5, reduced_chi2: 1.1 },
      })) }],
    });
    render(<PeaksPanel />);
    await screen.findByRole("table", { name: "fitted peaks" });
    expect(screen.getByText(/weighted R² = 0\.998/)).toBeInTheDocument();
    expect(screen.getByText(/model fit · χ² = 9\.5/)).toBeInTheDocument();
  });

  it("a manual edit drops only the edited field's error", async () => {
    vi.mocked(askParams).mockResolvedValue({ center: 2.05, fwhm: 0.81, height: 5.2, area: 5.9 });
    render(<PeaksPanel />);
    await screen.findByRole("table", { name: "fitted peaks" });
    fireEvent.click(fittedRows()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Edit selected…" }));
    await waitFor(() => expect(useApp.getState().datasets[0].peakTable?.peaks[0].center).toBe(2.05));
    const p = useApp.getState().datasets[0].peakTable!.peaks[0];
    expect([p.centerErr, p.fwhmErr, p.heightErr]).toEqual([null, 0.01, 0.05]);
    await waitFor(() => expect(fittedRows()[0]).not.toHaveTextContent("± 0.004"));
    expect(within(fittedRows()[0]).getByTitle(/edited by hand/)).toHaveTextContent("± —");
    expect(fittedRows()[0]).toHaveTextContent("± 0.05");
  });
});
