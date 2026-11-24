// UX9-F: XRD reference pattern ▸ built-in phase — picker, λ, the indexing
// table (peak 2θ, hkl, d, Δ2θ) and "Label on plot" (labelled reference sticks).

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { xrdIndex, xrdPhases } from "../../../lib/api/reductions";
import type { DataStruct } from "../../../lib/types";
import type { XrdIndexResult } from "../../../lib/xrdIndex";
import { useApp } from "../../../store/useApp";
import BuiltInPhaseIndexer from "./BuiltInPhaseIndexer";

vi.mock("../../../lib/api/reductions", () => ({ xrdPhases: vi.fn(), xrdIndex: vi.fn() }));

const SCAN: DataStruct = {
  time: [20, 40, 60, 80],
  values: [[1], [2], [3], [4]],
  labels: ["I"],
  units: ["cps"],
  metadata: { x_column_long: "2Theta", x_column_unit: "deg", wavelength_a: 1.5406 },
};

// What calc/xrd_index.index_peaks returns for these peaks (hand-checked in
// tests/test_calc_xrd_index.py): Si (111) 28.4421°, (220) 47.3023°.
const RESULT: XrdIndexResult = {
  phase: { name: "Silicon", formula: "Si", system: "cubic", centering: "F", a: 5.4309, c: 5.4309 },
  absences: "structure factor",
  wavelength: 1.5406,
  tolerance: 0.2,
  reflections: [
    { hkl: [1, 1, 1], label: "(111)", d: 3.13553, two_theta: 28.4426, multiplicity: 8 },
    { hkl: [2, 2, 0], label: "(220)", d: 1.92012, two_theta: 47.3032, multiplicity: 12 },
  ],
  matches: [
    { peak_two_theta: 28.4, d_obs: 3.14013, hkl: [1, 1, 1], label: "(111)", d_ref: 3.13553, two_theta_ref: 28.4426, delta: -0.0426 },
    { peak_two_theta: 32.9, d_obs: 2.7202, hkl: null, label: null, d_ref: null, two_theta_ref: null, delta: null },
  ],
  n_matched: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "si.xy", data: SCAN }],
    activeId: "d1", xKey: null, refLines: [], history: [], future: [],
  });
  vi.mocked(xrdPhases).mockResolvedValue({
    default_wavelength: 1.5406,
    phases: [
      { name: "Silicon", formula: "Si", category: "substrate", system: "cubic", a: 5.4309, c: 5.4309, absences: "structure factor" },
      { name: "Fe3O4 (magnetite)", formula: "Fe3O4", category: "oxide", system: "cubic", a: 8.3941, c: 8.3941, absences: "lattice" },
    ],
  });
  vi.mocked(xrdIndex).mockResolvedValue(RESULT);
});

describe("BuiltInPhaseIndexer", () => {
  it("indexes typed peaks and shows 2θ, hkl, d and Δ2θ", async () => {
    render(<BuiltInPhaseIndexer />);
    await screen.findByRole("option", { name: "Fe3O4 (magnetite)" });
    expect(screen.getByLabelText("Indexing wavelength (Å)")).toHaveValue("1.5406");
    fireEvent.change(screen.getByLabelText("Peaks (2θ)"), { target: { value: "28.4, 32.9" } });
    fireEvent.click(screen.getByRole("button", { name: "Index peaks" }));

    const table = await screen.findByRole("table", { name: "peak indexing" });
    const rows = within(table).getAllByRole("row").map((r) => r.textContent);
    expect(rows[0]).toBe("Peak 2θhkld (Å)Δ2θ");
    expect(rows[1]).toBe("28.4000(111)3.14013-0.0426");
    expect(rows[2]).toContain("unindexed");
    expect(screen.getByTestId("xrd-index-summary").textContent).toContain("1 of 2 peaks indexed");
    expect(vi.mocked(xrdIndex).mock.calls[0][0]).toMatchObject({
      phase: "Silicon", peaks: [28.4, 32.9], wavelength: 1.5406, two_theta_min: 20, two_theta_max: 80,
    });
  });

  it("'Label on plot' adds one labelled stick per reflection, as one undo step", async () => {
    render(<BuiltInPhaseIndexer />);
    fireEvent.click(await screen.findByRole("button", { name: "Index peaks" }));
    await screen.findByTestId("xrd-index-summary");
    fireEvent.click(screen.getByRole("button", { name: "Label on plot" }));

    const lines = useApp.getState().refLines;
    expect(lines.map((l) => [l.value, l.label, l.stick?.showLabel])).toEqual([
      [28.4426, "(111)", true],
      [47.3032, "(220)", true],
    ]);
    expect(lines[0].groupLabel).toBe("Silicon (built-in) · λ 1.54060 Å");
    expect(useApp.getState().history).toHaveLength(1);
  });

  it("rejects a bad peak token before calling the backend", async () => {
    render(<BuiltInPhaseIndexer />);
    fireEvent.change(screen.getByLabelText("Peaks (2θ)"), { target: { value: "28.4, abc" } });
    expect(await screen.findByText(/"abc" is not a 2θ position/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Index peaks" })).toBeDisabled();
  });

  describe("a file with no recorded wavelength (owner decision 2026-11-24)", () => {
    beforeEach(() => {
      useApp.setState({ datasets: [{ id: "d1", name: "si.xy", data: { ...SCAN, metadata: { x_column_long: "2Theta", x_column_unit: "deg" } } }] });
    });

    it("prefills Cu Kα1 but withholds indexing until λ is confirmed", async () => {
      render(<BuiltInPhaseIndexer />);
      await screen.findByRole("option", { name: "Fe3O4 (magnetite)" });
      expect(screen.getByLabelText("Indexing wavelength (Å)")).toHaveValue("1.5406");
      fireEvent.change(screen.getByLabelText("Peaks (2θ)"), { target: { value: "28.4" } });
      expect(screen.getByRole("button", { name: "Index peaks" })).toBeDisabled();
      fireEvent.click(screen.getByRole("checkbox", { name: /λ = 1\.5406 Å is right/ }));
      fireEvent.click(screen.getByRole("button", { name: "Index peaks" }));
      await screen.findByTestId("xrd-index-summary");
      expect(vi.mocked(xrdIndex).mock.calls[0][0]).toMatchObject({ wavelength: 1.5406 });
    });

    it("editing λ asks again", async () => {
      render(<BuiltInPhaseIndexer />);
      fireEvent.change(screen.getByLabelText("Peaks (2θ)"), { target: { value: "28.4" } });
      fireEvent.click(screen.getByRole("checkbox", { name: /λ = 1\.5406 Å is right/ }));
      expect(screen.getByRole("button", { name: "Index peaks" })).toBeEnabled();
      fireEvent.change(screen.getByLabelText("Indexing wavelength (Å)"), { target: { value: "0.7093" } });
      expect(screen.getByRole("button", { name: "Index peaks" })).toBeDisabled();
      expect(screen.getByRole("checkbox", { name: /λ = 0\.7093 Å is right/ })).not.toBeChecked();
    });
  });
});
