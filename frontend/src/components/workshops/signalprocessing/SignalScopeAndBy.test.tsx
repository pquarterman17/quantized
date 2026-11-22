// Signal Processing "By" (per level of a categorical column) and the batch over
// selected worksheets, both running the panel's configured operation.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections } from "../../../lib/api";
import { runSpectralWorkbench } from "../../../lib/api/spectralWorkbench";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { DataStruct, Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import { DEFAULT_SIGNAL_SETTINGS } from "./signalProcessingModel";
import { signalSummary } from "./signalRun";
import SignalScopeAndBy from "./SignalScopeAndBy";
import { DEFAULT_SPECTRAL_SETTINGS } from "./spectralSettings";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: register }));
vi.mock("../../../lib/api", () => ({ applyCorrections: vi.fn(), fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/spectralWorkbench", () => ({ runSpectralWorkbench: vi.fn() }));

const out = (mean: number): DataStruct => ({ time: [0, 1], values: [[mean], [mean]], labels: ["Signal"], units: [""], metadata: {} });
// Column 0 = Group (two levels of six rows), column 1 = Signal.
const sheet = (id: string, base: number): Dataset => ({
  id, name: `${id}.csv`,
  data: {
    time: Array.from({ length: 12 }, (_, i) => i),
    values: Array.from({ length: 12 }, (_, i) => [i < 6 ? 0 : 1, base + (i < 6 ? 1 : 11) + (i % 6)]),
    labels: ["Group", "Signal"], units: ["", "cps"], metadata: {},
  },
});

const props = { secondary: null, settings: DEFAULT_SIGNAL_SETTINGS, spectral: DEFAULT_SPECTRAL_SETTINGS, channels: [1], sigopFilter: false, crossWorksheet: false, validation: "" };
const mount = (over: Partial<Parameters<typeof SignalScopeAndBy>[0]> = {}) =>
  render(<SignalScopeAndBy source={useApp.getState().datasets[0]!} {...props} {...over} />);
const pickGroup = () => fireEvent.change(screen.getByLabelText(/Signal processing By \(optional\)/), { target: { value: "0" } });
const byRows = () => within(screen.getAllByRole("table").at(-1)!).getAllByRole("row").slice(1);

beforeEach(() => {
  vi.clearAllMocks();
  const datasets = [sheet("a", 0), sheet("b", 100)];
  useApp.setState({
    datasets, activeId: "a", selectedIds: ["a", "b"], xKey: null, yKeys: [1], seriesOrder: null,
    analysisResults: [], history: [], future: [], resolveDataset: async (id: string) => datasets.find((d) => d.id === id),
  });
  useAnalysisSelection.setState({
    toolId: "signal-processing",
    selection: captureAnalysisSelection({
      datasets, activeId: "a", selectedIds: ["a", "b"], xKey: null, yKeys: [1],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library"),
  });
  usePendingOps.setState({ ops: [] });
});

describe("Signal Processing By", () => {
  it("runs the configured correction on each level's rows", async () => {
    vi.mocked(applyCorrections).mockImplementation(async ({ dataset }) => out(dataset.values[0]![1]!) as never);
    mount();
    pickGroup();
    await waitFor(() => expect(byRows()).toHaveLength(2));
    const sent = vi.mocked(applyCorrections).mock.calls.map(([req]) => req.dataset.values.map((r) => r[1]));
    expect(sent).toEqual([[1, 2, 3, 4, 5, 6], [11, 12, 13, 14, 15, 16]]);
    expect(within(byRows()[1]!).getAllByRole("cell")[4]).toHaveTextContent("11");
  });

  it("runs the spectral workbench per level for a spectral operation", async () => {
    vi.mocked(runSpectralWorkbench).mockResolvedValue(out(5) as never);
    mount({ settings: { ...DEFAULT_SIGNAL_SETTINGS, operation: "fft" } });
    pickGroup();
    await waitFor(() => expect(byRows()).toHaveLength(2));
    expect(runSpectralWorkbench).toHaveBeenCalledTimes(2);
    expect(applyCorrections).not.toHaveBeenCalled();
  });

  it("shows the blocking reason instead of running", async () => {
    mount({ validation: "Select at least one signal column." });
    pickGroup();
    await waitFor(() => expect(byRows()[0]).toHaveTextContent("Select at least one signal column."));
    expect(applyCorrections).not.toHaveBeenCalled();
  });

  it("summarises an all-gap output as an error, not zeros", () => {
    expect(() => signalSummary({ time: [0], values: [[NaN]], labels: ["a"], units: [""], metadata: {} })).toThrow(/no finite output/);
  });
});

describe("Signal Processing batch", () => {
  it("runs the operation on every selected worksheet's own channel and records one table", async () => {
    vi.mocked(applyCorrections).mockImplementation(async ({ dataset }) => out(dataset.values[0]![1]!) as never);
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Run .* batch$/ }));
    await waitFor(() => expect(screen.getAllByText("Completed")).toHaveLength(2));
    expect(register).toHaveBeenCalledOnce();
    expect(vi.mocked(applyCorrections).mock.calls.map(([req]) => req.dataset.values[0]![1])).toEqual([1, 101]);
    const result = register.mock.calls[0]![0];
    expect(result.parameters).toMatchObject({ toolId: "signal-processing", operation: "smooth" });
    expect(result.tables[0].rows).toEqual([
      ["a.csv", "Completed", 12, 2, 2, 1, null],
      ["b.csv", "Completed", 12, 2, 2, 101, null],
    ]);
  });

  it("does not run when the setup is blocked, and says why", () => {
    mount({ validation: "Smoothing half-window must be a positive integer." });
    expect(screen.getByText("Smoothing half-window must be a positive integer.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    expect(screen.getByRole("button", { name: /^Run .* batch$/ })).toBeDisabled();
  });

  it("drops the finished table when the operation's settings change", async () => {
    vi.mocked(applyCorrections).mockImplementation(async ({ dataset }) => out(dataset.values[0]![1]!) as never);
    const { rerender } = mount();
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Run .* batch$/ }));
    await waitFor(() => expect(screen.getAllByText("Completed")).toHaveLength(2));
    const source = useApp.getState().datasets[0]!;
    rerender(<SignalScopeAndBy source={source} {...props} settings={{ ...DEFAULT_SIGNAL_SETTINGS }} />);
    expect(screen.getAllByText("Completed")).toHaveLength(2); // same settings: kept
    rerender(<SignalScopeAndBy source={source} {...props} settings={{ ...DEFAULT_SIGNAL_SETTINGS, smoothWindow: 9 }} />);
    expect(screen.queryByText("Completed")).toBeNull();
    expect(screen.getAllByText("Ready")).toHaveLength(2);
    expect(register).toHaveBeenCalledOnce();
  });
});
