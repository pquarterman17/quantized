// XRD search/match hand-off (lane xrd-overlays): the indexer's peaks are ranked
// against every built-in phase; "Index" on a candidate picks that phase and
// indexes the same peaks. Fail closed on an unrecorded wavelength (confirm per
// λ value) and on a non-2θ axis; a changed input marks the ranking out of date.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { xrdIndex, xrdMatch, xrdPhases } from "../../../lib/api/reductions";
import type { DataStruct } from "../../../lib/types";
import type { XrdIndexResult } from "../../../lib/xrdIndex";
import type { XrdMatchCandidate, XrdMatchResult } from "../../../lib/xrdMatch";
import { useApp } from "../../../store/useApp";
import BuiltInPhaseIndexer from "./BuiltInPhaseIndexer";

vi.mock("../../../lib/api/reductions", () => ({ xrdPhases: vi.fn(), xrdIndex: vi.fn(), xrdMatch: vi.fn() }));

const META = { x_column_long: "2Theta", x_column_unit: "deg" };
const scan = (metadata: Record<string, unknown>): DataStruct => ({
  time: [20, 40, 60, 80], values: [[1], [2], [3], [4]], labels: ["I"], units: ["cps"], metadata,
});

const MGO: XrdIndexResult = {
  phase: { name: "MgO", formula: "MgO", system: "cubic", centering: "F", a: 4.2112, c: 4.2112 },
  absences: "structure factor", wavelength: 1.5406, tolerance: 0.2,
  reflections: [{ hkl: [2, 0, 0], label: "(200)", d: 2.1056, two_theta: 42.92, multiplicity: 6 }],
  matches: [{ peak_two_theta: 42.9, d_obs: 2.1065, hkl: [2, 0, 0], label: "(200)", d_ref: 2.1056, two_theta_ref: 42.92, delta: -0.02 }],
  n_matched: 1,
};

// Shape of calc/phase_match.match_phases (values illustrative, not physics).
const cand = (name: string, over: Partial<XrdMatchCandidate>): XrdMatchCandidate => ({
  name, source: "builtin", formula: name, absences: "structure factor", intensity_basis: "none",
  wavelength_assumed: false, fom: 0.85, f_obs: 1, f_ref: 0.9, position_term: 0.95, intensity_term: null,
  n_matched: 2, n_peaks: 2, n_strong_lines: 4, n_strong_observed: 4, n_reference_lines: 4,
  expected_by_chance: 0.05, mean_abs_delta: 0.02, matches: [
    { peak_index: 0, two_theta: 42.9, ref_two_theta: 42.92, delta: -0.02, label: "(200)", obs_intensity: null, ref_intensity: null },
    { peak_index: 1, two_theta: 62.3, ref_two_theta: 62.3, delta: 0, label: "(220)", obs_intensity: null, ref_intensity: null },
  ], ...over,
});
const MGO_MATCH = cand("MgO", { step: 1 });
const SEARCH: XrdMatchResult = {
  wavelength: 1.5406, tolerance: 0.2, two_theta_min: 20, two_theta_max: 80, min_fom: 0.2,
  n_peaks: 2, n_peaks_outside: 0, n_candidates: 2, skipped: [], unexplained: [],
  ranked: [MGO_MATCH, cand("Fe3O4 (magnetite)", { absences: "lattice", fom: 0.31, n_matched: 1, n_strong_observed: 1, n_strong_lines: 20, mean_abs_delta: 0.1 })],
  phases: [MGO_MATCH],
};

function setup(metadata: Record<string, unknown> = { ...META, wavelength_a: 1.5406 }) {
  useApp.setState({
    datasets: [{ id: "d1", name: "film.xy", data: scan(metadata) }],
    activeId: "d1", xKey: null, refLines: [], history: [], future: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setup();
  vi.mocked(xrdPhases).mockResolvedValue({
    default_wavelength: 1.5406,
    phases: [
      { name: "Silicon", formula: "Si", category: "substrate", system: "cubic", a: 5.4309, c: 5.4309, absences: "structure factor" },
      { name: "MgO", formula: "MgO", category: "substrate", system: "cubic", a: 4.2112, c: 4.2112, absences: "structure factor" },
    ],
  });
  vi.mocked(xrdIndex).mockResolvedValue(MGO);
  vi.mocked(xrdMatch).mockResolvedValue(SEARCH);
});

async function typedPeaks(text = "42.9, 62.3") {
  render(<BuiltInPhaseIndexer />);
  await screen.findByRole("option", { name: "MgO" });
  fireEvent.change(screen.getByLabelText("Peaks (2θ)"), { target: { value: text } });
}

describe("PhaseSearchPanel", () => {
  it("ranks the peaks against the built-in phases with the scan range and stated λ", async () => {
    await typedPeaks();
    fireEvent.click(screen.getByRole("button", { name: "Match phases" }));
    const table = await screen.findByRole("table", { name: "phase match" });
    const rows = within(table).getAllByRole("row").map((r) => r.textContent);
    expect(rows[1]).toBe("MgO0.852/24/40.0200Index Show overlay");
    expect(rows[2]).toContain("Fe3O4 (magnetite) †");
    expect(screen.getByText(/only lattice-centering absences applied/)).toBeInTheDocument();
    expect(vi.mocked(xrdMatch).mock.calls[0][0]).toEqual({
      peaks: [42.9, 62.3], wavelength: 1.5406, tolerance: 0.2, two_theta_min: 20, two_theta_max: 80, patterns: [],
    });
    // Accepted phases (residual matching) and the unexplained peaks are reported.
    expect(screen.getByTestId("xrd-match-accepted")).toHaveTextContent("1. MgO (FOM 0.85): 42.900 (200), 62.300 (220)");
    expect(screen.getByTestId("xrd-match-unexplained")).toHaveTextContent("Every peak is explained.");
  });

  it("'Index' hands the candidate to the indexer: picks it and indexes the same peaks", async () => {
    await typedPeaks();
    fireEvent.click(screen.getByRole("button", { name: "Match phases" }));
    fireEvent.click(await screen.findByRole("button", { name: "Index with MgO" }));
    await screen.findByTestId("xrd-index-summary");
    expect(screen.getByLabelText("Phase")).toHaveValue("MgO");
    expect(vi.mocked(xrdIndex).mock.calls[0][0]).toMatchObject({ phase: "MgO", peaks: [42.9, 62.3] });
    // The landed result is current for the picked phase: Label on plot is live.
    expect(screen.getByRole("button", { name: "Label on plot" })).toBeEnabled();
  });

  it("'Show overlay' puts the candidate's reflections on the plot through the stick writer", async () => {
    await typedPeaks();
    fireEvent.click(screen.getByRole("button", { name: "Match phases" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show overlay of MgO" }));
    await vi.waitFor(() => expect(useApp.getState().refLines).toHaveLength(1));
    expect(useApp.getState().refLines[0]).toMatchObject({ axis: "x", value: 42.92, label: "(200)", groupLabel: "MgO (built-in) · λ 1.54060 Å" });
    expect(vi.mocked(xrdIndex).mock.calls[0][0]).toMatchObject({ phase: "MgO", peaks: [] });
  });

  it("sends the reference sticks on the plot as patterns (built-in overlays excluded)", async () => {
    await typedPeaks();
    const stick = { intensity: 80, baseline: 0, height: 0.2, color: "#000", visible: true, showLabel: false };
    act(() => { useApp.setState({ refLines: [
      { id: "r1", axis: "x", value: 42.9, label: "(200)", groupId: "g", groupLabel: "MgO file · λ 1.54060 Å", stick },
      { id: "r2", axis: "x", value: 30, label: "(1)", groupId: "h", groupLabel: "Si (built-in) · λ 1.54060 Å", stick },
    ] }); });
    fireEvent.click(screen.getByRole("button", { name: "Match phases" }));
    await screen.findByRole("table", { name: "phase match" });
    expect(vi.mocked(xrdMatch).mock.calls[0][0].patterns).toEqual([
      { name: "MgO file", wavelength: 1.5406, lines: [{ two_theta: 42.9, label: "(200)", intensity: 80 }] },
    ]);
  });

  it("fails closed without a recorded wavelength until the user confirms that λ", async () => {
    setup(META);
    await typedPeaks();
    const search = screen.getByRole("button", { name: "Match phases" });
    expect(search).toBeDisabled();
    // One shared confirmation (the indexer's) gates both Index peaks and the search.
    expect(screen.getByText(/not recorded in the file/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Index peaks" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /is right for this scan/ }));
    expect(search).toBeEnabled();
    // A different λ is a different claim: confirm again.
    fireEvent.change(screen.getByLabelText("Indexing wavelength (Å)"), { target: { value: "1.79" } });
    expect(screen.getByRole("button", { name: "Match phases" })).toBeDisabled();
  });

  it("refuses a non-2θ axis and an empty peak list", async () => {
    setup({ x_column_long: "Temperature", x_column_unit: "K", wavelength_a: 1.5406 });
    await typedPeaks("");
    expect(screen.getByRole("button", { name: "Match phases" })).toBeDisabled();
    expect(xrdMatch).not.toHaveBeenCalled();
  });

  it("refuses a one-point scan before calling the backend", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "one.xy", data: { ...scan({ ...META, wavelength_a: 1.5406 }), time: [40], values: [[1]] } }],
      activeId: "d1",
    });
    await typedPeaks("40");
    expect(screen.getByRole("button", { name: "Match phases" })).toBeDisabled();
    expect(screen.getByText("The scan covers no 2θ range to search.")).toBeInTheDocument();
    expect(xrdMatch).not.toHaveBeenCalled();
  });

  it("marks the ranking out of date when the peaks change", async () => {
    await typedPeaks();
    fireEvent.click(screen.getByRole("button", { name: "Match phases" }));
    await screen.findByRole("table", { name: "phase match" });
    act(() => { fireEvent.change(screen.getByLabelText("Peaks (2θ)"), { target: { value: "42.9" } }); });
    expect(screen.queryByRole("table", { name: "phase match" })).toBeNull();
    expect(screen.getByText(/changed after this search/)).toBeInTheDocument();
  });
});
