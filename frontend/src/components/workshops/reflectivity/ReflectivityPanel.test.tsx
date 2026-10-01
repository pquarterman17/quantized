import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { spinAsymmetry } from "../../../lib/api/reductions";
import { reflPresets } from "../../../lib/api/reflectivity";
import type { SldPreset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import ReflectivityPanel from "./ReflectivityPanel";

vi.mock("uplot", async () => ({ default: (await import("./reflFit.testkit")).UPlotStub }));
vi.mock("../../../lib/api/reflectivity", () => ({
  reflPresets: vi.fn(),
  reflSimulate: vi.fn(),
  reflSldProfile: vi.fn(),
  reflFit: vi.fn(),
}));

vi.mock("../../../lib/api/reductions", () => ({ spinAsymmetry: vi.fn() }));

const PRESETS: SldPreset[] = [
  { name: "Air / Vacuum", formula: "", sldX: 0, sldN: 0, sldImag: 0, density: 0 },
  { name: "Nickel", formula: "Ni", sldX: 7.18e-5, sldN: 9.4e-6, sldImag: 5e-7, density: 8.9 },
  { name: "Silicon", formula: "Si", sldX: 2.007e-5, sldN: 2.073e-6, sldImag: 0, density: 2.33 },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reflPresets).mockResolvedValue({ presets: PRESETS });
  useApp.setState({ datasets: [], activeId: null, status: "", reflectivitySeed: null });
});

describe("ReflectivityPanel", () => {
  it("switches Model ⇄ Fit over one shared layer model", async () => {
    render(<ReflectivityPanel />);
    await waitFor(() => expect(screen.getAllByRole("option", { name: "Nickel" }).length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: "Simulate R(Q)" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Fit" }));
    expect(screen.queryByRole("button", { name: "Simulate R(Q)" })).toBeNull();
    expect(screen.getByRole("button", { name: "Run fit" })).toBeDisabled(); // no dataset yet
    // the parameter table is generated from the same stack the Model mode edits
    const thickness = screen.getByRole("textbox", { name: "L1.thickness value" }) as HTMLInputElement;
    expect(thickness.value).toBe("200");
    fireEvent.change(thickness, { target: { value: "150" } });

    fireEvent.click(screen.getByRole("tab", { name: "Model" }));
    // the layer table's film thickness field now reads the edited value
    expect(screen.getAllByRole("textbox").some((el) => (el as HTMLInputElement).value === "150")).toBe(true);
  });
});

describe("ReflectivityPanel — graded layers", () => {
  async function openFit(): Promise<void> {
    useApp.setState({
      datasets: [{
        id: "xrr", name: "xrr.dat",
        data: { time: [0.01, 0.02, 0.03], values: [[1], [0.5], [0.1]], labels: ["R"], units: [""], metadata: {} },
      }],
      activeId: "xrr",
    });
    render(<ReflectivityPanel />);
    await waitFor(() => expect(screen.getAllByRole("option", { name: "Nickel" }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("tab", { name: "Fit" }));
    expect(screen.getByRole("button", { name: "Run fit" })).toBeEnabled();
  }

  it("fits a graded layer's knots with the slab parameters' controls", async () => {
    await openFit();
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "graded" } });
    expect(screen.getByRole("button", { name: "Run fit" })).toBeEnabled();
    expect(screen.queryByRole("note")).toBeNull();
    // The knots replace the slab SLD rows, each with value, fit, min and max.
    expect(screen.queryByRole("textbox", { name: "L1.sld value" })).toBeNull();
    for (const k of ["L1.knot0.sld", "L1.knot1.sld"]) {
      expect(screen.getByRole("textbox", { name: `${k} value` })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: `vary ${k}` })).not.toBeChecked();
      expect(screen.getByRole("textbox", { name: `${k} min` })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole("checkbox", { name: "vary L1.knot1.sld" }));
    expect(screen.getByRole("textbox", { name: "L1.knot1.sld max" })).toBeEnabled();
    // A knot edited in the table is the model's knot: the open layer editor reads it.
    const editor = await screen.findByRole("textbox", { name: "Layer 1 SLD knots" });
    expect(editor).toHaveValue("71.8, 71.8");
    fireEvent.change(screen.getByRole("textbox", { name: "L1.knot1.sld value" }), { target: { value: "8e-5" } });
    expect(editor).toHaveValue("71.8, 80");
  });

  it("still refuses a graded layer it cannot slice, and says why", async () => {
    await openFit();
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "graded" } });
    fireEvent.change(screen.getByRole("textbox", { name: "L1.thickness value" }), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Run fit" })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("Graded layer 1 needs a thickness above 0 Å to fit.");
  });

  it("offers isld knot rows once the layer's absorption is on", async () => {
    await openFit();
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "graded" } });
    expect(screen.queryByRole("textbox", { name: "L1.knot0.isld value" })).toBeNull();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Layer 1 absorption" }));
    for (const k of ["L1.knot0.isld", "L1.knot1.isld"]) {
      expect(screen.getByRole("textbox", { name: `${k} value` })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: `vary ${k}` })).not.toBeChecked();
    }
    // A value typed in the table is the model's absorption knot.
    fireEvent.change(screen.getByRole("textbox", { name: "L1.knot1.isld value" }), { target: { value: "2e-8" } });
    expect(screen.getByRole("textbox", { name: "Layer 1 absorption knots" })).toHaveValue("0, 0.02");
  });

  it("refuses positions the backend would refuse, with the same one-line reason", async () => {
    await openFit();
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "graded" } });
    fireEvent.change(await screen.findByRole("textbox", { name: "Layer 1 knot positions" }), { target: { value: "0.6, 0.3" } });
    expect(screen.getByRole("button", { name: "Run fit" })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("Layer 1's knot positions must be strictly increasing.");
  });
});

describe("ReflectivityPanel — Spin asym.", () => {
  const channel = (id: string, r: number[]) => ({
    id, name: `${id}.dat`,
    data: {
      time: [0.01, 0.02, 0.03], values: r.map((v) => [v, 0.01]), labels: ["R", "dR"], units: ["", ""],
      metadata: { x_column_name: "Q", x_column_unit: "1/Å" },
    },
  });

  it("pairs R++ with R-- on one Q grid and adds SA(Q) with dSA to the library", async () => {
    useApp.setState({ datasets: [channel("up", [0.9, 0.5, 0.1]), channel("down", [0.7, 0.5, 0.3])], activeId: "up" });
    vi.mocked(spinAsymmetry).mockResolvedValue({ asymmetry: [0.125, 0, -0.5], d_asymmetry: [0.01, 0.01, 0.02], n_valid: 3 });
    render(<ReflectivityPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Spin asym." }));

    expect(await screen.findByLabelText("R++ dataset")).toHaveValue("up");
    expect(screen.getByLabelText("R−− dataset")).toHaveValue("down");
    expect(screen.getByLabelText("R++ error")).toHaveValue("1"); // dR bound to R
    expect(screen.queryByRole("button", { name: "Simulate R(Q)" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Spin asymmetry → Library" }));
    await screen.findByText(/3 of 3 Q points valid/);
    expect(spinAsymmetry).toHaveBeenCalledWith({
      r_pp: [0.9, 0.5, 0.1], r_mm: [0.7, 0.5, 0.3], dr_pp: [0.01, 0.01, 0.01], dr_mm: [0.01, 0.01, 0.01],
    });
    const sa = useApp.getState().datasets[2];
    expect(sa.data.labels).toEqual(["SA", "dSA"]);
    expect(sa.data.values[2]).toEqual([-0.5, 0.02]);
    expect(sa.errorRoles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  });

  it("refuses two channels on different Q grids", async () => {
    const other = channel("down", [1, 1, 1]);
    other.data.time = [0.01, 0.025, 0.03];
    useApp.setState({ datasets: [channel("up", [1, 1, 1]), other], activeId: "up" });
    render(<ReflectivityPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Spin asym." }));
    fireEvent.click(await screen.findByRole("button", { name: "Spin asymmetry → Library" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("different Q grids");
    expect(spinAsymmetry).not.toHaveBeenCalled();
  });
});
