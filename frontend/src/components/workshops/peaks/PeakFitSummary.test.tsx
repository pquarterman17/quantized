import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PeakFitSummary from "./PeakFitSummary";
import type { MultiFitResult } from "../../../lib/peakTable";

const fit = (over: Partial<MultiFitResult>): MultiFitResult => ({
  peaks: [], bgCoeffs: [], R2: 0.99768, rmse: 19.9, nPeaks: 5, model: "Lorentzian",
  solver: "nelder-mead+trf", converged: true, noiseSigma: 12.1, ...over,
});

const statusOf = (container: HTMLElement) => container.querySelector("[data-fit-status]");

describe("PeakFitSummary (UX audit 9 #3)", () => {
  it("shows a converged, good fit in the ok tone", () => {
    const { container } = render(<PeakFitSummary metrics={fit({})} paired={false} peakTable={null}
      modelFit={false} edited={0} excluded={0} />);
    expect(statusOf(container)).toHaveAttribute("data-fit-status", "ok");
    expect(screen.getByText(/Converged · ± 1σ from the fit covariance/)).toBeInTheDocument();
  });

  it("warns on the audit's R² 0.94 fit (a deliberately bad seed's outcome)", () => {
    const { container } = render(<PeakFitSummary metrics={fit({ R2: 0.941639, rmse: 100.009 })} paired={false}
      peakTable={null} modelFit={false} edited={0} excluded={0} />);
    expect(statusOf(container)).toHaveAttribute("data-fit-status", "warn");
    expect(screen.getByText(/^Poor fit \(R² below 0\.98, RMSE over 3× noise\)/)).toBeInTheDocument();
  });

  it("warns when the polish did not converge", () => {
    const { container } = render(<PeakFitSummary metrics={fit({ converged: false })} paired={false}
      peakTable={null} modelFit={false} edited={0} excluded={0} />);
    expect(statusOf(container)).toHaveAttribute("data-fit-status", "warn");
    expect(screen.getByText(/^Did not converge/)).toBeInTheDocument();
  });

  it("judges nothing for a fit that recorded no quality (legacy) or a model fit", () => {
    const { container } = render(<PeakFitSummary metrics={fit({ solver: undefined, R2: 0.5 })} paired={false}
      peakTable={null} modelFit={false} edited={0} excluded={0} />);
    expect(statusOf(container)).toBeNull();
    const second = render(<PeakFitSummary metrics={fit({})} paired={false} peakTable={null}
      modelFit edited={0} excluded={0} />);
    expect(statusOf(second.container)).toBeNull();
  });
});
