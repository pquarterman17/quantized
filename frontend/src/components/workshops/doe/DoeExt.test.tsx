import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { doeFractions, doeGenerate } from "../../../lib/api/doe";
import { designData } from "../../../lib/doeTestData";
import { useDoeStore } from "../../../store/doe";
import { useApp } from "../../../store/useApp";
import DoePanel from "./DoePanel";
import { INITIAL_SETUP, setupBody, setupProblem } from "./useDoe";

vi.mock("../../../lib/api/doe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/doe")>()),
  doeGenerate: vi.fn(),
  doeFractions: vi.fn(),
  doeEffects: vi.fn(),
}));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.mocked(doeFractions).mockResolvedValue({ k: 3, fractions: [], center_points: { ccd: 6, ccd_fractional: 7, box_behnken: 3 } });
  vi.mocked(doeGenerate).mockResolvedValue({ dataset: designData() });
  useApp.setState({ datasets: [], activeId: null, selection: null, analysisResults: [], history: [], future: [] });
  useDoeStore.setState({ open: true });
});

describe("DOE blocking and D-optimal form", () => {
  it("sends the block count and generators for a factorial", async () => {
    render(<DoePanel />);
    fireEvent.change(screen.getByLabelText("Blocks"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Block generators"), { target: { value: "ABC, BC" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate worksheet" }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(1));
    expect(vi.mocked(doeGenerate).mock.calls[0]![0]).toMatchObject({ blocks: 4, block_generators: ["ABC", "BC"] });
  });

  it("refuses a wrong generator count and does not send blocks when there are none", () => {
    const bad = { ...INITIAL_SETUP, blocks: "4", blockGens: "ABC" };
    expect(setupProblem(bad)).toMatch(/4 blocks need 2 generators/);
    expect(setupProblem({ ...INITIAL_SETUP, blocks: "2", blockGens: "A1" })).toMatch(/words of factor letters/);
    const ccd = { ...INITIAL_SETUP, design: "ccd" as const, blocks: "4", blockGens: "ABC" };
    expect(setupProblem(ccd)).toBeNull(); // a leftover block choice does not block, and is not sent
    expect(setupBody(ccd)).not.toHaveProperty("blocks");
    expect(setupBody(INITIAL_SETUP)).not.toHaveProperty("blocks");
  });

  it("D-optimal: sends model, runs, method, seed and categorical levels, and no center points", async () => {
    render(<DoePanel />);
    fireEvent.change(screen.getByLabelText("Design"), { target: { value: "d_optimal" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "main" } });
    fireEvent.change(screen.getByLabelText("Number of runs"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "fedorov" } });
    fireEvent.change(screen.getByLabelText("Seed"), { target: { value: "7" } });
    // One seed field, and no response-surface center-point paragraph (UX audit P2-11).
    expect(screen.getAllByLabelText(/seed/i)).toHaveLength(1);
    expect(screen.queryByText(/Response-surface designs start with/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Factor 2 levels"), { target: { value: "air, N2, Ar" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate worksheet" }));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(1));
    const body = vi.mocked(doeGenerate).mock.calls[0]![0];
    expect(body).toMatchObject({ design: "d_optimal", model: "main", n_runs: 9, method: "fedorov", opt_seed: 7, seed: 7, grid_levels: null, center_points: null });
    expect(body.factors[1]).toMatchObject({ name: "B", levels: ["air", "N2", "Ar"] });
    expect(body.factors[0]).not.toHaveProperty("levels");
    expect(body).not.toHaveProperty("blocks");
  });

  it("D-optimal refuses single or repeated levels and a bad run count", () => {
    const base = { ...INITIAL_SETUP, design: "d_optimal" as const };
    const one = { ...base, factors: base.factors.map((f, i) => (i === 0 ? { ...f, levels: "only" } : f)) };
    expect(setupProblem(one)).toMatch(/two or more different levels/);
    const dup = { ...base, factors: base.factors.map((f, i) => (i === 0 ? { ...f, levels: "a, a" } : f)) };
    expect(setupProblem(dup)).toMatch(/two or more different levels/);
    expect(setupProblem({ ...base, nRuns: "x" })).toMatch(/Runs must be/);
    expect(setupProblem({ ...base, gridLevels: "1" })).toMatch(/2 to 9/);
    expect(setupProblem(base)).toBeNull();
  });
});
