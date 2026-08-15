import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSubstrates,
  substrateMismatch,
  substratesCriticalThickness,
  type SubstrateInfo,
} from "../../../lib/api/substrates";
import SubstratesTab from "./SubstratesTab";

vi.mock("../../../lib/api/substrates", () => ({
  getSubstrates: vi.fn(),
  substrateMismatch: vi.fn(),
  substratesCriticalThickness: vi.fn(),
}));

const SUBS: SubstrateInfo[] = [
  {
    name: "Si(100)",
    formula: "Si",
    orientation: "(100)",
    a: 5.431,
    b: 5.431,
    c: 5.431,
    alpha: 90,
    beta: 90,
    gamma: 90,
    thermalExpansion: 2.6,
    dielectric: 11.7,
    density: 2.329,
    latticeType: "cubic",
  },
  {
    name: "SrTiO3(100)",
    formula: "SrTiO3",
    orientation: "(100)",
    a: 3.905,
    b: 3.905,
    c: 3.905,
    alpha: 90,
    beta: 90,
    gamma: 90,
    thermalExpansion: 11.0,
    dielectric: 300.0,
    density: 5.117,
    latticeType: "cubic",
  },
  {
    name: "SiO2/Si",
    formula: "SiO2",
    orientation: "amorphous",
    a: null,
    b: null,
    c: null,
    alpha: null,
    beta: null,
    gamma: null,
    thermalExpansion: 0.5,
    dielectric: 3.9,
    density: 2.2,
    latticeType: "amorphous",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSubstrates).mockResolvedValue({ substrates: SUBS });
  vi.mocked(substrateMismatch).mockResolvedValue({
    mismatch: -0.0074264,
    mismatchPct: -0.74264,
    description: "compressive",
  });
});

describe("SubstratesTab", () => {
  it("loads the substrate table on mount", async () => {
    render(<SubstratesTab />);
    expect(await screen.findByText("Si(100)")).toBeInTheDocument();
    expect(screen.getByText("SrTiO3(100)")).toBeInTheDocument();
  });

  it("filters by name/formula and shows details on selection", async () => {
    render(<SubstratesTab />);
    await screen.findByText("Si(100)");

    fireEvent.change(screen.getByLabelText("substrate search"), {
      target: { value: "srtio3" },
    });
    expect(screen.getByText("SrTiO3(100)")).toBeInTheDocument();
    expect(screen.queryByText("Si(100)")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("SrTiO3(100)"));
    expect(screen.getByText("Lattice type")).toBeInTheDocument();
    expect(screen.getByText("Density")).toBeInTheDocument();
  });

  it("computes lattice mismatch against the selected substrate", async () => {
    render(<SubstratesTab />);
    await screen.findByText("SrTiO3(100)");
    fireEvent.click(screen.getByText("SrTiO3(100)"));

    fireEvent.change(screen.getByLabelText("a_film"), { target: { value: "3.876" } });
    fireEvent.click(screen.getByText("Mismatch"));

    await waitFor(() => expect(screen.getByText(/compressive/)).toBeInTheDocument());
    expect(substrateMismatch).toHaveBeenCalledWith(3.876, 3.905);
  });

  it("hides the lattice + mismatch card for amorphous substrates", async () => {
    render(<SubstratesTab />);
    await screen.findByText("SiO2/Si");
    fireEvent.click(screen.getByText("SiO2/Si"));
    expect(screen.getByText("Lattice type")).toBeInTheDocument();
    expect(screen.queryByText("Mismatch")).not.toBeInTheDocument();
  });

  it("reports no match for an unknown query", async () => {
    render(<SubstratesTab />);
    await screen.findByText("Si(100)");
    fireEvent.change(screen.getByLabelText("substrate search"), { target: { value: "zzz" } });
    expect(screen.getByText("no match")).toBeInTheDocument();
  });

  it("shows an offline notice when the table can't be fetched", async () => {
    vi.mocked(getSubstrates).mockRejectedValue(new Error("offline"));
    render(<SubstratesTab />);
    expect(await screen.findByText(/unavailable/)).toBeInTheDocument();
  });

  it("computes the Matthews-Blakeslee critical thickness", async () => {
    vi.mocked(substratesCriticalThickness).mockResolvedValue({
      h_c: 26.6115,
      h_c_nm: 2.66115,
      mismatch: 0.01,
      b: 4.0,
      nu: 0.3,
    });
    render(<SubstratesTab />);
    await screen.findByText("SrTiO3(100)");
    fireEvent.click(screen.getByText("SrTiO3(100)"));

    fireEvent.click(screen.getByText("Calculate"));

    expect(await screen.findByText(/h_c = .* Å = .* nm/)).toBeInTheDocument();
    expect(substratesCriticalThickness).toHaveBeenCalledWith(0.01, 4.0, 0.3);
  });

  it("chains the last computed mismatch into the critical-thickness mismatch field", async () => {
    render(<SubstratesTab />);
    await screen.findByText("SrTiO3(100)");
    fireEvent.click(screen.getByText("SrTiO3(100)"));

    fireEvent.change(screen.getByLabelText("a_film"), { target: { value: "3.876" } });
    fireEvent.click(screen.getByText("Mismatch"));
    await waitFor(() => expect(screen.getByText(/compressive/)).toBeInTheDocument());

    expect(screen.getByLabelText("mismatch percent")).toHaveValue("-0.74264");
  });

  it("editing a_film invalidates the displayed mismatch (provenance contract)", async () => {
    render(<SubstratesTab />);
    await screen.findByText("SrTiO3(100)");
    fireEvent.click(screen.getByText("SrTiO3(100)"));

    fireEvent.click(screen.getByText("Mismatch"));
    await waitFor(() => expect(screen.getByText(/compressive/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("a_film"), { target: { value: "3.9" } });
    expect(screen.queryByText(/compressive/)).not.toBeInTheDocument();
  });

  it("editing an MB input invalidates the critical-thickness result; re-selecting a substrate invalidates the mismatch", async () => {
    vi.mocked(substratesCriticalThickness).mockResolvedValue({
      h_c: 26.6115,
      h_c_nm: 2.66115,
      mismatch: 0.01,
      b: 4.0,
      nu: 0.3,
    });
    render(<SubstratesTab />);
    await screen.findByText("SrTiO3(100)");
    fireEvent.click(screen.getByText("SrTiO3(100)"));

    fireEvent.click(screen.getByText("Calculate"));
    await screen.findByText(/h_c = .* Å = .* nm/);
    fireEvent.change(screen.getByLabelText("Poisson ratio"), { target: { value: "0.25" } });
    expect(screen.queryByText(/h_c = /)).not.toBeInTheDocument();

    // Selection change invalidates the mismatch card (a_sub changed).
    fireEvent.click(screen.getByText("Mismatch"));
    await waitFor(() => expect(screen.getByText(/compressive/)).toBeInTheDocument());
    fireEvent.click(screen.getByText("Si(100)"));
    expect(screen.queryByText(/compressive/)).not.toBeInTheDocument();
  });
});
