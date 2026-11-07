// X-ray / Neutron tab composition cards (THIN_FILM_STACK_PLANNING_PLAN G3):
// weight% ↔ atomic% and the co-deposition flux ratio.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { atomicToWeight, coDeposition, weightToAtomic } from "../../../lib/api/composition";
import { CoDepositionCard, WeightAtomicCard } from "./CompositionCards";

vi.mock("../../../lib/api/composition", () => ({
  atomicToWeight: vi.fn(),
  weightToAtomic: vi.fn(),
  coDeposition: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WeightAtomicCard", () => {
  it("converts wt% → at% for the default Fe/Ni 70/30", async () => {
    vi.mocked(weightToAtomic).mockResolvedValue({
      elements: ["Fe", "Ni"],
      atomic_pct: [71.0328, 28.9672],
      weight_pct: [70, 30],
      masses: [55.845, 58.6934],
    });
    render(<WeightAtomicCard />);
    fireEvent.click(screen.getByText("wt% → at%"));
    expect(await screen.findByText("Fe: 71.0328 at% · Ni: 28.9672 at%")).toBeInTheDocument();
    expect(weightToAtomic).toHaveBeenCalledWith(["Fe", "Ni"], [70, 30]);
    expect(atomicToWeight).not.toHaveBeenCalled();
  });

  it("converts at% → wt% and accepts comma-separated input", async () => {
    vi.mocked(atomicToWeight).mockResolvedValue({
      elements: ["Fe", "O"],
      weight_pct: [69.9431, 30.0569],
      atomic_pct: [40, 60],
      masses: [55.845, 15.999],
    });
    render(<WeightAtomicCard />);
    fireEvent.change(screen.getByLabelText("elements"), { target: { value: "Fe, O" } });
    fireEvent.change(screen.getByLabelText("percentages"), { target: { value: "2, 3" } });
    fireEvent.click(screen.getByText("at% → wt%"));
    expect(await screen.findByText(/Fe: 69\.9431 wt% · O: 30\.0569 wt%/)).toBeInTheDocument();
    expect(atomicToWeight).toHaveBeenCalledWith(["Fe", "O"], [2, 3]);
  });

  it("clears the result when an input changes", async () => {
    vi.mocked(weightToAtomic).mockResolvedValue({
      elements: ["Fe", "Ni"],
      atomic_pct: [71.0328, 28.9672],
      weight_pct: [70, 30],
      masses: [55.845, 58.6934],
    });
    render(<WeightAtomicCard />);
    fireEvent.click(screen.getByText("wt% → at%"));
    expect(await screen.findByText(/at%/, { selector: "span" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("percentages"), { target: { value: "60 40" } });
    expect(screen.queryByText(/Fe: 71/)).not.toBeInTheDocument();
  });
});

it("rejects non-numeric percentages before calling the API", async () => {
  render(<WeightAtomicCard />);
  fireEvent.change(screen.getByLabelText("percentages"), { target: { value: "70% 30" } });
  fireEvent.click(screen.getByText("wt% → at%"));
  expect(await screen.findByText(/enter numeric percentages/)).toBeInTheDocument();
  expect(weightToAtomic).not.toHaveBeenCalled();
});

describe("CoDepositionCard", () => {
  it("shows the flux ratios for the default SrTiO3 from Sr + TiO2", async () => {
    vi.mocked(coDeposition).mockResolvedValue({
      ratios: [1, 1],
      needed: [1, 1],
      cations: ["Sr", "Ti"],
      sources: ["Sr", "TiO2"],
      warnings: [],
    });
    render(<CoDepositionCard />);
    fireEvent.click(screen.getByText("Calculate"));
    expect(await screen.findByText("Sr : TiO2 = 1 : 1")).toBeInTheDocument();
    expect(coDeposition).toHaveBeenCalledWith("SrTiO3", ["Sr", "TiO2"]);
  });

  it("shows coverage warnings next to the ratios", async () => {
    vi.mocked(coDeposition).mockResolvedValue({
      ratios: [1],
      needed: [1],
      cations: ["Sr"],
      sources: ["Sr"],
      warnings: ["no source is matched to Ti from 'SrTiO3'"],
    });
    render(<CoDepositionCard />);
    fireEvent.change(screen.getByLabelText("source formulas"), { target: { value: "Sr" } });
    fireEvent.click(screen.getByText("Calculate"));
    expect(await screen.findByText(/⚠ no source is matched to Ti/)).toBeInTheDocument();
  });
});
