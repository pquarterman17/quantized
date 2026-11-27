// Fit Y by X oneway leg: ANOVA effect sizes are an extra table beside the
// unchanged F table, and are simply absent for a result that carries none.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import OnewayView from "./OnewayView";
import type { OnewayResult } from "./runLeg";

const base = {
  groups: [{ label: "a", values: [1, 2, 3] }, { label: "b", values: [4, 5, 6] }],
  anova: { fStat: 13.5, df1: 1, df2: 4, pValue: 0.02, reject: true },
  levene: null, tukey: null, recommend: null,
} as unknown as OnewayResult;

describe("OnewayView effect sizes", () => {
  it("shows eta squared, partial eta squared, omega squared and Cohen's f when present", () => {
    const es = { source: "Between", eta_sq: 0.771, partial_eta_sq: 0.771, omega_sq: 0.7, partial_omega_sq: 0.7, cohens_f: 1.838 };
    render(<OnewayView result={{ ...base, anova: { ...base.anova, effectSizes: [es] } } as OnewayResult} />);
    expect(screen.getByText("Effect sizes")).toBeInTheDocument();
    for (const h of ["η²", "partial η²", "ω²", "partial ω²", "Cohen's f"]) expect(screen.getByText(h)).toBeInTheDocument();
    expect(screen.getByText("F")).toBeInTheDocument(); // the default ANOVA table is still there
  });
  it("leaves the display unchanged when the result has no effect sizes", () => {
    render(<OnewayView result={base} />);
    expect(screen.queryByText("Effect sizes")).toBeNull();
    expect(screen.getByText("F")).toBeInTheDocument();
  });
});
