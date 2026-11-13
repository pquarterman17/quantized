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
vi.mock("../../../lib/signalRecipeTemplate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/signalRecipeTemplate")>()),
  saveSignalRecipeTemplate: saveRecipeMock,
}));

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

  it("smooths data with a bound Y error by propagating it (worksheet audit #9)", async () => {
    useApp.setState({
      datasets: [{ ...dataset, errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }] }],
      yKeys: [0],
    });
    render(<SignalProcessingPanel />);

    const create = screen.getByRole("button", { name: "Create linked worksheet" });
    await waitFor(() => expect(create).toBeEnabled());
    expect(screen.getByRole("group", { name: "Bound uncertainty" })).toHaveTextContent("propagated through this linear operation");
    // The caveat is on screen, not only in the code.
    expect(screen.getByRole("group", { name: "Bound uncertainty" })).toHaveTextContent(/diagonal only.*neighbouring output points are correlated/);
    expect(correctionMock).toHaveBeenLastCalledWith(expect.objectContaining({
      params: expect.not.objectContaining({ dropYUncertainty: true }),
      error_bindings: [{ channel: 1, target: 0, axis: "y", side: "both" }],
    }), expect.any(AbortSignal));
  });

  it("a second linear step on an already-propagated (correlated) uncertainty is blocked with the reason, before any request", async () => {
    useApp.setState({
      datasets: [{
        ...dataset,
        data: { ...dataset.data, metadata: { ...dataset.data.metadata, correlated_y_errors: ["secondary"] } },
        errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }],
      }],
      yKeys: [0],
    });
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByRole("combobox", { name: "Operation" }), { target: { value: "integral" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/uncertainty in secondary came out of an earlier smoothing, derivative or integral.*correlated/);
    expect(screen.getByRole("button", { name: "Create linked worksheet" })).toBeDisabled();
    expect(correctionMock).not.toHaveBeenCalled();
    // The note under the drop box must not contradict the alert: an integral
    // CAN propagate; this input is the problem, not the operation (live check).
    const note = screen.getByRole("group", { name: "Bound uncertainty" });
    expect(note).not.toHaveTextContent(/cannot be propagated through this operation/);
    expect(note).toHaveTextContent(/earlier linear step/);
    // A scalar step is still exact.
    fireEvent.change(screen.getByRole("combobox", { name: "Operation" }), { target: { value: "normalize-peak" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Create linked worksheet" })).toBeEnabled());
  });

  it("a nonlinear operation with a bound Y error says why it is blocked, and dropping the uncertainty unblocks it", async () => {
    useApp.setState({
      datasets: [{ ...dataset, errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }] }],
      yKeys: [0],
    });
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByRole("combobox", { name: "Operation" }), { target: { value: "log-derivative" } });

    const reason = 'Logarithmic derivative can\'t propagate the bound Y uncertainty. Tick "Drop uncertainty for this output" or unassign the error column.';
    expect(screen.getByRole("alert")).toHaveTextContent(reason);
    const create = screen.getByRole("button", { name: "Create linked worksheet" });
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute("title", reason); // a disabled control says why
    expect(screen.getByRole("button", { name: "Save recipe…" })).toHaveAttribute("title", reason);

    fireEvent.click(screen.getByRole("checkbox", { name: "Drop uncertainty for this output" }));
    await waitFor(() => expect(create).toBeEnabled());
    expect(correctionMock).toHaveBeenLastCalledWith(expect.objectContaining({
      params: expect.objectContaining({ derivativeMode: "dlog/dlog", dropYUncertainty: true }),
    }), expect.any(AbortSignal));
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

  it("previews and commits a correlation linked to two worksheets", async () => {
    const reference: Dataset = {
      id: "reference-source",
      name: "reference scan",
      data: {
        time: [1, 2, 3],
        values: [[2, 0.2], [5, 0.3], [10, 0.4]],
        labels: ["reference", "reference error"],
        units: ["A", "A"],
        metadata: { xUnit: "s" },
      },
      errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }],
    };
    useApp.setState({ datasets: [dataset, reference] });
    createSignalMock.mockResolvedValue("correlation-output");
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "correlation" } });
    fireEvent.click(screen.getByLabelText("One column from each of two worksheets"));
    fireEvent.change(screen.getByLabelText("Second worksheet"), { target: { value: reference.id } });

    const create = screen.getByRole("button", { name: "Create linked worksheet" });
    await waitFor(() => expect(create).toBeEnabled());
    expect(spectralMock).toHaveBeenLastCalledWith(
      dataset.data,
      expect.objectContaining({
        operation: "correlation",
        channels: [{ index: 1, label: "secondary", unit: "A" }],
        secondarySource: expect.objectContaining({
          datasetId: reference.id,
          channel: { index: 0, label: "reference", unit: "A" },
        }),
      }),
      expect.any(AbortSignal),
      true,
      reference.data,
    );
    expect(screen.getByRole("button", { name: "Save recipe…" })).toBeDisabled();
    expect(screen.getByText(/Bound uncertainties are not propagated/)).toBeInTheDocument();
    fireEvent.click(create);
    await waitFor(() => expect(useApp.getState().activeId).toBe("correlation-output"));
    expect(createSignalMock).toHaveBeenCalledWith(
      dataset.id,
      expect.objectContaining({ secondarySource: expect.objectContaining({ datasetId: reference.id }) }),
      expect.any(AbortSignal),
    );
  });

  it("Apply to selected sheets… opens the batch apply on the CURRENT setup, seeded with the Library selection (worksheet audit #15)", async () => {
    const other: Dataset = { ...dataset, id: "other", name: "scan 2" };
    useApp.setState({ datasets: [dataset, other], selectedIds: [dataset.id, other.id] });
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "derivative-first" } });
    const launch = screen.getByRole("button", { name: "Apply to selected sheets…" });
    await waitFor(() => expect(launch).toBeEnabled());
    fireEvent.click(launch);
    const region = await screen.findByRole("region", { name: "Apply recipe First derivative (Signal Processing)" });
    expect(region).toHaveTextContent("1 step: First derivative · secondary");
    // A preflight per picked sheet, before anything runs.
    expect(screen.getByRole("group", { name: "Preflight scan" })).toHaveTextContent("ready");
    expect(screen.getByRole("group", { name: "Preflight scan 2" })).toHaveTextContent("ready");
    expect(screen.getByRole("button", { name: "Apply to 2 datasets" })).toBeEnabled();
  });

  it("Apply to selected sheets… is disabled, with the reason, while the setup is invalid", () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "normalize-reference" } });
    fireEvent.change(screen.getByLabelText("Reference"), { target: { value: "range" } });
    const launch = screen.getByRole("button", { name: "Apply to selected sheets…" });
    expect(launch).toBeDisabled();
    expect(launch).toHaveAttribute("title", "Reference X range must be finite and increasing.");
  });

  it("does not silently interpret a blank reference bound as zero", () => {
    render(<SignalProcessingPanel />);
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "normalize-reference" } });
    fireEvent.change(screen.getByLabelText("Reference"), { target: { value: "range" } });

    expect(screen.getByRole("alert")).toHaveTextContent("Reference X range must be finite and increasing");
    expect(screen.getByRole("button", { name: "Create linked worksheet" })).toBeDisabled();
  });
});
