// Crystal tab's hexagonal Miller-Bravais UI: a 3-index/4-index toggle for the
// (hkl) plane input, a derived (non-editable) i = -(h+k) field that tracks
// h/k live, and a both-notations echo in the result. Non-hexagonal systems
// are unaffected (calc.crystallography.hkl_to_hkil / hkil_to_hkl).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getConstants } from "../../../lib/api/reference";
import { crystalDSpacing } from "../../../lib/api";
import { crystalInterplanarAngle } from "../../../lib/api/crystallography";
import CalculatorsContent from "./CalculatorsContent";

vi.mock("../../../lib/api", () => ({
  crystalDSpacing: vi.fn(),
  crystalCell: vi.fn(),
}));
vi.mock("../../../lib/api/reference", () => ({
  getConstants: vi.fn(),
  // Rendered through CalculatorsContent, so useUnitsCalc's effect also fires;
  // this sibling export now shares a file with getConstants (R8 merge) so a
  // partial mock must cover it too, or the call throws instead of the
  // original real-fetch-rejects-and-is-caught behavior.
  getUnitCategories: vi.fn().mockRejectedValue(new Error("offline")),
}));

vi.mock("../../../lib/api/crystallography", () => ({
  crystalInterplanarAngle: vi.fn(),
}));

function openCrystalTab(): void {
  render(<CalculatorsContent />);
  fireEvent.change(screen.getByLabelText("calculator"), { target: { value: "crystal" } });
}

function setHexagonal(): void {
  fireEvent.change(screen.getByLabelText("crystal system"), { target: { value: "hexagonal" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getConstants).mockResolvedValue({ constants: {}, systems: { SI: [], CGS: [], eV: [] } });
});

describe("CrystalTab — hexagonal Miller-Bravais", () => {
  it("hides the 3/4-index toggle and derived-i field for non-hexagonal systems", () => {
    openCrystalTab();
    expect(screen.queryByText("4-idx")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("i (derived)")).not.toBeInTheDocument();
    expect(screen.getByText("hkl")).toBeInTheDocument();
  });

  it("shows the toggle for hexagonal but stays 3-index (i hidden) until switched", () => {
    openCrystalTab();
    setHexagonal();
    expect(screen.getByText("4-idx")).toBeInTheDocument();
    expect(screen.getByText("3-idx")).toBeInTheDocument();
    expect(screen.getByText("hkl")).toBeInTheDocument();
    expect(screen.queryByLabelText("i (derived)")).not.toBeInTheDocument();
  });

  it("switching to 4-index reveals the derived, disabled i field", () => {
    openCrystalTab();
    setHexagonal();
    fireEvent.click(screen.getByText("4-idx"));
    expect(screen.getByText("hkil")).toBeInTheDocument();
    const iField = screen.getByLabelText("i (derived)") as HTMLInputElement;
    expect(iField).toBeDisabled();
    // default h=1, k=1 (unchanged by the system switch) -> i = -(1+1) = -2.
    expect(iField.value).toBe("-2");
  });

  it("derived i updates live as h, k change (never independently editable)", () => {
    openCrystalTab();
    setHexagonal();
    fireEvent.click(screen.getByText("4-idx"));
    fireEvent.change(screen.getByLabelText("h"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("k"), { target: { value: "0" } });
    const iField = screen.getByLabelText("i (derived)") as HTMLInputElement;
    expect(iField.value).toBe("-1");
    expect(iField).toBeDisabled();
  });

  it("echoes both (hkl) and (hkil) notations after computing d, and sends i to the API", async () => {
    vi.mocked(crystalDSpacing).mockResolvedValue({ d: 2.7794, system: "hexagonal" });
    openCrystalTab();
    setHexagonal();
    fireEvent.change(screen.getByLabelText("h"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("k"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("l"), { target: { value: "0" } });
    fireEvent.click(screen.getAllByText("=")[0]); // d-spacing "=" (cell-volume block has its own)

    expect(await screen.findByText("(hkl) 1 0 0 = (hkil) 1 0 -1 0")).toBeInTheDocument();
    expect(crystalDSpacing).toHaveBeenCalledWith(
      expect.objectContaining({ system: "hexagonal", h: 1, k: 0, l: 0, i: -1 }),
    );
  });

  it("does not echo a second notation for non-hexagonal systems", async () => {
    vi.mocked(crystalDSpacing).mockResolvedValue({ d: 3.1356, system: "cubic" });
    openCrystalTab(); // default system is cubic
    fireEvent.click(screen.getAllByText("=")[0]);
    await screen.findByRole("button", { name: "→ X-ray" }); // renders once crResult is set
    expect(screen.queryByText(/\(hkil\)/)).not.toBeInTheDocument();
    expect(crystalDSpacing).toHaveBeenCalledWith(expect.not.objectContaining({ i: expect.anything() }));
  });
});

describe("CrystalTab — interplanar angle", () => {
  it("computes the angle between two planes for the default cubic cell", async () => {
    vi.mocked(crystalInterplanarAngle).mockResolvedValue({
      angle_deg: 45.0,
      d1: 3.8387,
      d2: 2.7154,
      system: "cubic",
    });
    openCrystalTab();
    fireEvent.change(screen.getByLabelText("h2"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("k2"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("l2"), { target: { value: "0" } });
    // The angle card's "=" is the 3rd on the page (d-spacing, cell volume, angle).
    fireEvent.click(screen.getAllByText("=")[2]);

    expect(await screen.findByText(/φ = 45.*°/)).toBeInTheDocument();
    expect(crystalInterplanarAngle).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "cubic",
        a: 5.4309,
        h1: 1,
        k1: 0,
        l1: 0,
        h2: 1,
        k2: 1,
        l2: 0,
      }),
    );
  });

  it("editing an input invalidates the displayed result (provenance contract)", async () => {
    vi.mocked(crystalInterplanarAngle).mockResolvedValue({
      angle_deg: 45.0,
      d1: 3.8387,
      d2: 2.7154,
      system: "cubic",
    });
    openCrystalTab();
    // The angle card's "=" is the 3rd on the page (d-spacing, cell volume, angle).
    fireEvent.click(screen.getAllByText("=")[2]);
    const line = await screen.findByText(/φ = 45.*°/);
    expect(line).toBeInTheDocument();

    // Edit the card's own "h1" field — the result no longer matches the inputs.
    fireEvent.change(screen.getByLabelText("h1"), { target: { value: "2" } });
    expect(screen.queryByText(/φ = 45.*°/)).not.toBeInTheDocument();
  });

  it("surfaces an error for zero Miller indices", async () => {
    vi.mocked(crystalInterplanarAngle).mockRejectedValue(
      new Error("Miller indices (h, k, l) must not all be zero"),
    );
    openCrystalTab();
    fireEvent.click(screen.getAllByText("=")[2]);
    expect(await screen.findByText(/must not all be zero/)).toBeInTheDocument();
  });
});
