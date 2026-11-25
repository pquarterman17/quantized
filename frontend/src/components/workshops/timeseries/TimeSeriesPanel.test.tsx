import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../../../store/useApp";
import TimeSeriesPanel from "./TimeSeriesPanel";

const api = vi.hoisted(() => ({ tsCorrelogram: vi.fn(), tsStationarity: vi.fn(), tsDecompose: vi.fn(), tsChangepoint: vi.fn(), tsArima: vi.fn() }));
vi.mock("../../../lib/api/timeseries", () => api);
// uPlot needs matchMedia, which jsdom lacks; the plot itself is not under test here.
vi.mock("../SmallUPlot", () => ({ default: ({ label }: { label: string }) => <div data-testid="plot">{label}</div> }));

const N = 40;
const meta = { dt: 1, irregular: false };

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "log.dat", data: { time: Array.from({ length: N }, (_, i) => i), values: Array.from({ length: N }, (_, i) => [Math.sin(i / 3)]),
      labels: ["pressure"], units: [""], metadata: {} } }],
    activeId: "d1", status: "", analysisResults: [], history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual",
  });
  api.tsCorrelogram.mockResolvedValue({ ...meta, n: N, alpha: 0.05, lags: [0, 1], acf: [1, 0.5], pacf: [1, 0.5], white_noise_band: 0.3,
    acf_bartlett_band: [null, 0.3], pacf_band: 0.3, ljung_box: [{ lag: 5, q: 12.5, df: 5, p: 0.03 }] });
  api.tsStationarity.mockResolvedValue({ ...meta, alpha: 0.05, verdict: "stationary: ADF rejects a unit root and KPSS does not reject stationarity",
    adf: { test: "adf", regression: "c", statistic: -4.2, p_value: 0.001, p_bound: "interpolated", lags: 1, n: 39, critical_values: { "5%": -2.9 }, null: "unit root" },
    kpss: { test: "kpss", regression: "c", statistic: 0.1, p_value: 0.1, p_bound: "greater", lags: 3, n: 40, critical_values: { "5%": 0.463 }, null: "stationary" } });
});

describe("TimeSeriesPanel", () => {
  it("asks for a dataset first", () => {
    useApp.setState({ datasets: [], activeId: null });
    render(<TimeSeriesPanel />);
    expect(screen.getByText("Select a dataset to analyse.")).toBeInTheDocument();
  });

  it("runs the ACF/PACF tool and shows the figures and the Ljung-Box table", async () => {
    render(<TimeSeriesPanel />);
    expect(screen.getByRole("button", { name: "Add as worksheet" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText("lag 5")).toBeInTheDocument();
    expect(screen.getAllByTestId("plot")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add as worksheet" })).toBeEnabled();
  });

  it("switches to Stationarity and reads ADF and KPSS together, with a bound for the KPSS p", async () => {
    render(<TimeSeriesPanel />);
    fireEvent.click(screen.getByRole("radio", { name: "Stationarity" }));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText(/^stationary: ADF rejects/)).toBeInTheDocument();
    expect(screen.getByText("> 0.1")).toBeInTheDocument();
    expect(api.tsStationarity).toHaveBeenCalledOnce();
  });

  it("shows the backend's refusal as an alert", async () => {
    api.tsCorrelogram.mockRejectedValue(new Error("the time axis is not evenly spaced"));
    render(<TimeSeriesPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not evenly spaced");
  });
});
