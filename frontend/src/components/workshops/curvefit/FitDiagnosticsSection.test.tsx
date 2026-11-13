// Diagnostics panel (fitting audit finding 16): the AIC/AICc/BIC and RMSE it
// lists are the FIT's own numbers, so they can never disagree with the fit
// summary; a weighted fit also shows its weighted χ²; the route's values are
// only the fallback for a result that predates them.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitDiagnostics, type DiagnosticsResult } from "../../../lib/api/fitStats";
import FitDiagnosticsSection from "./FitDiagnosticsSection";

vi.mock("../../../lib/api/fitStats", () => ({ fitDiagnostics: vi.fn() }));

const ROUTE: DiagnosticsResult = {
  compare: { R2: 0.9, adjR2: 0.85, aic: 111, aicc: 112, bic: 113, rmse: 9.5, n: 4, p: 2 },
  residuals: {
    qqX: [], qqY: [], durbinWatson: 2, runsTestZ: 0, runsTestP: 1, nRuns: 2, skewness: 0, kurtosis: 0,
  },
};

async function open(): Promise<void> {
  const details = screen.getByText("Diagnostics").closest("details")!;
  await act(async () => {
    details.open = true;
    fireEvent(details, new Event("toggle"));
  });
}

function valueOf(label: string): string {
  const row = screen.getByText(label).closest("tr")!;
  return row.querySelectorAll("td")[1]!.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fitDiagnostics).mockResolvedValue(ROUTE);
});

describe("FitDiagnosticsSection", () => {
  it("shows the fit's own AIC/AICc/BIC/RMSE and the weighted χ² of a weighted fit", async () => {
    const result = {
      residuals: [0.1, -0.1, 0.2, -0.2], nFree: 2, chiSqRed: 1.5, chiSq: 3, SSR: 0.1,
      RMSE: 0.158, AIC: -7.25, AICc: 4.75, BIC: -8.5, R2: 0.5,
    };
    render(<FitDiagnosticsSection result={result} fitData={{ x: [0, 1, 2, 3], y: [1, 2, 3, 4] }} />);
    await open();
    await screen.findByText("weighted χ²");
    expect(valueOf("AIC")).not.toContain("111");
    expect(valueOf("AIC")).toContain("-7.25");
    expect(valueOf("AICc")).toContain("4.75");
    expect(valueOf("BIC")).toContain("-8.5");
    expect(valueOf("RMSE (y units)")).toContain("0.158");
    expect(valueOf("weighted χ²")).toContain("3");
    // R² is the fit's own (weighted), not the route's unweighted 0.9; adj. R²
    // follows from it: 1 - (1 - 0.5)(4 - 1)/(4 - 2 - 1) = -0.5.
    expect(valueOf("R² (weighted)")).toContain("0.5");
    expect(valueOf("adj. R²")).toContain("-0.5");
  });

  it("falls back to the route's values for a result without them, and lists no weighted χ² unweighted", async () => {
    const result = { residuals: [0.1, -0.1, 0.2, -0.2], nFree: 2, chiSqRed: 1.5 };
    render(<FitDiagnosticsSection result={result} fitData={{ x: [0, 1, 2, 3], y: [1, 2, 3, 4] }} />);
    await open();
    await screen.findByText("AIC");
    expect(valueOf("AIC")).toContain("111");
    expect(valueOf("R²")).toContain("0.9");
    expect(valueOf("adj. R²")).toContain("0.85");
    expect(screen.queryByText("weighted χ²")).toBeNull();
  });
});
