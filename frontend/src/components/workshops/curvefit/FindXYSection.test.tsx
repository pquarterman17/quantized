// FindXYSection (MAIN #15): typing an X and clicking "-> Y" shows the fitted
// Y; typing a Y and clicking "-> X" shows every crossing (or the "no
// crossings" message for an empty list — a valid answer, not an error).

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { findXY } from "../../../lib/api";
import FindXYSection from "./FindXYSection";
import type { FindXYTarget } from "./useFindXY";

vi.mock("../../../lib/api", () => ({
  findXY: vi.fn(),
}));

const TARGET: FindXYTarget = { model: "Gaussian", params: [1, 0, 1], xMin: -5, xMax: 5 };

describe("FindXYSection", () => {
  it("finds Y at a given X", async () => {
    vi.mocked(findXY).mockResolvedValue({ y: 0.6065 });
    render(<FindXYSection target={TARGET} />);
    fireEvent.change(screen.getByLabelText("find Y at this X"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("→ Y"));
    expect(await screen.findByText(/Y = 0\.6065/)).toBeInTheDocument();
  });

  it("finds all X crossings for a given Y", async () => {
    vi.mocked(findXY).mockResolvedValue({ x: [-1.1774, 1.1774] });
    render(<FindXYSection target={TARGET} />);
    fireEvent.change(screen.getByLabelText("find X at this Y"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByText("→ X"));
    expect(await screen.findByText(/X = -1\.1774, 1\.1774/)).toBeInTheDocument();
  });

  it("reports no crossings as a plain message, not an error", async () => {
    vi.mocked(findXY).mockResolvedValue({ x: [] });
    render(<FindXYSection target={TARGET} />);
    fireEvent.change(screen.getByLabelText("find X at this Y"), { target: { value: "100" } });
    fireEvent.click(screen.getByText("→ X"));
    expect(await screen.findByText("no crossings in the fitted range")).toBeInTheDocument();
  });

  it("surfaces a backend error", async () => {
    vi.mocked(findXY).mockRejectedValue(new Error("unknown model: Foo"));
    render(<FindXYSection target={TARGET} />);
    fireEvent.change(screen.getByLabelText("find Y at this X"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("→ Y"));
    expect(await screen.findByText("unknown model: Foo")).toBeInTheDocument();
  });
});
