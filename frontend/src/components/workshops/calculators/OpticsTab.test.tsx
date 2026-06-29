import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  opticsBrewsterAngle,
  opticsCriticalAngle,
  opticsFresnel,
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
});
