import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getConstants } from "../../../lib/api";
import type { ConstantEntry, ConstantSystem } from "../../../lib/types";
import ConstantsTab from "./ConstantsTab";

vi.mock("../../../lib/api", () => ({ getConstants: vi.fn() }));

const SYSTEMS: Record<ConstantSystem, ConstantEntry[]> = {
  SI: [
    { key: "h", name: "Planck constant", symbol: "h", value: 6.62607015e-34, unit: "J·s" },
    { key: "c", name: "Speed of light", symbol: "c", value: 2.99792458e8, unit: "m/s" },
  ],
  CGS: [
    { key: "h", name: "Planck constant", symbol: "h", value: 6.62607015e-27, unit: "erg·s" },
    { key: "c", name: "Speed of light", symbol: "c", value: 2.99792458e10, unit: "cm/s" },
  ],
  eV: [
    { key: "h", name: "Planck constant", symbol: "h", value: 4.135667696e-15, unit: "eV·s" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getConstants).mockResolvedValue({
    constants: { h: 6.62607015e-34, c: 2.99792458e8 },
    systems: SYSTEMS,
  });
});

describe("ConstantsTab", () => {
  it("loads SI constants on mount and shows the unit after each value", async () => {
    render(<ConstantsTab />);
    expect(await screen.findByText("Planck constant")).toBeInTheDocument();
    expect(screen.getByText(/J·s/)).toBeInTheDocument();
    expect(screen.getByText(/m\/s/)).toBeInTheDocument();
  });

  it("switches unit systems via the system selector", async () => {
    render(<ConstantsTab />);
    await screen.findByText(/J·s/);

    fireEvent.change(screen.getByLabelText("unit system"), { target: { value: "CGS" } });
    expect(await screen.findByText(/erg·s/)).toBeInTheDocument();
    expect(screen.getByText(/cm\/s/)).toBeInTheDocument();
    expect(screen.queryByText(/J·s/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("unit system"), { target: { value: "eV" } });
    expect(await screen.findByText(/eV·s/)).toBeInTheDocument();
    // The eV system in this fixture only carries "h" -- "c" drops out.
    expect(screen.queryByText("Speed of light")).not.toBeInTheDocument();
  });

  it("filters by symbol/name within the active system", async () => {
    render(<ConstantsTab />);
    await screen.findByText("Planck constant");

    fireEvent.change(screen.getByLabelText("constant search"), { target: { value: "light" } });
    expect(screen.getByText("Speed of light")).toBeInTheDocument();
    expect(screen.queryByText("Planck constant")).not.toBeInTheDocument();
  });

  it("reports no match for an unknown query", async () => {
    render(<ConstantsTab />);
    await screen.findByText("Planck constant");
    fireEvent.change(screen.getByLabelText("constant search"), { target: { value: "zzz" } });
    expect(screen.getByText("no match")).toBeInTheDocument();
  });

  it("shows an offline notice when constants can't be fetched", async () => {
    vi.mocked(getConstants).mockRejectedValue(new Error("offline"));
    render(<ConstantsTab />);
    expect(await screen.findByText(/unavailable/)).toBeInTheDocument();
  });
});
