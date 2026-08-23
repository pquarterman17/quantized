import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getElements } from "../../../lib/api/reference";
import type { ElementInfo } from "../../../lib/types";
import ElementsTab from "./ElementsTab";

vi.mock("../../../lib/api/reference", () => ({
  getElements: vi.fn(),
}));

const ELEMENTS: ElementInfo[] = [
  { Z: 1, symbol: "H", name: "Hydrogen", mass: 1.008, category: "nonmetal" },
  { Z: 8, symbol: "O", name: "Oxygen", mass: 15.999, category: "nonmetal" },
  {
    Z: 26,
    symbol: "Fe",
    name: "Iron",
    mass: 55.845,
    category: "transition metal",
    density: 7.874,
    atomicRadius: 156,
    ionizationEnergy: 7.9024,
    electronAffinity: 0.151,
    thermalConductivity: 80.4,
    xrayEdges: { K: 7112, L1: 844.6, L2: 719.9, L3: 706.8 },
  },
  {
    Z: 5,
    symbol: "B",
    name: "Boron",
    mass: 10.81,
    category: "metalloid",
    xrayEdges: { K: 188.0, L1: null, L2: null, L3: null },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getElements).mockResolvedValue({ elements: ELEMENTS });
});

describe("ElementsTab", () => {
  it("loads the element table on mount", async () => {
    render(<ElementsTab />);
    expect(await screen.findByText(/Hydrogen/)).toBeInTheDocument();
    expect(screen.getByText(/Iron/)).toBeInTheDocument();
  });

  it("filters by symbol/name and shows details on selection", async () => {
    render(<ElementsTab />);
    await screen.findByText(/Hydrogen/);

    fireEvent.change(screen.getByLabelText("element search"), { target: { value: "fe" } });
    expect(screen.getByText(/Iron/)).toBeInTheDocument();
    expect(screen.queryByText(/Hydrogen/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/Iron/));
    expect(screen.getByText("Atomic mass")).toBeInTheDocument();
    expect(screen.getByText(/transition metal/)).toBeInTheDocument();
  });

  it("reports no match for an unknown query", async () => {
    render(<ElementsTab />);
    await screen.findByText(/Hydrogen/);
    fireEvent.change(screen.getByLabelText("element search"), { target: { value: "zzz" } });
    expect(screen.getByText("no match")).toBeInTheDocument();
  });

  it("shows an offline notice when the table can't be fetched", async () => {
    vi.mocked(getElements).mockRejectedValue(new Error("offline"));
    render(<ElementsTab />);
    expect(await screen.findByText(/unavailable/)).toBeInTheDocument();
  });

  it("shows the new reference fields (atomic radius, ionization energy, electron affinity, thermal conductivity)", async () => {
    render(<ElementsTab />);
    await screen.findByText(/Hydrogen/);
    fireEvent.click(screen.getByText(/Iron/));

    expect(screen.getByText("Atomic radius")).toBeInTheDocument();
    expect(screen.getByText("156 pm")).toBeInTheDocument();
    expect(screen.getByText("Ionization energy")).toBeInTheDocument();
    expect(screen.getByText("7.9024 eV")).toBeInTheDocument();
    expect(screen.getByText("Electron affinity")).toBeInTheDocument();
    expect(screen.getByText("0.151 eV")).toBeInTheDocument();
    expect(screen.getByText("Thermal conductivity")).toBeInTheDocument();
    expect(screen.getByText("80.4 W/(m·K)")).toBeInTheDocument();
  });

  it("renders X-ray absorption edges as their own labelled row group in keV", async () => {
    render(<ElementsTab />);
    await screen.findByText(/Hydrogen/);
    fireEvent.click(screen.getByText(/Iron/));

    expect(screen.getByText("X-ray absorption edges")).toBeInTheDocument();
    expect(screen.getByText("K")).toBeInTheDocument();
    expect(screen.getByText("7.112 keV")).toBeInTheDocument();
    expect(screen.getByText("L1")).toBeInTheDocument();
    expect(screen.getByText("0.8446 keV")).toBeInTheDocument();
  });

  it("skips None edges instead of showing a blank/NaN row", async () => {
    render(<ElementsTab />);
    await screen.findByText(/Hydrogen/);
    fireEvent.click(screen.getByText(/Boron/));

    expect(screen.getByText("X-ray absorption edges")).toBeInTheDocument();
    expect(screen.getByText("K")).toBeInTheDocument();
    expect(screen.getByText("0.188 keV")).toBeInTheDocument();
    expect(screen.queryByText("L1")).not.toBeInTheDocument();
    expect(screen.queryByText("L2")).not.toBeInTheDocument();
    expect(screen.queryByText("L3")).not.toBeInTheDocument();
  });
});
