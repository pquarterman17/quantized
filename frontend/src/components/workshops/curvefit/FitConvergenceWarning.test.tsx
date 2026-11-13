import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import FitConvergenceWarning from "./FitConvergenceWarning";

describe("FitConvergenceWarning", () => {
  it("warns when the optimizer returned exitFlag=0", () => {
    render(<FitConvergenceWarning result={{ exitFlag: 0, params: [1] }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Fit did not converge");
  });

  it("lists the fitter's own warnings, such as a stalled parameter", () => {
    const stalled = "parameter 2 never moved from its start value 1 although the fit residual still falls along it";
    render(<FitConvergenceWarning result={{ exitFlag: 0, warnings: [stalled, 3] }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(stalled);
  });

  it("stays absent for successful or legacy result payloads", () => {
    const { rerender } = render(<FitConvergenceWarning result={{ exitFlag: 1 }} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(<FitConvergenceWarning result={{ params: [1] }} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
