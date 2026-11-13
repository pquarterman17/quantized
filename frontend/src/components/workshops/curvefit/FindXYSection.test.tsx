// FindXYSection (MAIN #15): typing an X and clicking "-> Y" shows the fitted
// Y; typing a Y and clicking "-> X" shows every crossing (or the "no
// crossings" message for an empty list — a valid answer, not an error).

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { findXY } from "../../../lib/api/curvefit";
import { copyText } from "../../../lib/clipboard";
import { useApp } from "../../../store/useApp";
import FindXYSection from "./FindXYSection";
import type { FindXYTarget } from "./useFindXY";

vi.mock("../../../lib/api/curvefit", () => ({
  findXY: vi.fn(),
}));
vi.mock("../../../lib/clipboard", () => ({ copyText: vi.fn(async () => true) }));

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

  // Audit #20: only the last answer used to be kept; a calibration needs the list.
  it("keeps every query and result, newest first, and copies them oldest first as TSV", async () => {
    vi.mocked(findXY).mockResolvedValueOnce({ y: 0.6065 }).mockResolvedValueOnce({ x: [-1.1774, 1.1774] }).mockResolvedValueOnce({ x: [] });
    render(<FindXYSection target={TARGET} />);
    fireEvent.change(screen.getByLabelText("find Y at this X"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("→ Y"));
    await screen.findByText(/Y = 0\.6065/);
    fireEvent.change(screen.getByLabelText("find X at this Y"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByText("→ X"));
    await screen.findByText(/X = -1\.1774/);
    fireEvent.change(screen.getByLabelText("find X at this Y"), { target: { value: "9" } });
    fireEvent.click(screen.getByText("→ X"));
    await screen.findByText("no crossings in the fitted range");
    const rows = within(screen.getByRole("region", { name: "Find X/Y results" })).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual(["X at Y9none", "X at Y0.5-1.1774, 1.1774", "Y at X10.6065"]);
    fireEvent.click(screen.getByRole("button", { name: "Copy Find X/Y results" }));
    await waitFor(() => expect(useApp.getState().status).toBe("copied 3 Find X/Y results"));
    expect(vi.mocked(copyText).mock.calls[0]![0].split("\n").slice(1)).toEqual([
      "Find\tInput\tResult", "Y at X\t1\t0.6065", "X at Y\t0.5\t-1.1774", "X at Y\t0.5\t1.1774", "X at Y\t9\t",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Clear Find X/Y results" }));
    expect(screen.queryByRole("region", { name: "Find X/Y results" })).toBeNull();
  });

  it("starts a new list for a new fit", async () => {
    vi.mocked(findXY).mockResolvedValue({ y: 1 });
    const { rerender } = render(<FindXYSection target={TARGET} />);
    fireEvent.change(screen.getByLabelText("find Y at this X"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("→ Y"));
    await screen.findByRole("region", { name: "Find X/Y results" });
    rerender(<FindXYSection target={{ ...TARGET, params: [2, 0, 1] }} />);
    expect(screen.queryByRole("region", { name: "Find X/Y results" })).toBeNull();
  });
});
