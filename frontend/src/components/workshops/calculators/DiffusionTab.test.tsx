import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  diffusionArrhenius,
  diffusionFickFlux,
  diffusionLength,
} from "../../../lib/api";
import DiffusionTab from "./DiffusionTab";

vi.mock("../../../lib/api", () => ({
  diffusionArrhenius: vi.fn(),
  diffusionLength: vi.fn(),
  diffusionFickFlux: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DiffusionTab", () => {
  it("computes the Arrhenius diffusion coefficient", async () => {
    vi.mocked(diffusionArrhenius).mockResolvedValue({
      D: 9.124768e-7,
      D0: 0.1,
      Ea: 1.0,
      T: 1000,
    });
    render(<DiffusionTab />);

    fireEvent.click(screen.getAllByText("=")[0]);
    expect(await screen.findByText(/D = .* cm²\/s/)).toBeInTheDocument();
    // defaults: D0=0.1, Ea=1.0, T=1000.
    expect(diffusionArrhenius).toHaveBeenCalledWith(0.1, 1.0, 1000);
  });

  it("computes the diffusion length", async () => {
    vi.mocked(diffusionLength).mockResolvedValue({
      L: 6e-5,
      L_um: 0.6,
      L_nm: 600,
      D: 1e-12,
      t: 3600,
    });
    render(<DiffusionTab />);

    fireEvent.click(screen.getAllByText("=")[1]);
    expect(await screen.findByText(/L = .* µm/)).toBeInTheDocument();
    expect(diffusionLength).toHaveBeenCalledWith(1e-12, 3600);
  });

  it("computes the Fick flux", async () => {
    vi.mocked(diffusionFickFlux).mockResolvedValue({
      J: -1e11,
      J_abs: 1e11,
      D: 1e-12,
      dC: 1e18,
      dx: 1e-5,
    });
    render(<DiffusionTab />);

    fireEvent.click(screen.getAllByText("=")[2]);
    expect(await screen.findByText(/J = .* atoms\/\(cm²·s\)/)).toBeInTheDocument();
  });

  it("surfaces API errors", async () => {
    vi.mocked(diffusionArrhenius).mockRejectedValue(new Error("T must be positive"));
    render(<DiffusionTab />);

    fireEvent.click(screen.getAllByText("=")[0]);
    expect(await screen.findByText("T must be positive")).toBeInTheDocument();
  });
});
