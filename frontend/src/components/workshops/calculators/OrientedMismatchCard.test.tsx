// Orientation-aware mismatch card (plan G1 core): builds both plane specs
// from reference phases (centering included) and shows both nets.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { netMismatch } from "../../../lib/api/epitaxy";
import { getPhases, type PhaseInfo } from "../../../lib/api/reference";
import { resetPhaseCacheForTests } from "../structures/PhasePresetPicker";
import OrientedMismatchCard, { parseMiller } from "./OrientedMismatchCard";

vi.mock("../../../lib/api/reference", () => ({ getPhases: vi.fn() }));
vi.mock("../../../lib/api/epitaxy", () => ({ netMismatch: vi.fn(), surfaceNet: vi.fn() }));

const cubic = (name: string, a: number, centering: PhaseInfo["centering"]): PhaseInfo => ({
  name, formula: name, a, b: a, c: a, alpha: 90, beta: 90, gamma: 90, centering,
  system: "cubic", category: "metal", icsd: 0, basis: [],
});
const FE = cubic("Iron (BCC)", 2.8665, "I");
const MGO = cubic("MgO", 4.2112, "F");

beforeEach(() => {
  vi.clearAllMocks();
  resetPhaseCacheForTests();
  vi.mocked(getPhases).mockResolvedValue({ phases: [FE, MGO] });
});

describe("parseMiller", () => {
  it.each([
    ["1 1 1", [1, 1, 1]],
    ["(1,-1,0)", [1, -1, 0]],
    ["0 0 0 1", [0, 0, 0, 1]],
    ["11-20", [1, 1, -2, 0]],
    ["[110]", [1, 1, 0]],
  ])("parses %s", (text, expected) => {
    expect(parseMiller(text)).toEqual(expected);
  });

  it("refuses a malformed plane", () => {
    expect(() => parseMiller("1 1")).toThrow(/h k l/);
    expect(() => parseMiller("a b c")).toThrow(/h k l/);
  });
});

describe("OrientedMismatchCard", () => {
  it("sends both planes with their centering and shows the nets", async () => {
    vi.mocked(netMismatch).mockResolvedValue({
      f_u_pct: -3.737, f_v_pct: -3.737, f_area_pct: -7.33, delta_gamma: 0, swapped: false,
      film: { u: 2.8665, v: 2.8665, gamma: 90, area: 8.217, u_frac: [], v_frac: [], hkl: [0, 0, 1], centering: "I" },
      substrate: { u: 2.9778, v: 2.9778, gamma: 90, area: 8.867, u_frac: [], v_frac: [], hkl: [0, 0, 1], centering: "F" },
    });
    render(<OrientedMismatchCard />);
    await screen.findAllByRole("option", { name: /MgO/ });
    fireEvent.change(screen.getByLabelText("oriented film phase"), { target: { value: "Iron (BCC)" } });
    fireEvent.change(screen.getByLabelText("oriented substrate phase"), { target: { value: "MgO" } });
    fireEvent.click(screen.getByText("Compare"));

    expect(await screen.findByText(/f = -3\.737 % \/ -3\.737 %/)).toBeInTheDocument();
    expect(screen.getByText(/substrate net 2\.9778 × 2\.9778 Å, 90°/)).toBeInTheDocument();
    expect(netMismatch).toHaveBeenCalledWith(
      expect.objectContaining({ a: 2.8665, centering: "I", hkl: [0, 0, 1] }),
      expect.objectContaining({ a: 4.2112, centering: "F", hkl: [0, 0, 1] }),
    );
  });

  it("asks for both phases before comparing", async () => {
    render(<OrientedMismatchCard />);
    fireEvent.click(screen.getByText("Compare"));
    expect(await screen.findByText(/choose a film phase and a substrate phase/)).toBeInTheDocument();
    expect(netMismatch).not.toHaveBeenCalled();
  });

  it("clears the result when a plane is edited", async () => {
    vi.mocked(netMismatch).mockResolvedValue({
      f_u_pct: 0, f_v_pct: 0, f_area_pct: 0, delta_gamma: 0, swapped: false,
      film: { u: 1, v: 1, gamma: 90, area: 1, u_frac: [], v_frac: [], hkl: [0, 0, 1], centering: "P" },
      substrate: { u: 1, v: 1, gamma: 90, area: 1, u_frac: [], v_frac: [], hkl: [0, 0, 1], centering: "P" },
    });
    render(<OrientedMismatchCard />);
    await screen.findAllByRole("option", { name: /MgO/ });
    fireEvent.change(screen.getByLabelText("oriented film phase"), { target: { value: "MgO" } });
    fireEvent.change(screen.getByLabelText("oriented substrate phase"), { target: { value: "MgO" } });
    fireEvent.click(screen.getByText("Compare"));
    await screen.findByText(/film net/);
    fireEvent.change(screen.getByLabelText("film plane"), { target: { value: "1 1 1" } });
    expect(screen.queryByText(/film net/)).not.toBeInTheDocument();
  });
});
