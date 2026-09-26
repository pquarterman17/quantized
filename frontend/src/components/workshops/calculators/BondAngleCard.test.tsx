import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { crystalBondAngle } from "../../../lib/api/crystallography";
import BondAngleCard from "./BondAngleCard";
import type { CrystalForm } from "./useCalculators";

vi.mock("../../../lib/api/crystallography", () => ({
  crystalBondAngle: vi.fn(),
}));

const crystal: CrystalForm = {
  system: "cubic",
  a: "4",
  b: "4",
  c: "4",
  alpha: "90",
  beta: "90",
  gamma: "90",
  h: "1",
  k: "1",
  l: "1",
  formula: "Si",
  z: "8",
};

const result = {
  angle_deg: 90,
  distance1: 1,
  distance3: 1,
  image1: [0, 0, 0] as [number, number, number],
  image3: [0, 0, 0] as [number, number, number],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(crystalBondAngle).mockResolvedValue(result);
});

describe("BondAngleCard", () => {
  it("computes an atomic angle from fractional coordinates and the shared cell", async () => {
    render(<BondAngleCard crystal={crystal} />);
    fireEvent.click(screen.getByText("="));

    expect(await screen.findByText(/θ = 90.*r₁ = 1 Å.*r₂ = 1 Å/)).toBeInTheDocument();
    expect(crystalBondAngle).toHaveBeenCalledWith({
      a: 4,
      b: 4,
      c: 4,
      alpha: 90,
      beta: 90,
      gamma: 90,
      atom1: [0.25, 0, 0],
      vertex: [0, 0, 0],
      atom3: [0, 0.25, 0],
      minimum_image: true,
    });
  });

  it("validates that every coordinate is a finite fractional triple", async () => {
    render(<BondAngleCard crystal={crystal} />);
    fireEvent.change(screen.getByLabelText("neighbor 1 fractional coordinates"), {
      target: { value: "0.25 0" },
    });
    fireEvent.click(screen.getByText("="));

    expect(await screen.findByText(/exactly three numeric fractional coordinates/)).toBeInTheDocument();
    expect(crystalBondAngle).not.toHaveBeenCalled();
  });

  it("can use coordinates as entered instead of nearest periodic images", async () => {
    render(<BondAngleCard crystal={crystal} />);
    fireEvent.change(screen.getByLabelText("periodic image handling"), {
      target: { value: "entered" },
    });
    fireEvent.click(screen.getByText("="));
    await screen.findByText(/θ = 90/);

    expect(crystalBondAngle).toHaveBeenCalledWith(expect.objectContaining({ minimum_image: false }));
  });

  it("invalidates a completed result when a coordinate or shared lattice changes", async () => {
    const view = render(<BondAngleCard crystal={crystal} />);
    fireEvent.click(screen.getByText("="));
    expect(await screen.findByText(/θ = 90/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("vertex fractional coordinates"), {
      target: { value: "0.1 0 0" },
    });
    expect(screen.queryByText(/θ = 90/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("="));
    expect(await screen.findByText(/θ = 90/)).toBeInTheDocument();
    view.rerender(<BondAngleCard crystal={{ ...crystal, a: "5" }} />);
    expect(screen.queryByText(/θ = 90/)).not.toBeInTheDocument();
  });

  it("disowns an in-flight result when the shared lattice changes", async () => {
    let resolve!: (value: typeof result) => void;
    const pending = new Promise<typeof result>((done) => {
      resolve = done;
    });
    vi.mocked(crystalBondAngle).mockReturnValue(pending);
    const view = render(<BondAngleCard crystal={crystal} />);
    fireEvent.click(screen.getByText("="));
    view.rerender(<BondAngleCard crystal={{ ...crystal, a: "5" }} />);

    await act(async () => {
      resolve(result);
      await pending;
    });
    expect(screen.queryByText(/θ = 90/)).not.toBeInTheDocument();
  });
});
