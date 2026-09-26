import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { crystalBondAngle } from "../../../lib/api/crystallography";
import BondAngleCard from "./BondAngleCard";
import { useCard } from "./shared";
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
  ambiguous: false,
  warnings: [] as string[],
};

// The production owner of this card's `useCard` instance is CrystalTab
// (finding #6: one lattice-invalidation mechanism, its `updateLattice()`
// touch path, shared by every card on the tab). This harness plays that
// role for the component in isolation: a "touch lattice" button stands in
// for CrystalTab calling `bondCard.touch()` from `updateLattice()`.
function Harness({ crystal: c }: { crystal: CrystalForm }) {
  const card = useCard("Crystal");
  return (
    <div>
      <button onClick={() => card.touch()}>touch lattice</button>
      <BondAngleCard crystal={c} card={card} />
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(crystalBondAngle).mockResolvedValue(result);
});

describe("BondAngleCard", () => {
  it("computes an atomic angle from fractional coordinates and the shared cell", async () => {
    render(<Harness crystal={crystal} />);
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
    render(<Harness crystal={crystal} />);
    fireEvent.change(screen.getByLabelText("neighbor 1 fractional coordinates"), {
      target: { value: "0.25 0" },
    });
    fireEvent.click(screen.getByText("="));

    expect(await screen.findByText(/exactly three numeric fractional coordinates/)).toBeInTheDocument();
    expect(crystalBondAngle).not.toHaveBeenCalled();
  });

  it("accepts simple fractions (a/b, including negatives) in fractional coordinates", async () => {
    render(<Harness crystal={crystal} />);
    fireEvent.change(screen.getByLabelText("neighbor 1 fractional coordinates"), {
      target: { value: "1/3 2/3 -1/4" },
    });
    fireEvent.click(screen.getByText("="));

    await screen.findByText(/θ = 90/);
    expect(crystalBondAngle).toHaveBeenCalledWith(
      expect.objectContaining({ atom1: [1 / 3, 2 / 3, -1 / 4] }),
    );
  });

  it("can use coordinates as entered instead of nearest periodic images", async () => {
    render(<Harness crystal={crystal} />);
    fireEvent.change(screen.getByLabelText("periodic image handling"), {
      target: { value: "entered" },
    });
    fireEvent.click(screen.getByText("="));
    await screen.findByText(/θ = 90/);

    expect(crystalBondAngle).toHaveBeenCalledWith(expect.objectContaining({ minimum_image: false }));
  });

  it("shows an ambiguous-tie warning when the API flags one", async () => {
    vi.mocked(crystalBondAngle).mockResolvedValue({
      ...result,
      ambiguous: true,
      warnings: ["atom1: another periodic image is equidistant from the vertex (alternate shift: (-1, 0, 0))"],
    });
    render(<Harness crystal={crystal} />);
    fireEvent.click(screen.getByText("="));

    expect(await screen.findByText(/ambiguous/i)).toBeInTheDocument();
  });

  it("invalidates a completed result when a coordinate changes", async () => {
    render(<Harness crystal={crystal} />);
    fireEvent.click(screen.getByText("="));
    expect(await screen.findByText(/θ = 90/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("vertex fractional coordinates"), {
      target: { value: "0.1 0 0" },
    });
    expect(screen.queryByText(/θ = 90/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("="));
    expect(await screen.findByText(/θ = 90/)).toBeInTheDocument();
  });

  it("invalidates a completed result when the shared lattice is touched", async () => {
    render(<Harness crystal={crystal} />);
    fireEvent.click(screen.getByText("="));
    expect(await screen.findByText(/θ = 90/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("touch lattice"));
    expect(screen.queryByText(/θ = 90/)).not.toBeInTheDocument();
  });

  it("disowns an in-flight result when the shared lattice is touched", async () => {
    let resolve!: (value: typeof result) => void;
    const pending = new Promise<typeof result>((done) => {
      resolve = done;
    });
    vi.mocked(crystalBondAngle).mockReturnValue(pending);
    render(<Harness crystal={crystal} />);
    fireEvent.click(screen.getByText("="));
    fireEvent.click(screen.getByText("touch lattice"));

    await act(async () => {
      resolve(result);
      await pending;
    });
    expect(screen.queryByText(/θ = 90/)).not.toBeInTheDocument();
  });
});
