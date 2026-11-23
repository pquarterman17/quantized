// Orientation-aware mismatch card (plan G1 core): builds both plane specs
// from reference phases (centering included) and shows both nets.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { coincidenceSearch, netMismatch, type OutOfPlane } from "../../../lib/api/epitaxy";
import { getPhases, type PhaseInfo } from "../../../lib/api/reference";
import { resetPhaseCacheForTests } from "../structures/PhasePresetPicker";
import OrientedMismatchCard, { parseMiller } from "./OrientedMismatchCard";

vi.mock("../../../lib/api/reference", () => ({ getPhases: vi.fn() }));
vi.mock("../../../lib/api/epitaxy", () => ({
  netMismatch: vi.fn(),
  surfaceNet: vi.fn(),
  coincidenceSearch: vi.fn(),
}));

const cubic = (name: string, a: number, centering: PhaseInfo["centering"]): PhaseInfo => ({
  name, formula: name, a, b: a, c: a, alpha: 90, beta: 90, gamma: 90, centering,
  system: "cubic", category: "metal", icsd: 0, basis: [],
});
const NU_REASON = "No Poisson ratio is stored for the film phase; enter one for the film.";
const NO_OOP: OutOfPlane = {
  eps_u: 0.0388, eps_v: 0.0388, eps_parallel: 0.0388, eps_perp: null, nu: null, c_over_a: null,
  distortion_pct: null, c_predicted: null, eps_perp_reason: NU_REASON, c_over_a_reason: NU_REASON,
};
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
      out_of_plane: NO_OOP,
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
      null,
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
      out_of_plane: NO_OOP,
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

  it("searches supercells and lists matches with rotation and relationship", async () => {
    vi.mocked(coincidenceSearch).mockResolvedValue({
      matches: [
        {
          film_index: 1, substrate_index: 1, area: 8.87, f_u_pct: -3.74, f_v_pct: -3.74, f_area_pct: -7.3,
          delta_gamma: 0, rotation: 0, film_direction: [1, 0, 0], substrate_direction: [1, 1, 0],
          film_direction_4: null, substrate_direction_4: null,
        },
      ],
      n_found: 35,
      rotation_period: 90,
      film_net: { u: 2.8665, v: 2.8665, gamma: 90, area: 8.217, u_frac: [], v_frac: [], hkl: [0, 0, 1], centering: "I" },
      substrate_net: { u: 2.9778, v: 2.9778, gamma: 90, area: 8.867, u_frac: [], v_frac: [], hkl: [0, 0, 1], centering: "F" },
    });
    render(<OrientedMismatchCard />);
    await screen.findAllByRole("option", { name: /MgO/ });
    fireEvent.change(screen.getByLabelText("oriented film phase"), { target: { value: "Iron (BCC)" } });
    fireEvent.change(screen.getByLabelText("oriented substrate phase"), { target: { value: "MgO" } });
    fireEvent.change(screen.getByLabelText("max strain"), { target: { value: "4" } });
    fireEvent.click(screen.getByText("Search supercells"));

    expect(await screen.findByText(/35 distinct matches; best 1:1 cells/)).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "coincidence matches" });
    expect(table.textContent).toContain("[1 0 0] ∥ [1 1 0]");
    expect(coincidenceSearch).toHaveBeenCalledWith(
      expect.objectContaining({ centering: "I" }),
      expect.objectContaining({ centering: "F" }),
      { max_strain: 0.04, max_area: 200 },
    );

    // Changing a plane makes the table stale.
    fireEvent.change(screen.getByLabelText("substrate plane"), { target: { value: "1 1 0" } });
    expect(screen.queryByRole("table", { name: "coincidence matches" })).not.toBeInTheDocument();
  });

  it("says when nothing matches", async () => {
    vi.mocked(coincidenceSearch).mockResolvedValue({
      matches: [], n_found: 0, rotation_period: 90,
      film_net: { u: 1, v: 1, gamma: 90, area: 1, u_frac: [], v_frac: [], hkl: [0, 0, 1], centering: "P" },
      substrate_net: { u: 1, v: 1, gamma: 90, area: 1, u_frac: [], v_frac: [], hkl: [0, 0, 1], centering: "P" },
    });
    render(<OrientedMismatchCard />);
    await screen.findAllByRole("option", { name: /MgO/ });
    fireEvent.change(screen.getByLabelText("oriented film phase"), { target: { value: "MgO" } });
    fireEvent.change(screen.getByLabelText("oriented substrate phase"), { target: { value: "MgO" } });
    fireEvent.click(screen.getByText("Search supercells"));
    expect(await screen.findByText(/no coincidence within 5 % and 200 Å²/)).toBeInTheDocument();
  });

  describe("out-of-plane strain", () => {
    const NET = { u: 1, v: 1, gamma: 90, area: 1, u_frac: [], v_frac: [], hkl: [0, 0, 1], centering: "P" };
    const result = (oop: OutOfPlane) => ({
      f_u_pct: -3.7, f_v_pct: -3.7, f_area_pct: -7, delta_gamma: 0, swapped: false,
      film: NET, substrate: NET, out_of_plane: oop,
    });
    async function compare(nu?: string): Promise<void> {
      render(<OrientedMismatchCard />);
      await screen.findAllByRole("option", { name: /MgO/ });
      fireEvent.change(screen.getByLabelText("oriented film phase"), { target: { value: "MgO" } });
      fireEvent.change(screen.getByLabelText("oriented substrate phase"), { target: { value: "MgO" } });
      if (nu !== undefined) fireEvent.change(screen.getByLabelText("film Poisson ratio"), { target: { value: nu } });
      fireEvent.click(screen.getByText("Compare"));
    }

    it("shows out-of-plane strain and c/a next to the in-plane strain when nu is given", async () => {
      vi.mocked(netMismatch).mockResolvedValue(
        result({ ...NO_OOP, eps_parallel: 0.01, eps_perp: -0.008571, nu: 0.3, c_over_a: 0.99, eps_perp_reason: null, c_over_a_reason: null }),
      );
      await compare("0.3");
      const block = await screen.findByLabelText("out-of-plane strain");
      expect(block.textContent).toContain("ε∥ = 1 %");
      expect(block.textContent).toContain("ε⊥ = -0.8571 %");
      expect(block.textContent).toContain("c/a = 0.99");
      expect(netMismatch).toHaveBeenCalledWith(expect.anything(), expect.anything(), 0.3);
    });

    it("shows a dash and the reason when no nu is entered (never a default)", async () => {
      vi.mocked(netMismatch).mockResolvedValue(result(NO_OOP));
      await compare();
      const block = await screen.findByLabelText("out-of-plane strain");
      expect(block.textContent).toContain("ε⊥ = — %");
      expect(block.textContent).toContain("c/a = —");
      expect(block.textContent).toContain(NU_REASON);
      expect(netMismatch).toHaveBeenCalledWith(expect.anything(), expect.anything(), null);
    });

    it("refuses an out-of-range nu without calling the backend", async () => {
      await compare("0.7");
      expect(await screen.findByText(/Poisson ratio ν between 0 and 0.5/)).toBeInTheDocument();
      expect(netMismatch).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("out-of-plane strain")).not.toBeInTheDocument();
    });

    it("drops the out-of-plane lines when an input changes", async () => {
      vi.mocked(netMismatch).mockResolvedValue(result(NO_OOP));
      await compare();
      await screen.findByLabelText("out-of-plane strain");
      fireEvent.change(screen.getByLabelText("film Poisson ratio"), { target: { value: "0.2" } });
      expect(screen.queryByLabelText("out-of-plane strain")).not.toBeInTheDocument();
    });
  });
});
