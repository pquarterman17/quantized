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
