// The wavelet methods in the Signal Processing panel: availability gate (the
// optional PyWavelets extra), the scalogram preview, the denoise notes, and
// Create recording a sigop transform.

import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SigopRequest, SigopResult } from "../../../lib/api/sigop";
import { resetWaveletsStatus } from "../../../lib/api/wavelets";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import SignalProcessingPanel from "./SignalProcessingPanel";

vi.mock("../../../lib/api/sigop", () => ({ sigopDataset: vi.fn() }));
vi.mock("../../../lib/api/wavelets", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api/wavelets")>()),
  waveletsStatus: vi.fn(),
}));
vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section>,
}));
const { sigopDataset } = await import("../../../lib/api/sigop");
const { waveletsStatus } = await import("../../../lib/api/wavelets");

const dataset: Dataset = {
  id: "src",
  name: "tone.dat",
  data: {
    time: [0, 1, 2, 3, 4, 5, 6, 7],
    values: [[0], [1], [0], [-1], [0], [1], [0], [-1]],
    labels: ["V"],
    units: ["mV"],
    metadata: { xUnit: "s" },
  },
};

/** A 3 x 2 scalogram map (3 frequencies by 2 points), rows y-outer. */
function fake(body: SigopRequest): Promise<SigopResult> {
  if (body.method === "cwt") {
    const rows = [0, 1].length * 3;
    return Promise.resolve({
      dataset: {
        time: [0, 1, 0, 1, 0, 1],
        values: [[0, 1, 0.1], [1, 1, 0.2], [0, 2, 0.5], [1, 2, 0.4], [0, 4, 0.9], [1, 4, 0.8]],
        labels: ["X", "Frequency", "Intensity"], units: ["s", "1/s", "mV"],
        metadata: { is2D: true, map_grid: "native", map_shape: [3, 2] },
      },
      warnings: [], flagged: {}, rows_in: body.dataset.time.length, rows_out: rows,
    });
  }
  return Promise.resolve({
    dataset: { ...body.dataset, labels: ["V · wavelet denoise"], cat_levels: undefined, level_order: undefined },
    warnings: ["V: noise σ = 0.12 (finest level); thresholds D1 0.4."],
    flagged: {}, rows_in: body.dataset.time.length, rows_out: body.dataset.time.length,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetWaveletsStatus();
  vi.mocked(sigopDataset).mockImplementation(fake);
  vi.mocked(waveletsStatus).mockResolvedValue({ available: true, reason: "" });
  useApp.setState({ datasets: [dataset], activeId: dataset.id, yKeys: [0], signalProcessingOpen: true, history: [], future: [] });
});

describe("Signal Processing: wavelets", () => {
  it("CWT previews the scalogram and requests the documented defaults", async () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "cwt" } });
    expect(await screen.findByRole("img", { name: "Scalogram preview" })).toBeInTheDocument();
    expect(screen.getByText(/2 points × 3 frequency rows/)).toBeInTheDocument();
    expect(vi.mocked(sigopDataset).mock.calls.at(-1)![0]).toMatchObject({
      method: "cwt", channels: [0], args: { wavelet: "morlet", axis: "frequency", count: 64, output: "scalogram" },
    });
  });

  it("denoise lists the noise estimate and Create records a sigop step", async () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "wavelet-denoise" } });
    expect(await screen.findByText(/noise σ = 0.12/)).toBeInTheDocument();
    const create = screen.getByRole("button", { name: "Create worksheet" });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    expect(useApp.getState().datasets[1].name).toBe("tone (wavelet denoised)");
  });

  it("level checkboxes edit the recorded levels", async () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "wavelet-smooth" } });
    fireEvent.click(await screen.findByLabelText("Detail level 2"));
    await waitFor(() => expect(vi.mocked(sigopDataset).mock.calls.at(-1)![0].args).toMatchObject({ zero: "1,2" }));
  });

  it("the Origin cutoff and percent rule are sent through the panel", async () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "wavelet-smooth" } });
    fireEvent.change(await screen.findByLabelText("Edge extension"), { target: { value: "origin-periodic" } });
    fireEvent.change(screen.getByLabelText("Origin cutoff (% of detail coefficients)"), { target: { value: "40" } });
    await waitFor(() => expect(vi.mocked(sigopDataset).mock.calls.at(-1)![0].args).toMatchObject({ mode: "origin-periodic", cutoff: 40 }));
    expect(vi.mocked(sigopDataset).mock.calls.at(-1)![0].args).not.toHaveProperty("zero");
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "wavelet-denoise" } });
    fireEvent.change(await screen.findByLabelText("Threshold rule"), { target: { value: "percent" } });
    expect(screen.queryByLabelText("Thresholding")).toBeNull();
    fireEvent.change(screen.getByLabelText("Threshold (% of largest detail)"), { target: { value: "25" } });
    await waitFor(() => expect(vi.mocked(sigopDataset).mock.calls.at(-1)![0].args).toMatchObject({ rule: "percent", percent: 25, threshold: "hard" }));
  });

  it("refuses the method with the install instruction when the extra is missing, and sends nothing", async () => {
    vi.mocked(waveletsStatus).mockResolvedValue({ available: false, reason: "Wavelet transforms need PyWavelets. Install it with: pip install quantized-lab[wavelets]" });
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "dwt" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/quantized-lab\[wavelets\]/);
    expect(screen.getByRole("button", { name: "Create worksheet" })).toBeDisabled();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(vi.mocked(sigopDataset).mock.calls.some(([b]) => b.method === "dwt")).toBe(false);
  });

  it("other operations never ask whether the extra is installed", async () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "median" } });
    await waitFor(() => expect(vi.mocked(sigopDataset).mock.calls.at(-1)?.[0].method).toBe("median"));
    expect(waveletsStatus).not.toHaveBeenCalled();
  });
});
