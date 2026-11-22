// The Spectrogram operation: live preview from the backend (mocked), the
// shared analysis commit contract (one undo step, idempotent), and refusals.

import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct, Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import SignalProcessingPanel from "./SignalProcessingPanel";

vi.mock("../../../lib/api/spectrogram", () => ({ runSpectrogram: vi.fn() }));
vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section>,
}));
const { runSpectrogram } = await import("../../../lib/api/spectrogram");

const N = 64;
const dataset: Dataset = {
  id: "src",
  name: "scope",
  data: {
    time: Array.from({ length: N }, (_, i) => i / 100),
    values: Array.from({ length: N }, (_, i) => [Math.sin(i)]),
    labels: ["V"],
    units: ["mV"],
    metadata: { xUnit: "s" },
  },
};

/** What the backend returns for 3 segments x 9 frequencies (segment length 16). */
function fakeMap(): DataStruct {
  const time: number[] = [];
  const values: number[][] = [];
  for (let s = 0; s < 3; s++) for (let f = 0; f < 9; f++) { time.push(0.08 + s * 0.08); values.push([f * 6.25, s + f]); }
  return {
    time, values, labels: ["Frequency", "V · Spectrogram"], units: ["1/s", "mV²·s"],
    metadata: { spectralAnalysis: { version: 1, operation: "spectrogram", parameters: { segments: 3, frequencies: 9 } } },
  };
}

function setSegment(value: string) {
  fireEvent.change(screen.getByLabelText("Segment length"), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runSpectrogram).mockImplementation(() => Promise.resolve(fakeMap()));
  useApp.setState({ datasets: [dataset], activeId: dataset.id, yKeys: [0], signalProcessingOpen: true, history: [], future: [], analysisResults: [] });
});

function openSpectrogram() {
  render(<SignalProcessingPanel />);
  fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "spectrogram" } });
  setSegment("16");
}

describe("Signal Processing: spectrogram", () => {
  it("previews with the chosen settings and says what the map holds", async () => {
    openSpectrogram();
    fireEvent.change(screen.getByLabelText("Window"), { target: { value: "blackman" } });
    fireEvent.change(screen.getByLabelText("Scaling"), { target: { value: "amplitude" } });
    expect(await screen.findByText(/3 segments × 9 frequencies/)).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(runSpectrogram).mock.calls.at(-1)![0]).toMatchObject({
      channel: 0, segment_len: 16, window: "blackman", overlap: 0.5, scaling: "amplitude", detrend: "mean", resample: false,
    }));
    expect(vi.mocked(runSpectrogram).mock.calls.at(-1)![0].dataset.time).toHaveLength(N);
  });

  it("Add commits the previewed map as one worksheet linked to the source, once, in one undo step", async () => {
    openSpectrogram();
    const add = screen.getByRole("button", { name: "Add as map worksheet" });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    const made = useApp.getState().datasets[1];
    expect(made.name).toBe("scope (spectrogram)");
    expect(made.data.labels).toEqual(["Frequency", "V · Spectrogram"]);
    expect(made.data.time).toHaveLength(27);
    const results = useApp.getState().analysisResults;
    expect(results).toHaveLength(1);
    expect(results[0].producer.id).toBe("signal-spectrogram");
    expect(results[0].outputs[0].datasetId).toBe(made.id);
    // One undo step removes both the worksheet and its result.
    act(() => useApp.getState().undo());
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().analysisResults).toHaveLength(0);
  });

  it("a repeat Add of the same computation is refused with the reason and adds nothing", async () => {
    openSpectrogram();
    const add = screen.getByRole("button", { name: "Add as map worksheet" });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    useApp.setState({ activeId: "src", signalProcessingOpen: true });
    render(<SignalProcessingPanel />);
    const panels = screen.getAllByLabelText("Operation");
    fireEvent.change(panels.at(-1)!, { target: { value: "spectrogram" } });
    fireEvent.change(screen.getAllByLabelText("Segment length").at(-1)!, { target: { value: "16" } });
    const again = screen.getAllByRole("button", { name: "Add as map worksheet" }).at(-1)!;
    await waitFor(() => expect(again).toHaveAttribute("title", expect.stringMatching(/Already added as “scope \(spectrogram\)”/)));
    expect(again).toBeDisabled();
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("refuses a segment longer than the data with a sentence and sends no request", async () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "spectrogram" } });
    // The default segment (256) exceeds the 64 rows.
    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot exceed the 64 rows/);
    expect(screen.getByRole("button", { name: "Add as map worksheet" })).toBeDisabled();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(runSpectrogram).not.toHaveBeenCalled();
  });

  it("refuses an overlap of 100 % and keeps Add disabled", async () => {
    openSpectrogram();
    fireEvent.change(screen.getByLabelText("Overlap"), { target: { value: "100" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/under 100/);
    expect(screen.getByRole("button", { name: "Add as map worksheet" })).toBeDisabled();
  });

  it("surfaces the backend's refusal (uneven X) and keeps Add disabled", async () => {
    vi.mocked(runSpectrogram).mockRejectedValue(new Error("X spacing is not uniform; enable resampling explicitly"));
    openSpectrogram();
    expect(await screen.findByRole("alert")).toHaveTextContent(/not uniform/);
    expect(screen.getByRole("button", { name: "Add as map worksheet" })).toBeDisabled();
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("keeps the column the user picked when the plotted channels change", async () => {
    useApp.setState({
      datasets: [{ ...dataset, data: { ...dataset.data, values: dataset.data.values.map((r) => [r[0], r[0] * 2]), labels: ["V", "W"], units: ["mV", "mV"] } }],
    });
    openSpectrogram();
    fireEvent.change(screen.getByLabelText("Signal column"), { target: { value: "1" } });
    await waitFor(() => expect(vi.mocked(runSpectrogram).mock.calls.at(-1)![0]).toMatchObject({ channel: 1 }));
    act(() => useApp.setState({ yKeys: [0] }));
    act(() => useApp.setState({ yKeys: [0, 1] }));
    expect(screen.getByLabelText("Signal column")).toHaveValue("1");
  });

  it("resampling is an explicit option, off until ticked", async () => {
    openSpectrogram();
    await screen.findByText(/3 segments/);
    expect(vi.mocked(runSpectrogram).mock.calls.at(-1)![0]).toMatchObject({ resample: false });
    fireEvent.click(screen.getByLabelText(/Resample an uneven/));
    await waitFor(() => expect(vi.mocked(runSpectrogram).mock.calls.at(-1)![0]).toMatchObject({ resample: true }));
  });
});
