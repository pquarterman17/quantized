import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../../../store/useApp";
import SpectroExtrasPanel from "./SpectroExtrasPanel";

const api = vi.hoisted(() => ({ spectroFsd: vi.fn(), spectroCorr2d: vi.fn(), spectroOnset: vi.fn() }));
vi.mock("../../../lib/api/spectroExtras", () => api);
// uPlot needs matchMedia, which jsdom lacks; the plot itself is not under test here.
vi.mock("../SmallUPlot", () => ({ default: ({ label }: { label: string }) => <div data-testid="plot">{label}</div> }));

const N = 24;
const x = Array.from({ length: N }, (_, i) => i * 0.5);

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "raman.dat", data: { time: x, values: x.map((v) => [Math.sin(v), Math.cos(v)]), labels: ["a", "b"], units: ["", ""], metadata: {} } }],
    activeId: "d1", status: "", analysisResults: [], history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual",
  });
  api.spectroFsd.mockResolvedValue({ y: x.map(() => 1), info: { apodization: "triangular", hwhm: 1, k: 1.5, cutoff: 0.5, k_max: 3, fwhm_in: 2, fwhm_out: 1.3, noise_gain: 4 } });
});

describe("SpectroExtrasPanel", () => {
  it("asks for a dataset first", () => {
    useApp.setState({ datasets: [], activeId: null });
    render(<SpectroExtrasPanel />);
    expect(screen.getByText("Select a dataset to analyse.")).toBeInTheDocument();
  });

  it("runs self-deconvolution and shows the plot and the summary", async () => {
    render(<SpectroExtrasPanel />);
    expect(screen.getByRole("button", { name: "Add as worksheet" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText(/noise gain/)).toBeInTheDocument();
    expect(screen.getAllByTestId("plot")).toHaveLength(1);
    expect(api.spectroFsd).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Add as worksheet" })).toBeEnabled();
  });

  it("explains why 2-D correlation cannot run with two spectra", () => {
    render(<SpectroExtrasPanel />);
    fireEvent.click(screen.getByRole("radio", { name: "2-D correlation" }));
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getAllByText(/at least 3 spectra/).length).toBeGreaterThan(0);
  });

  it("shows the backend's refusal as an alert", async () => {
    api.spectroFsd.mockRejectedValue(new Error("K = 1.5 is too large for this sampling"));
    render(<SpectroExtrasPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("too large");
  });

  it("unticking a column drops it from the request", async () => {
    render(<SpectroExtrasPanel />);
    fireEvent.click(screen.getByRole("checkbox", { name: "b" }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText(/noise gain/);
    expect(api.spectroFsd).toHaveBeenCalledTimes(1);
  });
});
