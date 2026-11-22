// Built-in phase indexer, out of date (lane WB7). Index peaks stays a button.
// A phase change still drops the result; new: a changed wavelength, tolerance
// or peak list marks it out of date and withholds Label on plot and the table,
// and an answer for inputs changed in flight lands marked.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { xrdIndex, xrdPhases } from "../../../lib/api/reductions";
import type { DataStruct } from "../../../lib/types";
import type { XrdIndexResult } from "../../../lib/xrdIndex";
import { useApp } from "../../../store/useApp";
import BuiltInPhaseIndexer from "./BuiltInPhaseIndexer";

vi.mock("../../../lib/api/reductions", () => ({ xrdPhases: vi.fn(), xrdIndex: vi.fn() }));

const SCAN: DataStruct = {
  time: [20, 40, 60, 80], values: [[1], [2], [3], [4]], labels: ["I"], units: ["cps"],
  metadata: { x_column_long: "2Theta", x_column_unit: "deg" },
};
const RESULT: XrdIndexResult = {
  phase: { name: "Silicon", formula: "Si", system: "cubic", centering: "F", a: 5.4309, c: 5.4309 },
  absences: "structure factor", wavelength: 1.5406, tolerance: 0.2,
  reflections: [{ hkl: [1, 1, 1], label: "(111)", d: 3.13553, two_theta: 28.4426, multiplicity: 8 }],
  matches: [{ peak_two_theta: 28.4, d_obs: 3.14013, hkl: [1, 1, 1], label: "(111)", d_ref: 3.13553, two_theta_ref: 28.4426, delta: -0.0426 }],
  n_matched: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [{ id: "d1", name: "si.xy", data: SCAN }], activeId: "d1", xKey: null, refLines: [], history: [], future: [] });
  vi.mocked(xrdPhases).mockResolvedValue({
    default_wavelength: 1.5406,
    phases: [{ name: "Silicon", formula: "Si", category: "substrate", system: "cubic", a: 5.4309, c: 5.4309, absences: "structure factor" }],
  });
  vi.mocked(xrdIndex).mockResolvedValue(RESULT);
});

async function indexed() {
  render(<BuiltInPhaseIndexer />);
  fireEvent.click(await screen.findByRole("button", { name: "Index peaks" }));
  await screen.findByTestId("xrd-index-summary");
}
const labelButton = () => screen.getByRole("button", { name: "Label on plot" });

describe("Built-in phase indexer out of date", () => {
  it("characterization: a fresh result is current and Label on plot works", async () => {
    await indexed();
    expect(labelButton()).toBeEnabled();
    expect(screen.queryByText(/Out of date/)).toBeNull();
  });

  it.each([
    ["wavelength", "Indexing wavelength (Å)", "1.78"],
    ["tolerance", "Indexing tolerance", "0.5"],
    ["peak list", "Peaks (2θ)", "47.3"],
  ])("a changed %s marks the result out of date and withholds Label on plot", async (_n, label, value) => {
    await indexed();
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(screen.getByText(/Out of date/)).toBeInTheDocument(); // fail-before: no marker
    expect(screen.queryByTestId("xrd-index-summary")).toBeNull();
    expect(labelButton()).toBeDisabled();
    fireEvent.click(labelButton());
    expect(useApp.getState().refLines).toHaveLength(0); // fail-before: labelled with the old reflections
  });

  it("restoring the input brings the result back; indexing again clears the mark", async () => {
    await indexed();
    const lambda = screen.getByLabelText("Indexing wavelength (Å)");
    fireEvent.change(lambda, { target: { value: "1.78" } });
    fireEvent.change(lambda, { target: { value: "1.5406" } });
    expect(screen.queryByText(/Out of date/)).toBeNull();
    fireEvent.change(lambda, { target: { value: "1.78" } });
    fireEvent.click(screen.getByRole("button", { name: "Index peaks" }));
    await screen.findByTestId("xrd-index-summary");
    expect(screen.queryByText(/Out of date/)).toBeNull();
    expect(vi.mocked(xrdIndex).mock.calls[1][0]).toMatchObject({ wavelength: 1.78 });
  });

  it("forced race: a wavelength changed while the request runs lands marked", async () => {
    let land!: (r: XrdIndexResult) => void;
    vi.mocked(xrdIndex).mockImplementationOnce(() => new Promise((r) => { land = r; }));
    render(<BuiltInPhaseIndexer />);
    fireEvent.click(await screen.findByRole("button", { name: "Index peaks" }));
    fireEvent.change(screen.getByLabelText("Indexing wavelength (Å)"), { target: { value: "1.78" } });
    await act(async () => { land(RESULT); await Promise.resolve(); });
    expect(await screen.findByText(/Out of date/)).toBeInTheDocument(); // fail-before: shown as current
    expect(labelButton()).toBeDisabled();
  });
});
