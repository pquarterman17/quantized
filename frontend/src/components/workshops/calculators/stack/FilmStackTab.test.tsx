// Film stack tab (plan G4): builds the request from the layer rows, shows the
// per-layer strain table, adds layers from reference phases, reorders and
// removes layers, and clears a stale result on any edit.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { evaluateStack, type StackResult } from "../../../../lib/api/filmStack";
import { getPhases } from "../../../../lib/api/reference";
import { resetPhaseCacheForTests } from "../../structures/PhasePresetPicker";
import FilmStackTab from "./FilmStackTab";

vi.mock("../../../../lib/api/filmStack", () => ({ evaluateStack: vi.fn() }));
vi.mock("../../../../lib/api/reference", () => ({ getPhases: vi.fn() }));

const RESULT: StackResult = {
  layers: [
    {
      name: "LSMO", template_a: 3.905, mismatch_pct: -0.7426, h_c_nm: 50.4, h_c_kind: "finite",
      thickness_nm: 20, state: "coherent", in_plane_a: 3.905, eps_parallel: 0.00748, eps_perp: -0.00737,
      c_relaxed: 3.876, c_strained: 3.8474, two_theta_00l: [23.099, 47.209, null, null],
      eps_thermal: -0.000337, eps_parallel_total: 0.00714,
    },
  ],
  warnings: ["BTO: 100 nm exceeds h_c (13.6 nm); treated as fully relaxed"],
};

beforeEach(() => {
  vi.clearAllMocks();
  resetPhaseCacheForTests();
  vi.mocked(getPhases).mockResolvedValue({
    phases: [{
      name: "BaTiO3", formula: "BaTiO3", a: 3.9945, b: 3.9945, c: 4.0335, alpha: 90, beta: 90, gamma: 90,
      centering: "P", system: "tetragonal", category: "perovskite", icsd: 0, basis: [],
    }],
  });
});

describe("FilmStackTab", () => {
  it("sends the default LSMO-on-STO stack and shows the strain table", async () => {
    vi.mocked(evaluateStack).mockResolvedValue(RESULT);
    render(<FilmStackTab />);
    fireEvent.click(screen.getByText("Evaluate stack"));

    expect(await screen.findByText("1 layers: 1 coherent, 0 relaxed")).toBeInTheDocument();
    expect(evaluateStack).toHaveBeenCalledWith({
      substrate: { a: 3.905, cte: 11 },
      layers: [{ name: "LSMO", a: 3.876, thickness: 20, nu: 0.33, cte: 11.5 }],
      growth_temperature: 973,
      room_temperature: 300,
      wavelength: 1.5406,
      max_order: 4,
    });
    const table = screen.getByRole("table", { name: "stack results" });
    expect(table.textContent).toContain("coherent");
    expect(table.textContent).toContain("+0.748 %");
    expect(table.textContent).toContain("23.099, 47.209, –, –");
    expect(screen.getByRole("note")).toHaveTextContent(/BTO: 100 nm exceeds h_c/);
  });

  it("adds a layer from a phase (with its c), reorders and removes layers", async () => {
    render(<FilmStackTab />);
    await screen.findByRole("option", { name: /BaTiO3/ });
    fireEvent.change(screen.getByLabelText("add layer from phase"), { target: { value: "BaTiO3" } });
    expect(screen.getByLabelText("layer 2 name")).toHaveValue("BaTiO3");
    expect(screen.getByLabelText("layer 2 c")).toHaveValue("4.0335");

    fireEvent.click(screen.getByLabelText("move layer 2 down"));
    expect(screen.getByLabelText("layer 1 name")).toHaveValue("BaTiO3");
    fireEvent.click(screen.getByLabelText("remove layer 1"));
    expect(screen.getByLabelText("layer 1 name")).toHaveValue("LSMO");
    expect(screen.queryByLabelText("layer 2 name")).not.toBeInTheDocument();
  });

  it("names a bad field and never calls the API", async () => {
    render(<FilmStackTab />);
    fireEvent.change(screen.getByLabelText("layer 1 a"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Evaluate stack"));
    expect(await screen.findByText(/LSMO a: enter a number/)).toBeInTheDocument();
    expect(evaluateStack).not.toHaveBeenCalled();
  });

  it("clears the result when any input changes", async () => {
    vi.mocked(evaluateStack).mockResolvedValue(RESULT);
    render(<FilmStackTab />);
    fireEvent.click(screen.getByText("Evaluate stack"));
    await screen.findByRole("table", { name: "stack results" });
    fireEvent.change(screen.getByLabelText("layer 1 thickness"), { target: { value: "60" } });
    expect(screen.queryByRole("table", { name: "stack results" })).not.toBeInTheDocument();
  });
});
