// The palette entries open the right lazy panel through the shared store, and
// several can be open at once.

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAnalysisCommands } from "../../../commands/analysisCommands";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { useApp } from "../../../store/useApp";
import AnalysisExtrasHost from "./AnalysisExtrasHost";

vi.mock("../../../lib/api/analysisExtras", () => ({
  surfaceModels: vi.fn(() => Promise.resolve([])), surfaceGuess: vi.fn(), surfaceFit: vi.fn(), taucFit: vi.fn(), ellipseFit: vi.fn(),
}));

// uPlot needs matchMedia, which jsdom lacks; the plot itself is not under test here.
vi.mock("../SmallUPlot", () => ({ default: () => null }));

beforeEach(() => {
  useAnalysisExtras.setState({ open: [] });
  useApp.setState({ datasets: [], activeId: null });
});

describe("AnalysisExtrasHost", () => {
  it.each([
    ["surface-fit", "Surface fit z = f(x, y)"],
    ["optical-gap", "Optical gap (Tauc plot)"],
    ["ellipse-fit", "Ellipse fit"],
    ["time-series", "Time series"],
    ["spectro-extras", "Spectroscopy extras"],
  ])("%s opens its panel from the palette command and closes with the window", async (id, title) => {
    render(<AnalysisExtrasHost />);
    const cmd = buildAnalysisCommands(useApp.getState).find((c) => c.id === id)!;
    expect(cmd.label).toMatch(/…$/);
    act(() => cmd.run());
    expect(await screen.findByText(title)).toBeInTheDocument();
    act(() => useAnalysisExtras.getState().hide(useAnalysisExtras.getState().open[0]));
    expect(screen.queryByText(title)).not.toBeInTheDocument();
  });

  it("keeps two panels open at once and show() is idempotent", async () => {
    render(<AnalysisExtrasHost />);
    act(() => {
      useAnalysisExtras.getState().show("optical-gap");
      useAnalysisExtras.getState().show("optical-gap");
      useAnalysisExtras.getState().show("ellipse-fit");
    });
    expect(useAnalysisExtras.getState().open).toEqual(["optical-gap", "ellipse-fit"]);
    expect(await screen.findByText("Optical gap (Tauc plot)")).toBeInTheDocument();
    expect(await screen.findByText("Ellipse fit")).toBeInTheDocument();
  });
});
