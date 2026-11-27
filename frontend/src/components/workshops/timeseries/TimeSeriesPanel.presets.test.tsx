// Preset bar acceptance (plans/PRESET_BAR_CONTRACT.md section 9, P5), through
// the real Time series panel, hook and storage: save, change, Apply restores
// the tool and options and the next Run request carries them, Revert works after
// two Applies, a missing series is skipped and named, a rejected record cannot
// be applied, last used is written by a successful Run only, and every option
// the forms offer is accepted by the adapter.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
import { setWorkflowPrefs } from "../../../lib/workflowPrefsEdit";
import { useToolResultRequest } from "../../../store/toolResultRequest";
import { useApp } from "../../../store/useApp";
import { createTimeSeriesAdapter } from "./presetAdapter";
import { ARIMA_TREND_OPTIONS, CP_COST_OPTIONS, CP_METHOD_OPTIONS, CP_PENALTY_OPTIONS, DECOMP_MODEL_OPTIONS, STAT_REGRESSION_OPTIONS, STAT_TESTS_OPTIONS } from "./timeSeriesOptions";
import { tsDefaultOptions } from "./timeSeriesRun";
import TimeSeriesPanel from "./TimeSeriesPanel";

const api = vi.hoisted(() => ({ tsCorrelogram: vi.fn(), tsStationarity: vi.fn(), tsDecompose: vi.fn(), tsChangepoint: vi.fn(), tsArima: vi.fn() }));
vi.mock("../../../lib/api/timeseries", () => api);
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));
vi.mock("../SmallUPlot", () => ({ default: ({ label }: { label: string }) => <div data-testid="plot">{label}</div> }));

const N = 40;
const ARIMA = { dt: 1, irregular: false, order: [2, 0, 0], trend: "c", n: N, params: [], sigma2: 1, loglik: -10, aic: 1, bic: 2, alpha: 0.05, fitted: [], residual: [], notes: [] };

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  setWorkflowPrefs({ startFromLastUsed: false });
  vi.clearAllMocks();
  useToolResultRequest.setState({ timeSeries: null });
  useApp.setState({
    datasets: [{ id: "d1", name: "log.dat", data: { time: Array.from({ length: N }, (_, i) => i), values: Array.from({ length: N }, (_, i) => [Math.sin(i / 3), Math.cos(i / 5)]),
      labels: ["pressure", "temperature"], units: ["", ""], metadata: {} } }],
    activeId: "d1", status: "", analysisResults: [], history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual",
  });
  api.tsArima.mockResolvedValue(ARIMA);
  api.tsCorrelogram.mockResolvedValue({ dt: 1, irregular: false, n: N, alpha: 0.05, lags: [0, 1], acf: [1, 0.5], pacf: [1, 0.5], white_noise_band: 0.3, acf_bartlett_band: [null, 0.3], pacf_band: 0.3, ljung_box: [] });
});

const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "Time series presets" })).getByRole("status").textContent ?? "";
const tab = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));
const series = () => screen.getByRole("combobox", { name: "Series" }) as HTMLSelectElement;
const num = (label: string, v: string) => { const f = screen.getByLabelText(label); fireEvent.change(f, { target: { value: v } }); fireEvent.blur(f); };
const val = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
function savePreset(name: string) {
  press("Save as…");
  fireEvent.change(screen.getByRole("textbox", { name: "Preset name" }), { target: { value: name } });
  press("Save");
}
function pick(label: string) {
  const opt = within(select()).getAllByRole("option").find((o) => o.textContent?.startsWith(label));
  if (!opt) throw new Error(`no option ${label}`);
  fireEvent.change(select(), { target: { value: (opt as HTMLOptionElement).value } });
}
async function ready() {
  render(<TimeSeriesPanel />);
  await screen.findByRole("region", { name: "Time series presets" });
}
const pickerValues = (name: string) => within(screen.getByRole("combobox", { name })).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);

describe("Time series preset bar", () => {
  it("saves, changes, Applies: the tool and options return and the next Run carries them", async () => {
    await ready();
    fireEvent.change(series(), { target: { value: "1" } });
    tab("ARIMA");
    num("p (AR)", "2");
    num("Forecast steps", "15");
    savePreset("AR(2) temp");
    expect(status()).toBe("Saved preset 'AR(2) temp'");
    tab("ACF / PACF");
    fireEvent.change(series(), { target: { value: "0" } });
    pick("AR(2) temp");
    press("Apply");
    expect(status()).toContain("Applied preset 'AR(2) temp' to Time series: press Run to run it");
    expect(screen.getByRole("radio", { name: "ARIMA" })).toBeChecked();
    expect(series().value).toBe("1");
    expect(val("p (AR)")).toBe("2");
    expect(val("Forecast steps")).toBe("15");
    expect(api.tsArima).not.toHaveBeenCalled();
    expect(readLastUsed("time-series")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(readLastUsed("time-series")).not.toBeNull()); // the run finished
    expect(api.tsArima).toHaveBeenCalledWith(expect.objectContaining({ p: 2, steps: 15 }));
    cleanup();
    render(<TimeSeriesPanel />);
    await screen.findByRole("region", { name: "Time series presets" });
    expect(within(select()).getByRole("option", { name: "AR(2) temp" })).toBeTruthy();
  });

  it("Revert restores the hand-set tool and options after two Applies", async () => {
    await ready();
    tab("ARIMA");
    num("p (AR)", "1");
    savePreset("P1");
    num("p (AR)", "3");
    savePreset("P3");
    tab("Decompose");
    pick("P1");
    press("Apply");
    pick("P3");
    press("Apply");
    expect(screen.getByRole("radio", { name: "ARIMA" })).toBeChecked();
    expect(val("p (AR)")).toBe("3");
    press("Revert");
    expect(screen.getByRole("radio", { name: "Decompose" })).toBeChecked();
  });

  it("a series label missing on this sheet is skipped and named by its label, the rest applies", async () => {
    const adapter = createTimeSeriesAdapter({ columns: [{ index: 0, label: "x" }], col: 0, setCol: () => undefined, tab: "correlogram", setTab: () => undefined, opts: tsDefaultOptions(), patch: () => undefined });
    const settings = { ...adapter.defaults(), tab: "arima", series: "Pressure (torr)" };
    localStorage.setItem("qz.presets", JSON.stringify({ version: 1, presets: [{ id: "p1:x", workshop: "time-series", name: "Elsewhere", schema: 1, createdAt: "t", updatedAt: "t", settings }] }));
    await ready();
    pick("Elsewhere");
    press("Apply");
    expect(status()).toContain("Series skipped (column 'Pressure (torr)' is not on this sheet)");
    expect(screen.getByRole("radio", { name: "ARIMA" })).toBeChecked();
    expect(series().value).toBe("0");
  });

  it("a preset with a bad value is listed rejected with the field named and cannot be applied", async () => {
    const adapter = createTimeSeriesAdapter({ columns: [{ index: 0, label: "pressure" }], col: 0, setCol: () => undefined, tab: "correlogram", setTab: () => undefined, opts: tsDefaultOptions(), patch: () => undefined });
    const good = adapter.defaults();
    const settings = { ...good, arima: { ...good.arima, p: 12 } };
    localStorage.setItem("qz.presets", JSON.stringify({ version: 1, presets: [{ id: "p1:x", workshop: "time-series", name: "Broken", schema: 1, createdAt: "t", updatedAt: "t", settings }] }));
    await ready();
    expect(within(select()).getByRole("option", { name: /Broken — rejected: setting 'arima' is not valid: setting 'p'/ })).toBeTruthy();
    pick("Broken");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("last used is written by a successful Run, not by Apply, edits or a failed Run", async () => {
    await ready();
    tab("ARIMA");
    num("p (AR)", "2");
    expect(readLastUsed("time-series")).toBeNull();
    api.tsArima.mockRejectedValueOnce(new Error("did not converge"));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("did not converge");
    expect(readLastUsed("time-series")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(readLastUsed("time-series")).not.toBeNull());
    expect(readLastUsed("time-series")?.settings).toMatchObject({ tab: "arima", series: "pressure", arima: { p: 2 } });
  });

  it("a panel opened from a saved result applies the result, not last used, even with the opt-in on", async () => {
    setWorkflowPrefs({ startFromLastUsed: true });
    const adapter = createTimeSeriesAdapter({ columns: [{ index: 0, label: "pressure" }], col: 0, setCol: () => undefined, tab: "correlogram", setTab: () => undefined, opts: tsDefaultOptions(), patch: () => undefined });
    lastUsedSlot.save({ "time-series": { schema: 1, at: "2026-11-27T10:00:00.000Z", settings: { ...adapter.defaults(), tab: "decompose" } } });
    useToolResultRequest.setState({ timeSeries: { tool: "stationarity", col: 0, allowIrregular: false, options: { tests: "adf", regression: "c", alpha: 0.05 } } });
    render(<TimeSeriesPanel />);
    await screen.findByRole("region", { name: "Time series presets" });
    await waitFor(() => expect(screen.getByRole("radio", { name: "Stationarity" })).toBeChecked());
    expect(screen.getByText(/Settings: the reopened result/)).toBeInTheDocument();
  });

  it("every option the forms offer is the adapter's own list", async () => {
    await ready();
    tab("Stationarity");
    expect(pickerValues("Tests")).toEqual(STAT_TESTS_OPTIONS.map((o) => o.value));
    expect(pickerValues("Deterministic part")).toEqual(STAT_REGRESSION_OPTIONS.map((o) => o.value));
    tab("Decompose");
    expect(pickerValues("Model")).toEqual(DECOMP_MODEL_OPTIONS.map((o) => o.value));
    tab("Change points");
    expect(pickerValues("Method")).toEqual(CP_METHOD_OPTIONS.map((o) => o.value));
    expect(pickerValues("Change in")).toEqual(CP_COST_OPTIONS.map((o) => o.value));
    expect(pickerValues("Penalty")).toEqual(CP_PENALTY_OPTIONS.map((o) => o.value));
    tab("ARIMA");
    expect(pickerValues("Constant")).toEqual(ARIMA_TREND_OPTIONS.map((o) => o.value));
  });
});
