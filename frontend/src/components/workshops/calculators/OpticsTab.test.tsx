import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  opticsBrewsterAngle,
  opticsCriticalAngle,
  opticsDielectricToRefractive,
  opticsFresnel,
  opticsRefractiveToDielectric,
  opticsSkinDepth,
} from "../../../lib/api";
import OpticsTab from "./OpticsTab";

vi.mock("../../../lib/api", () => ({
  opticsFresnel: vi.fn(),
  opticsCriticalAngle: vi.fn(),
  opticsBrewsterAngle: vi.fn(),
  opticsPenetrationDepth: vi.fn(),
  opticsSkinDepth: vi.fn(),
  opticsRefractiveToDielectric: vi.fn(),
  opticsDielectricToRefractive: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OpticsTab", () => {
  it("computes Fresnel coefficients for the default air/glass interface", async () => {
    vi.mocked(opticsFresnel).mockResolvedValue({ Rs: 0.0922, Rp: 0.0085, Ts: 0.9078, Tp: 0.9915 });
    render(<OpticsTab />);

    fireEvent.click(screen.getAllByText("Calculate")[0]);
    expect(await screen.findByText(/Rs = .* · Rp = .*/)).toBeInTheDocument();
    // n1=1.0, n2=1.5, theta=45 defaults.
    expect(opticsFresnel).toHaveBeenCalledWith(1.0, 1.5, 45);
  });

  it("shows the critical and Brewster angles together", async () => {
    vi.mocked(opticsCriticalAngle).mockResolvedValue({ theta_c: 41.81 });
    vi.mocked(opticsBrewsterAngle).mockResolvedValue({ theta_b: 33.69 });
    render(<OpticsTab />);

    fireEvent.click(screen.getAllByText("Calculate")[1]);
    expect(await screen.findByText(/θc = .* · θB = .*/)).toBeInTheDocument();
  });

  it("reports no TIR when the critical angle is NaN", async () => {
    vi.mocked(opticsCriticalAngle).mockResolvedValue({ theta_c: NaN });
    vi.mocked(opticsBrewsterAngle).mockResolvedValue({ theta_b: 56.31 });
    render(<OpticsTab />);

    fireEvent.click(screen.getAllByText("Calculate")[1]);
    expect(await screen.findByText(/no TIR/)).toBeInTheDocument();
  });

  it("computes the skin depth in micrometres", async () => {
    vi.mocked(opticsSkinDepth).mockResolvedValue({ delta: 2.06e-6, delta_um: 2.06, delta_nm: 2060 });
    render(<OpticsTab />);

    fireEvent.click(screen.getAllByText("Calculate")[3]);
    expect(await screen.findByText(/δ = .* µm/)).toBeInTheDocument();
  });

  it("surfaces API errors", async () => {
    vi.mocked(opticsSkinDepth).mockRejectedValue(new Error("rho must be positive"));
    render(<OpticsTab />);

    fireEvent.click(screen.getAllByText("Calculate")[3]);
    expect(await screen.findByText("rho must be positive")).toBeInTheDocument();
  });

  it("editing an input invalidates the displayed result (provenance contract)", async () => {
    vi.mocked(opticsFresnel).mockResolvedValue({ Rs: 0.0922, Rp: 0.0085, Ts: 0.9078, Tp: 0.9915 });
    render(<OpticsTab />);

    fireEvent.click(screen.getAllByText("Calculate")[0]);
    const line = await screen.findByText(/Rs = .* · Rp = .*/);
    expect(line).toBeInTheDocument();

    // Edit the card's own "n₁" field — the result no longer matches the inputs.
    fireEvent.change(screen.getAllByLabelText("n₁")[0], { target: { value: "1.2" } });
    expect(screen.queryByText(/Rs = .* · Rp = .*/)).not.toBeInTheDocument();
  });

  it("a stale n,k → ε completion cannot overwrite newer dielectric inputs", async () => {
    let resolveCalc!: (v: { eps1: number; eps2: number }) => void;
    vi.mocked(opticsRefractiveToDielectric).mockImplementation(
      () => new Promise((resolve) => (resolveCalc = resolve)),
    );
    render(<OpticsTab />);

    fireEvent.click(screen.getByText("n,k → ε"));
    fireEvent.change(screen.getByLabelText("ε₁"), { target: { value: "20" } });
    await act(async () => {
      resolveCalc({ eps1: 12.25, eps2: 0 });
      await Promise.resolve();
    });

    expect(screen.getByDisplayValue("20")).toBeInTheDocument();
    expect(screen.queryByText(/ε₁ = .* · ε₂ = .*/)).not.toBeInTheDocument();
  });

  it("a stale ε → n,k completion cannot overwrite newer refractive inputs", async () => {
    let resolveCalc!: (v: { n: number; k: number }) => void;
    vi.mocked(opticsDielectricToRefractive).mockImplementation(
      () => new Promise((resolve) => (resolveCalc = resolve)),
    );
    render(<OpticsTab />);

    fireEvent.click(screen.getByText("ε → n,k"));
    fireEvent.change(screen.getAllByLabelText("n")[1], { target: { value: "4.2" } });
    await act(async () => {
      resolveCalc({ n: 3.5, k: 0 });
      await Promise.resolve();
    });

    expect(screen.getByDisplayValue("4.2")).toBeInTheDocument();
    expect(screen.queryByText(/n = .* · k = .*/)).not.toBeInTheDocument();
  });
});
