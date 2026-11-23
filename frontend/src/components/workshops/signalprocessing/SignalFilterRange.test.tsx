// A1: the filter operations and the spectrogram share the workbench's X-range and
// Save recipe controls. Controls present; the range reaches the backend request;
// the recorded result inputs say the range actually used; a saved recipe
// round-trips through the Recipe Library and a reloaded recipe replays with the
// same range.

import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SigopRequest, SigopResult } from "../../../lib/api/sigop";
import { sanitizeAnalysisResults } from "../../../lib/analysisResult";
import { loadTemplates } from "../../../lib/template";
import { computeTransform, transformParamsOf } from "../../../lib/transformRun";
import type { DataStruct, Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import SignalProcessingPanel from "./SignalProcessingPanel";

const { askParamsMock } = vi.hoisted(() => ({ askParamsMock: vi.fn() }));
vi.mock("../../../lib/api/sigop", () => ({ sigopDataset: vi.fn() }));
vi.mock("../../../lib/api/spectrogram", () => ({ runSpectrogram: vi.fn() }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: askParamsMock }));
vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section>,
}));
const { sigopDataset } = await import("../../../lib/api/sigop");
const { runSpectrogram } = await import("../../../lib/api/spectrogram");

const N = 64;
const dataset: Dataset = {
  id: "src",
  name: "scope",
  data: {
    time: Array.from({ length: N }, (_, i) => i),
    values: Array.from({ length: N }, (_, i) => [Math.sin(i)]),
    labels: ["V"],
    units: ["mV"],
    metadata: { xUnit: "s" },
  },
};

/** The backend's trim, mimicked: only the rows with xMin <= X <= xMax come back. */
function fakeSigop(body: SigopRequest): Promise<SigopResult> {
  const { time, values } = body.dataset;
  const lo = Number(body.args?.xMin ?? -Infinity);
  const hi = Number(body.args?.xMax ?? Infinity);
  const rows = time.map((_, i) => i).filter((i) => time[i] >= lo && time[i] <= hi);
  return Promise.resolve({
    dataset: { ...body.dataset, time: rows.map((i) => time[i]), values: rows.map((i) => values[i]), labels: ["V · median(5)"], cat_levels: undefined, level_order: undefined },
    warnings: [], flagged: {}, rows_in: time.length, rows_out: rows.length,
  });
}

function fakeMap(): DataStruct {
  return {
    time: [0, 0], values: [[0, 1], [6, 2]], labels: ["Frequency", "V · Spectrogram"], units: ["1/s", "mV²·s"],
    metadata: { spectralAnalysis: { version: 1, operation: "spectrogram", parameters: { segments: 1, frequencies: 2 } } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(sigopDataset).mockImplementation(fakeSigop);
  vi.mocked(runSpectrogram).mockImplementation(() => Promise.resolve(fakeMap()));
  askParamsMock.mockResolvedValue({ name: "Range recipe" });
  useApp.setState({ datasets: [dataset], activeId: dataset.id, yKeys: [0], signalProcessingOpen: true, history: [], future: [], analysisResults: [] });
});

function setRange(lo: string, hi: string) {
  fireEvent.click(screen.getByRole("checkbox", { name: "Limit output to an X range" }));
  fireEvent.change(screen.getByLabelText("X minimum"), { target: { value: lo } });
  fireEvent.change(screen.getByLabelText("X maximum"), { target: { value: hi } });
}

describe("filter operations: X range and Save recipe", () => {
  it("shows both controls, starting at the worksheet's own extent", () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "median" } });
    expect(screen.getByRole("checkbox", { name: "Limit output to an X range" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save recipe…" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Limit output to an X range" }));
    expect(screen.getByLabelText("X minimum")).toHaveValue("0");
    expect(screen.getByLabelText("X maximum")).toHaveValue("63");
  });

  it("sends no range by default (unchanged request) and sends xMin / xMax once it is on", async () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "median" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Create worksheet" })).toBeEnabled()); // the preview resolved
    expect(vi.mocked(sigopDataset).mock.calls.at(-1)![0].args).toEqual({ window: 5 });
    setRange("10", "20");
    await waitFor(() => expect(vi.mocked(sigopDataset).mock.calls.at(-1)![0].args).toEqual({ window: 5, xMin: 10, xMax: 20 }));
    expect(await screen.findByText(/11 of 64 input rows fall inside it/)).toBeInTheDocument();
  });

  it("refuses a reversed range with a sentence and sends nothing for it", async () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "median" } });
    setRange("30", "20");
    expect(await screen.findByRole("alert")).toHaveTextContent(/finite and increasing/);
    expect(screen.getByRole("button", { name: "Create worksheet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save recipe…" })).toBeDisabled();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(vi.mocked(sigopDataset).mock.calls.some(([body]) => body.args?.xMin === 30)).toBe(false);
  });

  it("records the X range actually used on the committed result's inputs", async () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "median" } });
    setRange("10", "20");
    const create = screen.getByRole("button", { name: "Create worksheet" });
    await waitFor(() => expect(create).toBeEnabled());
    await waitFor(() => expect(vi.mocked(sigopDataset).mock.calls.at(-1)![0].args?.xMin).toBe(10));
    fireEvent.click(create);
    await waitFor(() => expect(useApp.getState().analysisResults).toHaveLength(1));
    const made = useApp.getState().datasets[1]!;
    expect(made.data.time).toHaveLength(11);
    const result = useApp.getState().analysisResults[0]!;
    const item = (result.parameters as { inputs: { items: Record<string, unknown>[] } }).inputs.items[0]!;
    expect(item).toMatchObject({ rows: 64, includedRows: 11, xRange: [10, 20] });
    // Reopen (save -> load): the record survives the workspace round trip.
    const reloaded = sanitizeAnalysisResults(JSON.parse(JSON.stringify([result])));
    expect((reloaded[0]!.parameters as { inputs: { items: Record<string, unknown>[] } }).inputs.items[0]).toMatchObject({ includedRows: 11, xRange: [10, 20] });
  });

  it("without a range the recorded input is the whole worksheet, as before", async () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "median" } });
    const create = screen.getByRole("button", { name: "Create worksheet" });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() => expect(useApp.getState().analysisResults).toHaveLength(1));
    const item = (useApp.getState().analysisResults[0]!.parameters as { inputs: { items: Record<string, unknown>[] } }).inputs.items[0]!;
    expect(item).toMatchObject({ includedRows: 64, xRange: [0, 63] });
  });

  it("Save recipe stores the range, a reloaded recipe keeps it and replays with it", async () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "despike" } });
    setRange("5", "40");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save recipe…" })).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save recipe…" }));
      await Promise.resolve();
    });
    // The Recipe Library (localStorage) is the round trip: read it back as a fresh session would.
    const saved = loadTemplates().find((t) => t.name === "Range recipe");
    expect(saved).toBeTruthy();
    const step = saved!.steps[0]!;
    expect(step.kind).toBe("transform");
    expect(step.params).toMatchObject({ op: "sigop", method: "despike", channels: [0], args: { window: 5, threshold: 5, xMin: 5, xMax: 40 } });
    // Replay (what Apply to selected sheets runs) sends the same range.
    vi.mocked(sigopDataset).mockClear();
    await computeTransform(transformParamsOf(step.params), dataset, []);
    expect(vi.mocked(sigopDataset).mock.calls[0]![0].args).toMatchObject({ xMin: 5, xMax: 40 });
  });

  it("the inverse FFT and Reduce XY have no range control", () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "ifft" } });
    expect(screen.queryByRole("checkbox", { name: "Limit output to an X range" })).toBeNull();
  });
});

describe("spectrogram: X range and Save recipe", () => {
  function openSpectrogram() {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "spectrogram" } });
    fireEvent.change(screen.getByLabelText("Segment length"), { target: { value: "16" } });
  }

  it("shows both controls and sends no range by default", async () => {
    openSpectrogram();
    expect(screen.getByRole("checkbox", { name: "Limit output to an X range" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save recipe…" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add as map worksheet" })).toBeEnabled()); // the preview resolved
    const body = vi.mocked(runSpectrogram).mock.calls.at(-1)![0];
    expect(body).not.toHaveProperty("x_min");
    expect(body).not.toHaveProperty("x_max");
  });

  it("sends x_min / x_max, checks the segment against the rows inside the range, and records the range", async () => {
    openSpectrogram();
    setRange("0", "9");
    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot exceed the 10 rows available/);
    fireEvent.change(screen.getByLabelText("X minimum"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("X maximum"), { target: { value: "47" } });
    await waitFor(() => expect(vi.mocked(runSpectrogram).mock.calls.at(-1)![0]).toMatchObject({ x_min: 8, x_max: 47, segment_len: 16 }));
    const add = screen.getByRole("button", { name: "Add as map worksheet" });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    await waitFor(() => expect(useApp.getState().analysisResults).toHaveLength(1));
    const item = (useApp.getState().analysisResults[0]!.parameters as { inputs: { items: Record<string, unknown>[] } }).inputs.items[0]!;
    expect(item).toMatchObject({ includedRows: 40, xRange: [8, 47] });
  });

  it("Save recipe stores a replayable spectrogram step with the range", async () => {
    openSpectrogram();
    setRange("8", "47");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save recipe…" })).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save recipe…" }));
      await Promise.resolve();
    });
    const step = loadTemplates().find((t) => t.name === "Range recipe")!.steps[0]!;
    expect(step.params).toMatchObject({ op: "spectrogram", channel: 0, segment_len: 16, overlap: 0.5, xMin: 8, xMax: 47 });
    vi.mocked(runSpectrogram).mockClear();
    const out = await computeTransform(transformParamsOf(step.params), dataset, []);
    expect(vi.mocked(runSpectrogram).mock.calls[0]![0]).toMatchObject({ x_min: 8, x_max: 47, segment_len: 16 });
    expect(out.name).toBe("scope (spectrogram)");
  });

  it("a recorded spectrogram step with a bad range is refused on load", () => {
    expect(() => transformParamsOf({ op: "spectrogram", channel: 0, segment_len: 16, window: "hann", overlap: 0.5, scaling: "psd", detrend: "mean", resample: false, xMin: 9, xMax: 3 })).toThrow(/X minimum/);
  });
});
