import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bauerScan } from "../../../../lib/api/growth";
import BauerCard from "./BauerCard";

vi.mock("../../../../lib/api/growth", () => ({ bauerScan: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(bauerScan).mockResolvedValue({
    points: [
      { gamma_int: 0, delta: -0.8, verdict: "FvdM" },
      { gamma_int: 1.23456, delta: 0.43456, verdict: "VW" },
    ],
    boundaries: [{ name: "vw_onset", gamma_int: 0.8, between: ["FvdM/SK", "VW"] }],
    uncertainty: 0,
    strain_penalty: 0,
    verdict_labels: {
      FvdM: "Frank-van der Merwe (layer-by-layer)",
      VW: "Volmer-Weber (islands)",
      SK: "Stranski-Krastanov (layer then islands)",
      indeterminate: "indeterminate (within the stated uncertainty of a boundary)",
    },
    note: "",
  });
});

describe("BauerCard", () => {
  it("sends the user's inputs and shows verdicts at 3 significant figures", async () => {
    render(<BauerCard />);
    fireEvent.change(screen.getByLabelText("gamma substrate"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("gamma film"), { target: { value: "1.2" } });
    fireEvent.change(screen.getByLabelText("gamma int max"), { target: { value: "2" } });
    fireEvent.click(screen.getByText("Scan γ_int"));
    expect(await screen.findByText("Volmer-Weber (islands)")).toBeInTheDocument();
    expect(bauerScan).toHaveBeenCalledWith(
      expect.objectContaining({ gamma_substrate: 2, gamma_film: 1.2, gamma_int_min: 0, gamma_int_max: 2, n: 9 }),
    );
    expect(screen.getByText("1.23")).toBeInTheDocument();
    expect(screen.getByText(/Volmer-Weber above γ_int ≈ 0\.8/)).toBeInTheDocument();
  });

  it("drops the table when an input changes", async () => {
    render(<BauerCard />);
    fireEvent.click(screen.getByText("Scan γ_int"));
    await screen.findByLabelText("Bauer verdicts");
    fireEvent.change(screen.getByLabelText("gamma film"), { target: { value: "3" } });
    expect(screen.queryByLabelText("Bauer verdicts")).not.toBeInTheDocument();
  });
});
