import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  electrochemDoubleLayer,
  electrochemNernst,
  electrochemOhmicDrop,
} from "../../../lib/api";
import ElectrochemistryTab from "./ElectrochemistryTab";

vi.mock("../../../lib/api", () => ({
  electrochemNernst: vi.fn(),
  electrochemButlerVolmer: vi.fn(),
  electrochemTafel: vi.fn(),
  electrochemDoubleLayer: vi.fn(),
  electrochemOhmicDrop: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ElectrochemistryTab", () => {
  it("computes the Nernst potential from E0, n, Q", async () => {
    vi.mocked(electrochemNernst).mockResolvedValue({
      E: 0.8883,
      E0: 0.77,
      n: 1,
      Q: 0.01,
      T: 298.15,
    });
    render(<ElectrochemistryTab />);

    fireEvent.click(screen.getAllByText("=")[0]);
    expect(await screen.findByText(/E = .* V/)).toBeInTheDocument();
    // defaults: E0=0.77, n=1, Q=0.01.
    expect(electrochemNernst).toHaveBeenCalledWith(0.77, 1, 0.01);
  });

  it("computes the double-layer capacitance and specific capacitance", async () => {
    vi.mocked(electrochemDoubleLayer).mockResolvedValue({
      C: 1.38e-4,
      CuF: 138.1,
      CpF: 1.381e8,
      Cspec: 1.381e-4,
    });
    render(<ElectrochemistryTab />);

    const buttons = screen.getAllByText("=");
    fireEvent.click(buttons[3]);
    expect(await screen.findByText(/C = .* µF · .* µF\/cm²/)).toBeInTheDocument();
    expect(electrochemDoubleLayer).toHaveBeenCalledWith(78, 0.5, 1);
  });

  it("computes the ohmic (iR) drop", async () => {
    vi.mocked(electrochemOhmicDrop).mockResolvedValue({ V: 0.05, VmV: 50 });
    render(<ElectrochemistryTab />);

    const buttons = screen.getAllByText("=");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByText(/V_IR = .* mV/)).toBeInTheDocument();
    expect(electrochemOhmicDrop).toHaveBeenCalledWith(1e-3, 50);
  });

  it("surfaces API errors", async () => {
    vi.mocked(electrochemNernst).mockRejectedValue(new Error("Q must be positive"));
    render(<ElectrochemistryTab />);

    fireEvent.click(screen.getAllByText("=")[0]);
    expect(await screen.findByText("Q must be positive")).toBeInTheDocument();
  });
});
