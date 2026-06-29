import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  scBcsGap,
  scCoherenceLength,
  scCriticalFields,
  scDepairingCurrent,
  scGlParameter,
  scLondonDepth,
} from "../../../lib/api";
import SuperconductorTab from "./SuperconductorTab";

vi.mock("../../../lib/api", () => ({
  scBcsGap: vi.fn(),
  scLondonDepth: vi.fn(),
  scCoherenceLength: vi.fn(),
  scGlParameter: vi.fn(),
  scCriticalFields: vi.fn(),
  scDepairingCurrent: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SuperconductorTab", () => {
  it("computes the BCS gap for the default Nb-like Tc", async () => {
    vi.mocked(scBcsGap).mockResolvedValue({
      delta0: 1.406,
      ratio: 3.528,
      deltaT: 1.36,
      Tc: 9.25,
      T: 4.2,
    });
    render(<SuperconductorTab />);

    fireEvent.click(screen.getAllByText("Calculate")[0]);
    expect(await screen.findByText(/Δ₀ = .* meV/)).toBeInTheDocument();
    expect(scBcsGap).toHaveBeenCalledWith(9.25, 4.2);
  });

  it("computes the London penetration depth", async () => {
    vi.mocked(scLondonDepth).mockResolvedValue({
      lambda: 39.86,
      lambda0: 39,
      T: 4.2,
      Tc: 9.25,
    });
    render(<SuperconductorTab />);

    fireEvent.click(screen.getAllByText("Calculate")[1]);
    expect(await screen.findByText(/λ\(.*K\) = .* nm/)).toBeInTheDocument();
    expect(scLondonDepth).toHaveBeenCalledWith(39, 4.2, 9.25);
  });

  it("classifies the GL parameter as type II", async () => {
    vi.mocked(scGlParameter).mockResolvedValue({
      kappa: 1.026,
      lambda: 39,
      xi: 38,
      type: "II",
    });
    render(<SuperconductorTab />);

    fireEvent.click(screen.getAllByText("Calculate")[3]);
    expect(await screen.findByText(/κ = .* \(Type II\)/)).toBeInTheDocument();
  });

  it("shows em-dash for NaN Hc1/Hc2 on a type-I material", async () => {
    vi.mocked(scCriticalFields).mockResolvedValue({
      Hc: 95.0,
      Hc1: NaN,
      Hc2: NaN,
      type: "I",
      T: 0.5,
      Tc: 1.18,
    });
    render(<SuperconductorTab />);

    fireEvent.click(screen.getAllByText("Calculate")[4]);
    expect(await screen.findByText(/Type I .* H_c1 = —/)).toBeInTheDocument();
  });

  it("computes the depairing current in MA/cm²", async () => {
    vi.mocked(scDepairingCurrent).mockResolvedValue({
      Jd: 1.36e9,
      JdMA: 1360,
      T: 4.2,
      Tc: 9.25,
    });
    render(<SuperconductorTab />);

    fireEvent.click(screen.getAllByText("Calculate")[5]);
    expect(await screen.findByText(/J_d = .* MA\/cm²/)).toBeInTheDocument();
  });

  it("surfaces API errors", async () => {
    vi.mocked(scCoherenceLength).mockRejectedValue(
      new Error("T (10 K) must be below Tc (9.25 K)."),
    );
    render(<SuperconductorTab />);

    fireEvent.click(screen.getAllByText("Calculate")[2]);
    expect(await screen.findByText(/must be below Tc/)).toBeInTheDocument();
  });
});
