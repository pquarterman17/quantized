// XRD search/match hand-off (lane xrd-overlays): the indexer's peaks are ranked
// against every built-in phase; "Index" on a candidate picks that phase and
// indexes the same peaks. Fail closed on an unrecorded wavelength (confirm per
// λ value) and on a non-2θ axis; a changed input marks the ranking out of date.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { xrdIndex, xrdPhases, xrdSearch } from "../../../lib/api/reductions";
import type { DataStruct } from "../../../lib/types";
import type { XrdIndexResult, XrdSearchResult } from "../../../lib/xrdIndex";
import { useApp } from "../../../store/useApp";
import BuiltInPhaseIndexer from "./BuiltInPhaseIndexer";

vi.mock("../../../lib/api/reductions", () => ({ xrdPhases: vi.fn(), xrdIndex: vi.fn(), xrdSearch: vi.fn() }));

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

// Shape of calc/xrd_search.search_phases (values illustrative, not physics).
const SEARCH: XrdSearchResult = {
  wavelength: 1.5406, tolerance: 0.2, two_theta_min: 20, two_theta_max: 80,
  n_peaks: 2, n_peaks_outside: 0, skipped: [],
  candidates: [
    { name: "MgO", formula: "MgO", category: "substrate", system: "cubic", absences: "structure factor",
      n_matched: 2, n_reflections: 4, reflections_observed: 2, coverage: 0.0267, expected_by_chance: 0.0533,
      excess: 1.9467, mean_abs_delta: 0.02, labels: ["(200)", "(220)"] },
    { name: "Fe3O4 (magnetite)", formula: "Fe3O4", category: "oxide", system: "cubic", absences: "lattice",
      n_matched: 1, n_reflections: 20, reflections_observed: 1, coverage: 0.13, expected_by_chance: 0.26,
      excess: 0.74, mean_abs_delta: 0.1, labels: ["(400)"] },
  ],
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
  vi.mocked(xrdSearch).mockResolvedValue(SEARCH);
});

async function typedPeaks(text = "42.9, 62.3") {
  render(<BuiltInPhaseIndexer />);
  await screen.findByRole("option", { name: "MgO" });
  fireEvent.change(screen.getByLabelText("Peaks (2θ)"), { target: { value: text } });
}

describe("PhaseSearchPanel", () => {
  it("ranks the peaks against the built-in phases with the scan range and stated λ", async () => {
    await typedPeaks();
    fireEvent.click(screen.getByRole("button", { name: "Search phases" }));
    const table = await screen.findByRole("table", { name: "phase search" });
    const rows = within(table).getAllByRole("row").map((r) => r.textContent);
    expect(rows[1]).toBe("MgO2/20.052/40.0200Index");
    expect(rows[2]).toContain("Fe3O4 (magnetite) †");
    expect(screen.getByText(/only lattice-centering absences applied/)).toBeInTheDocument();
    expect(vi.mocked(xrdSearch).mock.calls[0][0]).toEqual({
      peaks: [42.9, 62.3], wavelength: 1.5406, tolerance: 0.2, two_theta_min: 20, two_theta_max: 80,
    });
  });

  it("'Index' hands the candidate to the indexer: picks it and indexes the same peaks", async () => {
    await typedPeaks();
    fireEvent.click(screen.getByRole("button", { name: "Search phases" }));
    fireEvent.click(await screen.findByRole("button", { name: "Index with MgO" }));
    await screen.findByTestId("xrd-index-summary");
    expect(screen.getByLabelText("Phase")).toHaveValue("MgO");
    expect(vi.mocked(xrdIndex).mock.calls[0][0]).toMatchObject({ phase: "MgO", peaks: [42.9, 62.3] });
    // The landed result is current for the picked phase: Label on plot is live.
    expect(screen.getByRole("button", { name: "Label on plot" })).toBeEnabled();
  });

  it("fails closed without a recorded wavelength until the user confirms that λ", async () => {
    setup(META);
    await typedPeaks();
    const search = screen.getByRole("button", { name: "Search phases" });
    expect(search).toBeDisabled();
    expect(screen.getByText(/records no wavelength/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /is right for this scan/ }));
    expect(search).toBeEnabled();
    // A different λ is a different claim: confirm again.
    fireEvent.change(screen.getByLabelText("Indexing wavelength (Å)"), { target: { value: "1.79" } });
    expect(screen.getByRole("button", { name: "Search phases" })).toBeDisabled();
  });

  it("refuses a non-2θ axis and an empty peak list", async () => {
    setup({ x_column_long: "Temperature", x_column_unit: "K", wavelength_a: 1.5406 });
    await typedPeaks("");
    expect(screen.getByRole("button", { name: "Search phases" })).toBeDisabled();
    expect(xrdSearch).not.toHaveBeenCalled();
  });

  it("marks the ranking out of date when the peaks change", async () => {
    await typedPeaks();
    fireEvent.click(screen.getByRole("button", { name: "Search phases" }));
    await screen.findByRole("table", { name: "phase search" });
    act(() => { fireEvent.change(screen.getByLabelText("Peaks (2θ)"), { target: { value: "42.9" } }); });
    expect(screen.queryByRole("table", { name: "phase search" })).toBeNull();
    expect(screen.getByText(/changed after this search/)).toBeInTheDocument();
  });
});
