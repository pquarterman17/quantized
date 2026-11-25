import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MaterialRecordWire } from "../../../lib/api/substrates";
import MaterialSources from "./MaterialSources";

const SRC = "MATLAB calc.substrates.getSubstrate table";
const NO_ELASTIC = {
  c11: null, c12: null, c13: null, c33: null, c44: null, c66: null,
  youngs_modulus: null, poisson_ratio: null,
};

const SI: MaterialRecordWire = {
  name: "Si(100)",
  formula: "Si",
  system: "cubic",
  lattice: { a: 5.431, b: 5.431, c: 5.431, alpha: 90, beta: 90, gamma: 90 },
  lattice_unit: { length: "Å", angle: "deg" },
  lattice_source: SRC,
  centering: "F",
  centering_source: "phaseDatabase Silicon",
  space_group: null,
  space_group_source: null,
  cte: { value: 2.6, unit: "1e-6/K", source: SRC },
  density: { value: 2.329, unit: "g/cm^3", source: SRC },
  dielectric_constant: { value: 11.7, unit: "", source: SRC },
  elastic: NO_ELASTIC,
};

describe("MaterialSources", () => {
  it("lists each field with its unit and source", () => {
    render(<MaterialSources record={SI} />);
    fireEvent.click(screen.getByText("Material record and sources"));
    expect(screen.getByText("2.6 1e-6/K")).toBeInTheDocument();
    expect(screen.getByText("phaseDatabase Silicon")).toBeInTheDocument();
    expect(screen.getAllByText(SRC).length).toBeGreaterThanOrEqual(4);
  });

  it("shows absent fields as not stored, never a default", () => {
    render(<MaterialSources record={SI} />);
    // space group + 8 elastic fields
    expect(screen.getAllByText("not stored")).toHaveLength(9);
  });

  it("shows a cited Poisson ratio with its source", () => {
    const rec = {
      ...SI,
      elastic: { ...NO_ELASTIC, poisson_ratio: { value: 0.28, unit: "", source: "ref X" } },
    };
    render(<MaterialSources record={rec} />);
    expect(screen.getByText("0.28")).toBeInTheDocument();
    expect(screen.getByText("ref X")).toBeInTheDocument();
  });
});
