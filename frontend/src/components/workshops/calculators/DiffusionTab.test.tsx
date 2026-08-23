import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { diffusionArrhenius, diffusionFickFlux, diffusionLength, diffusionCProfile } from "../../../lib/api/diffusion";
import DiffusionTab from "./DiffusionTab";


vi.mock("../../../lib/api/diffusion", () => ({
  diffusionCProfile: vi.fn(),
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

  it("editing an input invalidates the displayed result (provenance contract)", async () => {
    vi.mocked(diffusionLength).mockResolvedValue({
      L: 6e-5,
      L_um: 0.6,
      L_nm: 600,
      D: 1e-12,
      t: 3600,
    });
    render(<DiffusionTab />);

    fireEvent.click(screen.getAllByText("=")[1]);
    const line = await screen.findByText(/L = .* µm/);
    expect(line).toBeInTheDocument();

    // Edit the card's own "t" field — the result no longer matches the inputs.
    fireEvent.change(screen.getAllByLabelText("t")[0], { target: { value: "7200" } });
    expect(screen.queryByText(/L = .* µm/)).not.toBeInTheDocument();
  });

  it("a stale in-flight completion cannot resurrect after an input edit", async () => {
    let resolveCalc!: (v: Awaited<ReturnType<typeof diffusionLength>>) => void;
    vi.mocked(diffusionLength).mockImplementation(
      () => new Promise((res) => (resolveCalc = res)),
    );
    render(<DiffusionTab />);

    fireEvent.click(screen.getAllByText("=")[1]); // pending...
    fireEvent.change(screen.getAllByLabelText("t")[0], { target: { value: "7200" } }); // ...edited
    resolveCalc({ L: 6e-5, L_um: 0.6, L_nm: 600, D: 1e-12, t: 3600 });
    await Promise.resolve(); // let the disowned completion settle
    expect(screen.queryByText(/L = .* µm/)).not.toBeInTheDocument();
  });

  it("computes the constant-source (erfc) diffusion profile", async () => {
    vi.mocked(diffusionCProfile).mockResolvedValue({
      c: 4.795e17,
      x: 3e-5,
      t: 3600,
      D: 1e-12,
      c0: 1e18,
      L: 6e-5,
    });
    render(<DiffusionTab />);

    fireEvent.click(screen.getAllByText("=")[3]);
    expect(await screen.findByText(/c\(x,t\) = .* · L = √\(Dt\) = .* cm/)).toBeInTheDocument();
    expect(diffusionCProfile).toHaveBeenCalledWith(3e-5, 3600, 1e-12, 1e18);
  });
});
