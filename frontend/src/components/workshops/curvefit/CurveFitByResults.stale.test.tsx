// Curve fit By display, lane WB5: while the levels shown are from inputs that
// changed, the panel says "Out of date" and shows no level numbers.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CurveFitByResults from "./CurveFitByResults";
import type { CurveFitByLevelState } from "./useCurveFitByLevel";

const by = (stale: boolean): CurveFitByLevelState => ({
  byOptions: [], byCol: null, setByCol: () => {}, levels: [{ label: "A", data: {} as never }, { label: "B", data: {} as never }] as never,
  totalLevels: 2,
  results: [{ label: "A", n: 3, result: { params: [2, 1], errors: [0.1, 0.1], R2: 0.9, RMSE: 0.1 } as never, error: null }],
  busy: stale, current: !stale, stale,
  provenance: { parameters: {}, xKey: null, yKeys: [1], rowIds: null, range: null },
});

describe("CurveFitByResults out of date", () => {
  it("characterization: current results show their level sections, unmarked", () => {
    render(<CurveFitByResults active={null} by={by(false)} paramNames={["m", "b"]} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.queryByText(/Out of date/)).toBeNull();
  });

  it("stale results are marked and their numbers withheld", () => {
    render(<CurveFitByResults active={null} by={by(true)} paramNames={["m", "b"]} />);
    expect(screen.getByText(/Out of date/)).toBeInTheDocument();
    expect(screen.queryByText("A")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save By result" })).toBeDisabled();
  });
});
