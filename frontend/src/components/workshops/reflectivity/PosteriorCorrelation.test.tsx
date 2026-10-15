import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportCorrelationHeatmapFigure } from "../../../lib/api";
import { dreamResult } from "./reflFit.testkit";
import PosteriorCorrelation from "./PosteriorCorrelation";
import { DREAM_DEFAULTS, posteriorSummary } from "./reflPosterior";

vi.mock("../../../lib/api", () => ({ exportCorrelationHeatmapFigure: vi.fn() }));

describe("PosteriorCorrelation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reveals the labeled heatmap and highlights strong posterior trade-offs", () => {
    const posterior = posteriorSummary(dreamResult({ correlation: [[1, -0.84], [-0.84, 1]] }),
      DREAM_DEFAULTS, "2026-10-15T00:00:00Z");
    render(<PosteriorCorrelation posterior={posterior} />);
    fireEvent.click(screen.getByText(/Parameter correlation/));
    expect(screen.getByRole("table", { name: "posterior parameter correlation" })).toBeTruthy();
    expect(screen.getByTitle("L1.thickness × background: r=-0.84")).toHaveTextContent("-0.84");
    const strong = screen.getByRole("table", { name: "strong posterior correlations" });
    expect(strong).toHaveTextContent("L1.thickness");
    expect(strong).toHaveTextContent("background");
    expect(strong).toHaveTextContent("-0.84");
  });

  it("guards a fast repeated export click synchronously", async () => {
    let finish!: () => void;
    vi.mocked(exportCorrelationHeatmapFigure).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<PosteriorCorrelation posterior={posteriorSummary(dreamResult(), DREAM_DEFAULTS, "2026-10-15T00:00:00Z")} />);
    fireEvent.click(screen.getByText(/Parameter correlation/));
    const button = screen.getByRole("button", { name: "Export heatmap" });
    fireEvent.click(button); fireEvent.click(button);
    expect(exportCorrelationHeatmapFigure).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole("button", { name: "Export heatmap" })).toBeEnabled());
  });
});
