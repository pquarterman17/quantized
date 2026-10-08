import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import SignalProcessingPanel from "./SignalProcessingPanel";

const { correctionMock, spectralMock, createSignalMock, askParamsMock, saveRecipeMock } = vi.hoisted(() => ({
  correctionMock: vi.fn(), spectralMock: vi.fn(), createSignalMock: vi.fn(), askParamsMock: vi.fn(), saveRecipeMock: vi.fn(),
}));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  applyCorrections: correctionMock,
}));
vi.mock("../../../lib/api/spectralWorkbench", () => ({ runSpectralWorkbench: spectralMock }));
vi.mock("../../../store/signalWorksheetCommand", () => ({ createSignalWorksheetFromApp: createSignalMock }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: askParamsMock }));
vi.mock("../../../lib/signalRecipeTemplate", () => ({ saveSignalRecipeTemplate: saveRecipeMock }));

vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));

const dataset: Dataset = {
  id: "signal-source",
  name: "scan",
  data: {
    time: [1, 2, 3],
    values: [[10, 1], [20, 4], [30, 9]],
    labels: ["primary", "secondary"],
    units: ["V", "A"],
    metadata: { xUnit: "s" },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  correctionMock.mockImplementation(async ({ dataset: data }: { dataset: Dataset["data"] }) => structuredClone(data));
  spectralMock.mockResolvedValue({
    time: [0, 1],
    values: [[1], [0.5]],
    labels: ["secondary · Magnitude"],
    units: ["A"],
    metadata: { xLabel: "Frequency", xUnit: "1/s" },
  });
  createSignalMock.mockResolvedValue(null);
  askParamsMock.mockResolvedValue(null);
  saveRecipeMock.mockReturnValue({ name: "Saved recipe", revision: 1 });
  useApp.setState({
    datasets: [dataset],
    activeId: dataset.id,
    yKeys: [1],
    signalProcessingOpen: true,
    history: [],
    future: [],
  });
});

describe("SignalProcessingPanel", () => {
  it("previews the plotted signal through the channel-targeted API", async () => {
    render(<SignalProcessingPanel />);

    const create = screen.getByRole("button", { name: "Create linked worksheet" });
    await waitFor(() => expect(create).toBeEnabled());
    expect(correctionMock).toHaveBeenLastCalledWith(expect.objectContaining({
      dataset: dataset.data,
      params: expect.objectContaining({
        signalChannels: [1],
        smoothMethod: "savitzky-golay",
      }),
    }), expect.any(AbortSignal));
    expect(screen.getByText("Preview: secondary")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /original and processed/i })).toBeInTheDocument();
    expect(create).toBeEnabled();
  });

  it("fails closed when the chosen operation cannot propagate a bound Y error", () => {
    useApp.setState({
      datasets: [{
        ...dataset,
        errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }],
      }],
      yKeys: [0],
    });
    render(<SignalProcessingPanel />);

    expect(screen.getByRole("alert")).toHaveTextContent("cannot yet propagate bound Y uncertainty");
    expect(screen.getByRole("button", { name: "Create linked worksheet" })).toBeDisabled();
    expect(correctionMock).not.toHaveBeenCalled();
  });

  it("does not create duplicate outputs from rapid repeated clicks", async () => {
    let settle!: (value: string | null) => void;
    const pending = new Promise<string | null>((resolve) => { settle = resolve; });
    createSignalMock.mockReturnValue(pending);
    render(<SignalProcessingPanel />);

    const create = screen.getByRole("button", { name: "Create linked worksheet" });
    await waitFor(() => expect(create).toBeEnabled());
    act(() => {
      create.click();
      create.click();
    });
    expect(createSignalMock).toHaveBeenCalledTimes(1);
    await act(async () => settle(null));
  });

  it("aborts an in-flight commit when the workbench is cancelled", async () => {
    let commitSignal: AbortSignal | undefined;
    createSignalMock.mockImplementation((_source, _recipe, signal: AbortSignal) => {
      commitSignal = signal;
      return new Promise<null>((resolve) => signal.addEventListener("abort", () => resolve(null), { once: true }));
    });
    render(<SignalProcessingPanel />);
    const create = screen.getByRole("button", { name: "Create linked worksheet" });
    await waitFor(() => expect(create).toBeEnabled());

    fireEvent.click(create);
    await waitFor(() => expect(commitSignal).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(commitSignal?.aborted).toBe(true);
    expect(useApp.getState().signalProcessingOpen).toBe(false);
  });

  it("previews FFT through the strict spectral workbench and records a label-bound recipe", async () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "fft" } });

    await screen.findByText("Preview: secondary · Magnitude");
    expect(spectralMock).toHaveBeenLastCalledWith(
      dataset.data,
      expect.objectContaining({
        kind: "spectral",
        operation: "fft",
        channels: [{ index: 1, label: "secondary", unit: "A" }],
        resample: false,
      }),
      expect.any(AbortSignal),
      true,
    );
    expect(screen.getByRole("img", { name: "Analysis output preview" })).toBeInTheDocument();
    expect(screen.getByText("Preview: secondary · Magnitude")).toBeInTheDocument();
  });

  it("saves the current operation into the shared Recipe Library", async () => {
    askParamsMock.mockResolvedValue({ name: "Clean secondary" });
    render(<SignalProcessingPanel />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save recipe…" }));
      await Promise.resolve();
    });
    expect(saveRecipeMock).toHaveBeenCalledTimes(1);
    expect(saveRecipeMock).toHaveBeenCalledWith("Clean secondary", dataset, expect.objectContaining({
      kind: "signal-correction",
      channels: [{ index: 1, label: "secondary", unit: "A" }],
    }));
  });

  it("disables commit instead of reusing a preview from the previous operation", async () => {
    render(<SignalProcessingPanel />);
    const create = screen.getByRole("button", { name: "Create linked worksheet" });
    await waitFor(() => expect(create).toBeEnabled());
    spectralMock.mockImplementation(() => new Promise(() => {}));

    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "fft" } });

    expect(create).toBeDisabled();
    expect(screen.queryByText("Preview: secondary · Magnitude")).not.toBeInTheDocument();
  });

  it("requires exactly two channels for cross-correlation", () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "correlation" } });

    expect(screen.getByRole("alert")).toHaveTextContent("requires exactly two");
    expect(screen.getByRole("button", { name: "Create linked worksheet" })).toBeDisabled();
  });

  it("does not silently interpret a blank reference bound as zero", () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "normalize-reference" } });
    fireEvent.change(screen.getByLabelText("Reference"), { target: { value: "range" } });

    expect(screen.getByRole("alert")).toHaveTextContent("Reference X range must be finite and increasing");
    expect(screen.getByRole("button", { name: "Create linked worksheet" })).toBeDisabled();
  });
});
